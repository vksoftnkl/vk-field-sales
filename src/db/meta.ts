import { eq } from 'drizzle-orm';

import { db } from './client';
import { deviceMeta } from './schema';

/**
 * Typed keys kept in device_meta. Add new keys here.
 *  - lastUserId: VK Nex usr_id of whoever logged in last; their login name is filled in on the login page.
 *  - lastBeatIds: beats applied on the customer list since login, comma-separated ('' = all beats).
 *    Cleared at every login; New customer and the sales return's customer list start from it.
 *  - companyId: company new bills, receipts and orders are made for (Switch company).
 *  - branchId: branch of that company new orders are saved for (Switch company); none = ask first.
 *  - serverScheme, serverHost, serverPort: where the VK Nex server PC is (Sync page); scheme http or https (none saved = http).
 *  - ledgerSyncedAt: when Sync last saved the ledgers (ISO time); screens showing balances re-read on it.
 *  - deviceUid: this phone's VK Nex device uid ('VKSMAN-…'), made once; registered on VK Nex's Device List.
 *  - itemsSyncedAt: when Sync last saved the items (ISO time).
 *  - schemesSyncedOn: when Sync last saved the offers (ISO time); Add items says "offers as of".
 *  - me: GET /mobile/me at the last Sync, as JSON (the login's employee and rights); none = an
 *    older VK Nex, and the phone assumes the rights.
 *  - receiptStatusSince: VK Nex's time of the last receipt status read (the next one asks for changes since).
 *  - customerFiguresSyncedAt: when Sync last saved the customers' balance and outstanding (ISO
 *    time); the Customer list and Customer detail re-read on it.
 */
export type MetaKey =
  | 'lastUserId'
  | 'lastBeatIds'
  | 'companyId'
  | 'branchId'
  | 'serverScheme'
  | 'serverHost'
  | 'serverPort'
  | 'ledgerSyncedAt'
  | 'deviceUid'
  | 'itemsSyncedAt'
  | 'schemesSyncedOn'
  | 'me'
  | 'receiptStatusSince'
  | 'customerFiguresSyncedAt';

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
