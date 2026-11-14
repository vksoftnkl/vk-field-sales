import { api } from '@/api/endpoints';
import { ApiError, NetworkError, ServerNotSetError } from '@/api/http';
import type { DeviceStatus, RegisterDeviceResponse } from '@/api/types';
import { getDeviceInfo } from '@/auth/device';
import { setMeta, setOrClearMeta } from '@/db/meta';
import { ensureMigrated } from '@/db/migrate';

import { pruneAcked, resetStuckSending } from './outbox';
import { clearMasters, pullAll } from './pull';
import { pushOutbox } from './push';

/**
 * The ONLY code that talks to the server for data. Screens read/write SQLite;
 * this moves data both ways, and only when the salesman taps Sync (like the old
 * Qt app's Sync Device page). No timers, no background task.
 *
 *   1. register the device  → stop unless the office has APPROVED it
 *   2. push the outbox      → orders etc. taken on the phone
 *   3. pull the masters     → users (for offline login), customers, items, prices
 */

export type SyncReason = 'manual' | 'login-screen' | 'pull-to-refresh';

/** Why a sync stopped early, so screens can say what to do next. */
export type SyncFailure = 'server-not-set' | 'unreachable' | 'not-approved' | 'blocked' | 'rejected' | 'error';

export interface SyncReport {
  reason: SyncReason;
  startedAt: string;
  finishedAt: string;
  pushed: number;
  rejected: number;
  pulled: number;
  failure: SyncFailure | null;
  error: string | null;
  deviceStatus?: DeviceStatus;
}

type Listener = (e: { type: 'start'; reason: SyncReason } | { type: 'finish'; report: SyncReport }) => void;
const listeners = new Set<Listener>();
export function onSyncEvent(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

let inFlight: Promise<SyncReport> | null = null;
let recovered = false;

/** Single-flight: a double tap shares one run instead of racing. */
export function runSync(reason: SyncReason): Promise<SyncReport> {
  inFlight ??= doSync(reason).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

export const isSyncing = () => inFlight !== null;

async function doSync(reason: SyncReason): Promise<SyncReport> {
  const startedAt = new Date().toISOString();
  listeners.forEach((l) => l({ type: 'start', reason }));
  const report: SyncReport = {
    reason,
    startedAt,
    finishedAt: startedAt,
    pushed: 0,
    rejected: 0,
    pulled: 0,
    failure: null,
    error: null,
  };

  try {
    await ensureMigrated();
    if (!recovered) {
      resetStuckSending(); // rows left SENDING by an app that was killed mid-sync
      recovered = true;
    }

    // 1) Announce the phone. Nothing moves until the office approves it in VK Nex.
    const info = await getDeviceInfo();
    const reg = await api.device.register(info);
    applyDeviceStatus(reg.status);
    report.deviceStatus = reg.status;
    if (reg.status !== 'APPROVED') {
      report.failure = reg.status === 'PENDING' ? 'not-approved' : 'blocked';
      return finish(report);
    }
    saveCompany(reg);

    // 2) Push first: the salesman's work is the most valuable data on the phone.
    const push = await pushOutbox(info.deviceId);
    report.pushed = push.acked;
    report.rejected = push.rejected;
    if (push.deviceStatus) {
      applyDeviceStatus(push.deviceStatus);
      report.deviceStatus = push.deviceStatus;
      if (push.deviceStatus !== 'APPROVED') {
        report.failure = push.deviceStatus === 'PENDING' ? 'not-approved' : 'blocked';
        return finish(report);
      }
    }

    // 3) Then fresh masters, users first.
    report.pulled = await pullAll();
    pruneAcked();
    setMeta('lastSyncAt', new Date().toISOString());
  } catch (e) {
    report.failure =
      e instanceof ServerNotSetError
        ? 'server-not-set'
        : e instanceof NetworkError
          ? 'unreachable'
          : e instanceof ApiError && (e.status === 401 || e.status === 403)
            ? 'rejected'
            : 'error';
    report.error = e instanceof Error ? e.message : String(e);
  }

  return finish(report);
}

function finish(report: SyncReport): SyncReport {
  report.finishedAt = new Date().toISOString();
  listeners.forEach((l) => l({ type: 'finish', report }));
  return report;
}

/** Remember the office's decision so login can enforce it offline. */
function applyDeviceStatus(status: DeviceStatus): void {
  setMeta('deviceStatus', status);
  if (status === 'WIPE') clearMasters();
}

function saveCompany(reg: RegisterDeviceResponse): void {
  if (reg.company) {
    setMeta('companyId', reg.company.id);
    setMeta('companyName', reg.company.name);
    setOrClearMeta('companyStateCode', reg.company.stateCode);
    setOrClearMeta('branchId', reg.company.branchId);
  }
  setOrClearMeta('salesmanId', reg.salesmanId);
  setOrClearMeta('invoiceSeries', reg.invoiceSeries);
}
