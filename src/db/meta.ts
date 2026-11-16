import { eq } from 'drizzle-orm';

import { db } from './client';
import { deviceMeta } from './schema';

/**
 * Typed keys kept in device_meta. Add new keys here.
 *  - lastUserId: salesman picked last time, pre-selected on the login screen.
 *  - lastBeatIds: beats ticked last time on the customer list, comma-separated ('' = all beats).
 *  - companyId: company new bills and receipts are made for (Choose company).
 *  - serverHost, serverPort: where the VK Nex server PC is (Sync page).
 */
export type MetaKey = 'lastUserId' | 'lastBeatIds' | 'companyId' | 'serverHost' | 'serverPort';

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
