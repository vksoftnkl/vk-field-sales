import { eq } from 'drizzle-orm';

import type { Tx } from '@/db/client';
import { orders, type OutboxEntity } from '@/db/schema';
import type { PushResult } from '@/api/types';

/**
 * What to update in the local document when the server ACKs or REJECTs it.
 * Add one entry per entity as new document types (sale, receipt, return…) are built.
 */
interface AckHandler {
  onAck(tx: Tx, clientUuid: string, result: PushResult): void;
  onReject(tx: Tx, clientUuid: string, error: string): void;
}

const noop: AckHandler = { onAck: () => {}, onReject: () => {} };

export const ackHandlers: Record<OutboxEntity, AckHandler> = {
  order: {
    onAck: (tx, uuid, r) =>
      tx
        .update(orders)
        .set({ status: 'SYNCED', serverId: r.serverId ?? null, orderNo: r.docNo ?? null })
        .where(eq(orders.clientUuid, uuid))
        .run(),
    onReject: (tx, uuid) => tx.update(orders).set({ status: 'REJECTED' }).where(eq(orders.clientUuid, uuid)).run(),
  },
  sale: noop,
  receipt: noop,
  return: noop,
  visit: noop,
  expense: noop,
};
