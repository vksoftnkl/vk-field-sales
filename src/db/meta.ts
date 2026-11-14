import { eq } from 'drizzle-orm';

import { db } from './client';
import { deviceMeta } from './schema';

/**
 * Typed keys kept in device_meta. Add new keys here.
 *  - serverHost / serverPort: the VK Nex server PC, entered in Server settings.
 *  - company*: sent by the server on device registration; used for GST (CGST+SGST vs IGST).
 *  - deviceStatus: last answer from the office (PENDING / APPROVED / BLOCKED / WIPE).
 *    Kept so a blocked phone stays blocked offline.
 *  - lastUserId: salesman picked last time, pre-selected on the login screen.
 */
export type MetaKey =
  | 'serverHost'
  | 'serverPort'
  | 'companyId'
  | 'companyName'
  | 'companyStateCode'
  | 'branchId'
  | 'deviceStatus'
  | 'salesmanId'
  | 'invoiceSeries'
  | 'lastSyncAt'
  | 'lastUserId'
  | 'printerAddress';

export function getMeta(key: MetaKey): string | null {
  const row = db.select().from(deviceMeta).where(eq(deviceMeta.key, key)).get();
  return row?.value ?? null;
}

export function setMeta(key: MetaKey, value: string): void {
  db.insert(deviceMeta)
    .values({ key, value })
    .onConflictDoUpdate({ target: deviceMeta.key, set: { value } })
    .run();
}

/** Store a value, or remove the key when the server sends nothing. */
export function setOrClearMeta(key: MetaKey, value: string | null | undefined): void {
  if (value === null || value === undefined || value === '') {
    db.delete(deviceMeta).where(eq(deviceMeta.key, key)).run();
  } else {
    setMeta(key, value);
  }
}
