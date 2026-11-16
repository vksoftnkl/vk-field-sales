import { and, asc, eq, inArray } from 'drizzle-orm';

import { db } from '@/db/client';
import { getMeta, setMeta } from '@/db/meta';
import { beats, customerBills, customers, customerTypes, itemPriceLevels } from '@/db/schema';

import type { DownloadedCustomer } from './download-customers';
import type { ServerAddress } from './server-address';
import type { PendingCustomer } from './upload-customers';
import type { CustomerOptions } from './vk-nex-api';

/** What Sync reads from and writes to the phone's database. */

export function getServerAddress(): ServerAddress | null {
  const host = getMeta('serverHost');
  const port = getMeta('serverPort');
  return host && port ? { host, port } : null;
}

export function saveServerAddress(a: ServerAddress): void {
  setMeta('serverHost', a.host);
  setMeta('serverPort', a.port);
}

/** Shops added on the phone and not yet on VK Nex, oldest first. */
export const pendingCustomersQuery = () =>
  db
    .select({
      cusId: customers.cusId,
      cusName: customers.cusName,
      cusGroupId: customers.cusGroupId,
      cusAreaId: customers.cusAreaId,
      cusContactPerson: customers.cusContactPerson,
      cusAddr1: customers.cusAddr1,
      cusAddr2: customers.cusAddr2,
      cusAddr3: customers.cusAddr3,
      cusLandmark: customers.cusLandmark,
      cusCity: customers.cusCity,
      cusDistrict: customers.cusDistrict,
      cusStateName: customers.cusStateName,
      cusStateCode: customers.cusStateCode,
      cusPin: customers.cusPin,
      cusPhone1: customers.cusPhone1,
      cusPhone2: customers.cusPhone2,
      cusWhatsappNo: customers.cusWhatsappNo,
      cusEmail: customers.cusEmail,
      cusGstType: customers.cusGstType,
      cusGstNo: customers.cusGstNo,
      cusPanNo: customers.cusPanNo,
      cusAadharNo: customers.cusAadharNo,
      cusPriceLevelId: customers.cusPriceLevelId,
      appSyncError: customers.appSyncError,
    })
    .from(customers)
    .where(and(eq(customers.appPendingUpload, true), eq(customers.cusIsDeleted, false)))
    .orderBy(asc(customers.cusCreatedOn));

export function pendingCustomers(): PendingCustomer[] {
  return pendingCustomersQuery().all();
}

/**
 * VK Nex has the customer: from now on it goes by VK Nex's id and code. Its unpaid bills move
 * with it. If the phone already holds that id (linked to a customer pulled earlier), the phone's
 * copy was a duplicate and goes. One transaction, so a crash never leaves it half-done.
 */
export function markCustomerSynced(localId: string, saved: { cusId: string; cusCode: string | null }, priceLevelId: number): void {
  const now = new Date().toISOString();
  db.transaction((tx) => {
    tx.update(customerBills).set({ customerId: saved.cusId }).where(eq(customerBills.customerId, localId)).run();
    const clash = saved.cusId !== localId && tx.select({ id: customers.cusId }).from(customers).where(eq(customers.cusId, saved.cusId)).get();
    if (clash) {
      tx.delete(customers).where(eq(customers.cusId, localId)).run();
      return;
    }
    tx.update(customers)
      .set({
        cusId: saved.cusId,
        cusCode: saved.cusCode,
        cusPriceLevelId: priceLevelId,
        cusSyncDate: now,
        appPendingUpload: false,
        appSyncError: null,
      })
      .where(eq(customers.cusId, localId))
      .run();
  });
}

export function markCustomerRefused(localId: string, error: string): void {
  db.update(customers).set({ appSyncError: error }).where(eq(customers.cusId, localId)).run();
}

/**
 * Areas, customer groups and price levels from VK Nex, so a shop added on the phone points at
 * ids VK Nex knows. Areas and groups are added or renamed (test beats and types stay until
 * Sync replaces them); price levels are VK Nex's list exactly.
 */
export function saveCustomerOptions(o: CustomerOptions): void {
  db.transaction((tx) => {
    o.areas.forEach((a, i) => {
      tx.insert(beats)
        .values({ id: a.id, name: a.name, position: i + 1 })
        .onConflictDoUpdate({ target: beats.id, set: { name: a.name, position: i + 1 } })
        .run();
    });
    o.groups.forEach((g, i) => {
      tx.insert(customerTypes)
        .values({ id: g.id, name: g.name, position: i + 1 })
        .onConflictDoUpdate({ target: customerTypes.id, set: { name: g.name, position: i + 1 } })
        .run();
    });
    tx.delete(itemPriceLevels).run();
    if (o.priceLevels.length) tx.insert(itemPriceLevels).values(o.priceLevels.map((p) => ({ iplId: p.id, iplName: p.name }))).run();
  });
}

export interface SavedDownload {
  /** Customers added or brought up to date. */
  saved: number;
  /** Synced customers VK Nex no longer has (deleted there): hidden on the phone. */
  removed: number;
}

/**
 * VK Nex's customers, as read by Sync, into the phone's table, in one transaction. A customer
 * already on the phone gets VK Nex's values; what happened at the shop on this trip (the app_*
 * columns) stays. Shops still waiting to upload are never touched. A synced customer VK Nex no
 * longer lists is marked deleted, so it leaves the list and comes back if VK Nex restores it.
 */
export function saveDownloadedCustomers(rows: readonly DownloadedCustomer[], listedIds: readonly string[]): SavedDownload {
  const listed = new Set(listedIds);
  let removed = 0;
  db.transaction((tx) => {
    for (const row of rows) {
      const { cusId: _id, ...fields } = row;
      tx.insert(customers).values(row).onConflictDoUpdate({ target: customers.cusId, set: fields }).run();
    }
    const gone = tx
      .select({ id: customers.cusId })
      .from(customers)
      .where(and(eq(customers.appPendingUpload, false), eq(customers.cusIsDeleted, false)))
      .all()
      .map((r) => r.id)
      .filter((id) => !listed.has(id));
    // In chunks: SQLite limits the number of values in one statement.
    for (let i = 0; i < gone.length; i += 500) {
      tx.update(customers).set({ cusIsDeleted: true }).where(inArray(customers.cusId, gone.slice(i, i + 500))).run();
    }
    removed = gone.length;
  });
  return { saved: rows.length, removed };
}
