import { and, asc, count, eq, inArray, lte, notInArray, sql } from 'drizzle-orm';

import { SYNC } from '@/config/env';
import { db, type Tx } from '@/db/client';
import { outbox, type OutboxEntity, type OutboxRow } from '@/db/schema';

const nowIso = () => new Date().toISOString();

/**
 * Queue a document for upload. MUST be called inside the same transaction that saves
 * the document, so a bill and its queue entry are saved together or not at all.
 * Re-queuing the same (entity, clientUuid) replaces the payload — e.g. an edited order.
 */
export function enqueue(
  tx: Tx,
  entity: OutboxEntity,
  clientUuid: string,
  payload: unknown,
  op: 'UPSERT' | 'CANCEL' = 'UPSERT',
): void {
  const json = JSON.stringify(payload);
  tx.insert(outbox)
    .values({ entity, clientUuid, op, payload: json })
    .onConflictDoUpdate({
      target: [outbox.entity, outbox.clientUuid],
      set: { op, payload: json, status: 'PENDING', attempts: 0, nextAttemptAt: null, lastError: null, updatedAt: nowIso() },
    })
    .run();
}

/** Crash recovery: anything left SENDING by a killed process goes back to PENDING. */
export function resetStuckSending(): void {
  db.update(outbox).set({ status: 'PENDING' }).where(eq(outbox.status, 'SENDING')).run();
}

/**
 * Take the next batch, oldest first, and mark it SENDING.
 * Sync only runs when the salesman taps it, so there is no backoff: every tap sends
 * everything PENDING. `skip` holds rows already tried in this run, so a row the
 * server asked to RETRY isn't sent again in a loop.
 */
export function claimBatch(skip: number[] = [], limit: number = SYNC.pushBatchSize): OutboxRow[] {
  const now = nowIso();
  return db.transaction((tx) => {
    const rows = tx
      .select()
      .from(outbox)
      .where(skip.length ? and(eq(outbox.status, 'PENDING'), notInArray(outbox.id, skip)) : eq(outbox.status, 'PENDING'))
      .orderBy(asc(outbox.id))
      .limit(limit)
      .all();
    if (rows.length) {
      tx.update(outbox)
        .set({ status: 'SENDING', updatedAt: now })
        .where(inArray(outbox.id, rows.map((r) => r.id)))
        .run();
    }
    return rows;
  });
}

export function markAcked(tx: Tx, id: number, serverId: string | null): void {
  tx.update(outbox).set({ status: 'ACKED', serverId, lastError: null, updatedAt: nowIso() }).where(eq(outbox.id, id)).run();
}

export function markRejected(tx: Tx, id: number, error: string): void {
  tx.update(outbox).set({ status: 'REJECTED', lastError: error, updatedAt: nowIso() }).where(eq(outbox.id, id)).run();
}

/** Back to PENDING; it goes again on the next Sync. Network failures don't count as an attempt. */
export function markRetry(ids: number[], error: string, countAttempt = true): void {
  if (!ids.length) return;
  db.update(outbox)
    .set({
      status: 'PENDING',
      ...(countAttempt ? { attempts: sql`${outbox.attempts} + 1` } : {}),
      lastError: error,
      nextAttemptAt: null,
      updatedAt: nowIso(),
    })
    .where(inArray(outbox.id, ids))
    .run();
}

/** Salesman taps "Retry" on a rejected record after fixing it (or after the office fixes masters). */
export function requeue(id: number): void {
  db.update(outbox)
    .set({ status: 'PENDING', attempts: 0, nextAttemptAt: null, updatedAt: nowIso() })
    .where(eq(outbox.id, id))
    .run();
}

export function countByStatus(): Record<OutboxRow['status'], number> {
  const rows = db.select({ status: outbox.status, n: count() }).from(outbox).groupBy(outbox.status).all();
  const out = { PENDING: 0, SENDING: 0, ACKED: 0, REJECTED: 0 };
  for (const r of rows) out[r.status] = r.n;
  return out;
}

/** Keep ACKED rows for a week (useful for support), then drop them. */
export function pruneAcked(days = 7): void {
  db.delete(outbox)
    .where(and(eq(outbox.status, 'ACKED'), lte(outbox.updatedAt, sql`strftime('%Y-%m-%dT%H:%M:%fZ','now', ${`-${days} days`})`)))
    .run();
}
