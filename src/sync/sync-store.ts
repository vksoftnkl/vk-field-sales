import { and, asc, eq, inArray, or } from 'drizzle-orm';

import { db } from '@/db/client';
import { getMeta, setMeta } from '@/db/meta';
import {
  beats,
  companies,
  customerBills,
  customers,
  customerTypes,
  fiscalYears,
  itemBrandMaster,
  itemGroupMaster,
  itemMaster,
  itemPriceLevels,
  itemUnits,
  ledgerRows,
  ledgerYears,
  openBills,
  receipts,
  receiptTenders,
  saleBill,
  saleOrder,
  saleOrderItem,
  tenders,
  visits,
} from '@/db/schema';

import { makeDeviceUid } from './device-uid';
import type { DownloadedCustomer } from './download-customers';
import type { ItemDownload } from './download-items';
import type { LedgerDownload } from './download-ledgers';
import type { ServerAddress } from './server-address';
import type { PendingCustomer } from './upload-customers';
import type { PendingOrder } from './upload-orders';
import type { ReceiptData } from './download-receipt-data';
import type { PendingReceipt } from './upload-receipts';
import type { PendingVisit } from './upload-visits';
import type { PendingEdit } from './update-customers';
import type { CreatedOrder, CreatedReceipt, CreatedVisit, CustomerOptions, ItemOptions } from './vk-nex-api';

/** What Sync reads from and writes to the phone's database. */

export function getServerAddress(): ServerAddress | null {
  const host = getMeta('serverHost');
  const port = getMeta('serverPort');
  // Saved before https was possible: no scheme means http.
  const scheme = getMeta('serverScheme') === 'https' ? 'https' : 'http';
  return host && port ? { scheme, host, port } : null;
}

export function saveServerAddress(a: ServerAddress): void {
  setMeta('serverScheme', a.scheme);
  setMeta('serverHost', a.host);
  setMeta('serverPort', a.port);
}

