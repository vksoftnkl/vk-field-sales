import { api } from '@/api/endpoints';
import { ApiError, NetworkError } from '@/api/http';
import type { DeviceStatus, PushRecord } from '@/api/types';
import { db } from '@/db/client';

import { ackHandlers } from './ack-handlers';
import { claimBatch, markAcked, markRejected, markRetry } from './outbox';

export interface PushReport {
  acked: number;
  rejected: number;
  retried: number;
  deviceStatus?: DeviceStatus;
}

/**
 * Upload the outbox in small batches until it's empty or the server PC stops answering.
 * Each record is settled individually by the server's per-record result,
 * so one bad bill never blocks the rest.
 */
export async function pushOutbox(deviceId: string): Promise<PushReport> {
  const report: PushReport = { acked: 0, rejected: 0, retried: 0 };
  const tried: number[] = [];

  for (;;) {
    const batch = claimBatch(tried);
    if (!batch.length) break;
    tried.push(...batch.map((r) => r.id));

    const records: PushRecord[] = batch.map((r) => ({
      entity: r.entity,
      clientUuid: r.clientUuid,
      op: r.op,
      payload: JSON.parse(r.payload) as unknown,
      createdAt: r.createdAt,
    }));

    let res;
    try {
      res = await api.sync.push({ deviceId, records });
    } catch (e) {
      const ids = batch.map((r) => r.id);
      if (e instanceof NetworkError) {
        // Server PC unreachable: put back without counting an attempt.
        markRetry(ids, e.message, false);
      } else {
        markRetry(ids, e instanceof ApiError ? `HTTP ${e.status}: ${e.message}` : String(e));
      }
      report.retried += ids.length;
      throw e;
    }

    if (res.deviceStatus) report.deviceStatus = res.deviceStatus;

    const byKey = new Map(res.results.map((r) => [`${r.entity}:${r.clientUuid}`, r]));
    const retryIds: number[] = [];

    db.transaction((tx) => {
      for (const row of batch) {
        const result = byKey.get(`${row.entity}:${row.clientUuid}`);
        const handler = ackHandlers[row.entity];
        if (result?.status === 'ACKED') {
          markAcked(tx, row.id, result.serverId ?? null);
          handler.onAck(tx, row.clientUuid, result);
          report.acked++;
        } else if (result?.status === 'REJECTED') {
          const err = result.error ?? 'Rejected by server';
          markRejected(tx, row.id, err);
          handler.onReject(tx, row.clientUuid, err);
          report.rejected++;
        } else {
          retryIds.push(row.id); // RETRY or missing from the response
        }
      }
    });

    if (retryIds.length) {
      markRetry(retryIds, 'Server asked to retry');
      report.retried += retryIds.length;
    }
    if (res.deviceStatus === 'BLOCKED' || res.deviceStatus === 'WIPE') break;
  }

  return report;
}
