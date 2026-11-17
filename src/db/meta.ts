import { eq } from 'drizzle-orm';

import { db } from './client';
import { deviceMeta } from './schema';

/**
 * Typed keys kept in device_meta. Add new keys here.
 *  - lastUserId: salesman picked last time, pre-selected on the login screen.
 *  - lastBeatIds: beats ticked last time on the customer list, comma-separated ('' = all beats).
 *  - companyId: company new bills and receipts are made for (Choose company).
 *  - serverScheme, serverHost, serverPort: where the VK Nex server PC is (Sync page); scheme http or https (none saved = http).
 *  - ledgerSyncedAt: when Sync last saved the ledgers (ISO time); screens showing balances re-read on it.
 *  - deviceUid: this phone's VK Nex device uid ('VKSMAN-…'), made once; registered on VK Nex's Device List.
 *  - itemsSyncedAt: when Sync last saved the items (ISO time).
 */
export type MetaKey = 'lastUserId' | 'lastBeatIds' | 'companyId' | 'serverScheme' | 'serverHost' | 'serverPort' | 'ledgerSyncedAt' | 'deviceUid' | 'itemsSyncedAt';

export function getMeta(key: MetaKey): string | null {
  const row = db.select().from(deviceMeta).where(eq(deviceMeta.key, key)).get();
  return row?.value ?? null;
}

/** One key, for useLiveQuery: re-renders when that key is written. */
export const metaQuery = (key: MetaKey) => db.select({ value: deviceMeta.value }).from(deviceMeta).where(eq(deviceMeta.key, key));

export function setMeta(key: MetaKey, value: string): void {
  db.insert(deviceMeta)
    .values({ key, value })
    .onConflictDoUpdate({ target: deviceMeta.key, set: { value } })
    .run();
}