/** This phone's VK Nex device uid, made the first time it is asked for and kept from then on. */
export function getDeviceUid(): string {
  const saved = getMeta('deviceUid');
  if (saved) return saved;
  const made = makeDeviceUid();
  setMeta('deviceUid', made);
  return made;
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
    // Orders, check-ins, bills and receipts at the new shop go to VK Nex under its id.
    tx.update(saleOrder).set({ soCustId: saved.cusId }).where(eq(saleOrder.soCustId, localId)).run();
    tx.update(visits).set({ customerId: saved.cusId }).where(eq(visits.customerId, localId)).run();
    tx.update(saleBill).set({ sbCustId: saved.cusId }).where(eq(saleBill.sbCustId, localId)).run();
    tx.update(receipts).set({ avhPartyId: saved.cusId }).where(eq(receipts.avhPartyId, localId)).run();
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

/** VK Nex customers edited on the phone (Edit customer) and not yet sent, oldest change first. */
export function pendingEdits(): PendingEdit[] {
  return db
    .select({
      cusId: customers.cusId,
      cusName: customers.cusName,
      cusPhone1: customers.cusPhone1,
      cusPhone2: customers.cusPhone2,
      cusAadharNo: customers.cusAadharNo,
      cusPanNo: customers.cusPanNo,
      editedFields: customers.appEditedFields,
    })
    .from(customers)
    .where(and(eq(customers.appPendingUpdate, true), eq(customers.appPendingUpload, false), eq(customers.cusIsDeleted, false)))
    .orderBy(asc(customers.cusModifiedOn))
    .all();
}

/** Everything the Sync page lists as waiting: new shops and edits, with the last refusal. */
export const waitingToSendQuery = () =>
  db
    .select({ cusId: customers.cusId, cusName: customers.cusName, isNew: customers.appPendingUpload, appSyncError: customers.appSyncError })
    .from(customers)
    .where(and(or(eq(customers.appPendingUpload, true), eq(customers.appPendingUpdate, true)), eq(customers.cusIsDeleted, false)))
    .orderBy(asc(customers.cusModifiedOn));

/**
 * VK Nex has the edit. If the salesman saved another change to this customer while it was being
 * sent, it stays waiting (the next Sync sends it); otherwise the flag and the field list clear.
 */
export function markCustomerUpdated(sent: PendingEdit): void {
  db.transaction((tx) => {
    const now = tx
      .select({
        cusPhone1: customers.cusPhone1,
        cusPhone2: customers.cusPhone2,
        cusAadharNo: customers.cusAadharNo,
        cusPanNo: customers.cusPanNo,
        editedFields: customers.appEditedFields,
      })
      .from(customers)
      .where(eq(customers.cusId, sent.cusId))
      .get();
    if (!now) return;
    const same =
      now.cusPhone1 === sent.cusPhone1 &&
      now.cusPhone2 === sent.cusPhone2 &&
      now.cusAadharNo === sent.cusAadharNo &&
      now.cusPanNo === sent.cusPanNo &&
      now.editedFields.length === sent.editedFields.length &&
      now.editedFields.every((f) => sent.editedFields.includes(f));
    tx.update(customers)
      .set(
        same
          ? { appPendingUpdate: false, appEditedFields: [], appSyncError: null, cusSyncDate: new Date().toISOString() }
          : { appSyncError: null },
      )
      .where(eq(customers.cusId, sent.cusId))
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
 * columns) stays. Shops still waiting to upload are never touched, nor is a customer whose edit
 * VK Nex refused (the salesman's values stay until the edit goes through). A synced customer
 * VK Nex no longer lists is marked deleted, so it leaves the list and comes back if VK Nex
 * restores it.
 */
export function saveDownloadedCustomers(rows: readonly DownloadedCustomer[], listedIds: readonly string[]): SavedDownload {
  const listed = new Set(listedIds);
  let removed = 0;
  db.transaction((tx) => {
    const edited = new Set(
      tx.select({ id: customers.cusId }).from(customers).where(eq(customers.appPendingUpdate, true)).all().map((r) => r.id),
    );
    for (const row of rows) {
      if (edited.has(row.cusId)) continue;
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

/** Customers whose ledger Sync reads: VK Nex's live customers on the phone (not ones still to upload). */
export function ledgerCustomerIds(): string[] {
  return db
    .select({ id: customers.cusId })
    .from(customers)
    .where(and(eq(customers.cusIsActive, true), eq(customers.cusIsDeleted, false), eq(customers.appPendingUpload, false)))
    .all()
    .map((r) => r.id);
}

/** Rows per INSERT: well under SQLite's limit on values in one statement. */
const CHUNK = 200;

/**
 * The ledger copies of the customers Sync read are replaced with what it just read, in one
 * transaction, so the Ledger screen never shows half a download. A customer VK Nex skipped this
 * time keeps the copy it had.
 */
export function saveLedgers(d: LedgerDownload): void {
  const syncedOn = new Date().toISOString();
  db.transaction((tx) => {
    for (const y of d.fiscalYears) {
      tx.insert(fiscalYears)
        .values(y)
        .onConflictDoUpdate({ target: fiscalYears.fyYearName, set: { fyBeginDate: y.fyBeginDate, fyEndDate: y.fyEndDate } })
        .run();
    }
    for (let i = 0; i < d.readIds.length; i += CHUNK) {
      const ids = d.readIds.slice(i, i + CHUNK);
      tx.delete(ledgerRows).where(inArray(ledgerRows.customerId, ids)).run();
      tx.delete(ledgerYears).where(inArray(ledgerYears.customerId, ids)).run();
    }
    for (let i = 0; i < d.years.length; i += CHUNK) {
      tx.insert(ledgerYears)
        .values(d.years.slice(i, i + CHUNK).map((y) => ({ ...y, syncedOn })))
        .run();
    }
    for (let i = 0; i < d.rows.length; i += CHUNK) tx.insert(ledgerRows).values(d.rows.slice(i, i + CHUNK)).run();
  });
  // Live queries only watch their own table: this one write tells the customer list (which reads
  // the balance from ledger_years in a subquery) to read again.
  setMeta('ledgerSyncedAt', syncedOn);
}

/**
 * Orders not yet on VK Nex, oldest first, with their lines and whether their customer is on VK Nex
 * yet. An order for a shop still waiting to upload waits for it.
 */
export function pendingOrders(): PendingOrder[] {
  const heads = db
    .select({ header: saleOrder, customerPending: customers.appPendingUpload, customerPriceLevelId: customers.cusPriceLevelId })
    .from(saleOrder)
    .leftJoin(customers, eq(customers.cusId, saleOrder.soCustId))
    .where(eq(saleOrder.appPendingUpload, true))
    .orderBy(asc(saleOrder.soCreatedOn))
    .all();
  const ids = heads.map((h) => h.header.soId);
  const lines: (typeof saleOrderItem.$inferSelect)[] = [];
  for (let i = 0; i < ids.length; i += 500) {
    lines.push(...db.select().from(saleOrderItem).where(inArray(saleOrderItem.soiOrderId, ids.slice(i, i + 500))).all());
  }
  return heads.map((h) => ({
    header: h.header,
    lines: lines.filter((l) => l.soiOrderId === h.header.soId),
    customerPending: h.customerPending === true,
    customerPriceLevelId: h.customerPriceLevelId ?? null,
  }));
}

/** VK Nex has the order (saved now, or before under the same client uuid): keep its id, number and status. */
export function markOrderSynced(localId: string, created: CreatedOrder): void {
  db.update(saleOrder)
    .set({
      soOrderRefno: created.soOrderRefno,
      soStatus: created.soStatus,
      soAccYear: created.soAccYear,
      appServerSoId: created.soId,
      appSyncedOn: new Date().toISOString(),
      appPendingUpload: false,
      appSyncError: null,
    })
    .where(eq(saleOrder.soId, localId))
    .run();
}

export function markOrderRefused(localId: string, error: string): void {
  db.update(saleOrder).set({ appSyncError: error }).where(eq(saleOrder.soId, localId)).run();
}

/** Receipts not yet on VK Nex, oldest first, with their payment lines. A receipt for a shop still waiting to upload waits for it. */
export function pendingReceipts(): PendingReceipt[] {
  const heads = db
    .select({ header: receipts, customerPending: customers.appPendingUpload })
    .from(receipts)
    .leftJoin(customers, eq(customers.cusId, receipts.avhPartyId))
    .where(eq(receipts.appPendingUpload, true))
    .orderBy(asc(receipts.avhCreatedOn))
    .all();
  const ids = heads.map((h) => h.header.avhClientUuid);
  const lines: (typeof receiptTenders.$inferSelect)[] = [];
  for (let i = 0; i < ids.length; i += 500) {
    lines.push(...db.select().from(receiptTenders).where(inArray(receiptTenders.tdSrcDocId, ids.slice(i, i + 500))).all());
  }
  return heads.map((h) => ({
    header: h.header,
    lines: lines.filter((l) => l.tdSrcDocId === h.header.avhClientUuid),
    customerPending: h.customerPending === true,
  }));
}

/** VK Nex has the receipt (posted now, or before under the same client uuid): keep its id, number and status. */
export function markReceiptSynced(localId: string, created: CreatedReceipt): void {
  db.update(receipts)
    .set({
      avhVoucherId: created.avhVoucherId,
      avhVoucherRefno: created.avhVoucherRefno,
      avhVoucherStatus: created.avhVoucherStatus,
      appSyncedOn: new Date().toISOString(),
      appPendingUpload: false,
      appSyncError: null,
    })
    .where(eq(receipts.avhClientUuid, localId))
    .run();
}

export function markReceiptRefused(localId: string, error: string): void {
  db.update(receipts).set({ appSyncError: error }).where(eq(receipts.avhClientUuid, localId)).run();
}

/**
 * The companies' tenders and open bills, as VK Nex gave them: each company read in full replaces
 * what the phone had for it. Receipts sent in this Sync are already inside VK Nex's figures.
 */
export function saveReceiptData(d: ReceiptData): void {
  if (d.companyIds.length === 0) return;
  db.transaction((tx) => {
    tx.delete(tenders).where(inArray(tenders.companyId, d.companyIds)).run();
    for (let i = 0; i < d.tenders.length; i += CHUNK) tx.insert(tenders).values(d.tenders.slice(i, i + CHUNK)).run();
    tx.delete(openBills).where(inArray(openBills.companyId, d.companyIds)).run();
    for (let i = 0; i < d.bills.length; i += CHUNK) tx.insert(openBills).values(d.bills.slice(i, i + CHUNK)).onConflictDoNothing().run();
  });
}

/** Check-ins not yet on VK Nex, oldest first. */
export function pendingVisits(): PendingVisit[] {
  return db
    .select({ visit: visits, customerName: customers.cusName, customerPending: customers.appPendingUpload })
    .from(visits)
    .leftJoin(customers, eq(customers.cusId, visits.customerId))
    .where(eq(visits.appPendingUpload, true))
    .orderBy(asc(visits.visitedAt))
    .all()
    .map((r) => ({ visit: r.visit, customerName: r.customerName ?? '', customerPending: r.customerPending === true }));
}

export function markVisitSynced(localId: string, created: CreatedVisit): void {
  db.update(visits)
    .set({ appServerId: created.cvId, appSyncedOn: new Date().toISOString(), appPendingUpload: false, appSyncError: null })
    .where(eq(visits.id, localId))
    .run();
}

export function markVisitRefused(localId: string, error: string): void {
  db.update(visits).set({ appSyncError: error }).where(eq(visits.id, localId)).run();
}

/** Orders the Sync page lists as waiting, with the last refusal. */
export const waitingOrdersQuery = () =>
  db
    .select({ id: saleOrder.soId, customerName: saleOrder.soCustName, orderAmt: saleOrder.soOrderAmt, appSyncError: saleOrder.appSyncError })
    .from(saleOrder)
    .where(eq(saleOrder.appPendingUpload, true))
    .orderBy(asc(saleOrder.soCreatedOn));

/** Check-ins the Sync page lists as waiting, with the last refusal. */
export const waitingVisitsQuery = () =>
  db
    .select({ id: visits.id, customerName: customers.cusName, appSyncError: visits.appSyncError })
    .from(visits)
    .leftJoin(customers, eq(customers.cusId, visits.customerId))
    .where(eq(visits.appPendingUpload, true))
    .orderBy(asc(visits.visitedAt));

/** VK Nex's order: by its position (null last), then by name. */
const byPosition = <T extends { name: string; position: number | null }>(list: readonly T[]): T[] =>
  [...list].sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity) || a.name.localeCompare(b.name));

/**
 * Companies, item groups and brands from VK Nex (GET /mobile/items/options), saved as soon as
 * they arrive, so VK Nex's companies show even if reading the items fails afterwards. Each list
 * is replaced by VK Nex's exactly. A company list that comes back empty leaves the phone's.
 */
export function saveItemOptions(o: ItemOptions): void {
  db.transaction((tx) => {
    if (o.companies.length) {
      tx.delete(companies).run();
      tx.insert(companies)
        .values(o.companies.map((c, i) => ({ id: c.id, name: c.name, place: c.place, position: i + 1 })))
        .run();
    }
    tx.delete(itemGroupMaster).run();
    const groups = byPosition(o.itemGroups);
    for (let i = 0; i < groups.length; i += CHUNK) {
      tx.insert(itemGroupMaster)
        .values(groups.slice(i, i + CHUNK).map((g, k) => ({ itgId: g.id, itgName: g.name, itgSort: i + k + 1 })))
        .run();
    }
    tx.delete(itemBrandMaster).run();
    const brands = byPosition(o.brands);
    for (let i = 0; i < brands.length; i += CHUNK) {
      tx.insert(itemBrandMaster)
        .values(brands.slice(i, i + CHUNK).map((b, k) => ({ brandId: b.id, brandName: b.name, brandSort: i + k + 1 })))
        .run();
    }
  });
}

/** Items with every company's prices and stock, replaced in one transaction (never half a price list). */
export function saveItemList(d: ItemDownload): void {
  db.transaction((tx) => {
    tx.delete(itemMaster).run();
    for (let i = 0; i < d.items.length; i += CHUNK) tx.insert(itemMaster).values(d.items.slice(i, i + CHUNK)).run();
    tx.delete(itemUnits).run();
    for (let i = 0; i < d.units.length; i += CHUNK) tx.insert(itemUnits).values(d.units.slice(i, i + CHUNK)).run();
  });
  setMeta('itemsSyncedAt', new Date().toISOString());
}
