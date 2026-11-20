import { and, asc, eq, inArray, or, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { getMeta, setMeta } from '@/db/meta';
import {
  banks,
  beats,
  branches,
  promotionScheme,
  promotionSchemeBranch,
  promotionSchemeItem,
  promotionSchemeParty,
  promotionSchemeSlab,
  companies,
  customerBalances,
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
  receiptAllocations,
  receipts,
  receiptSettings,
  receiptTenders,
  saleBill,
  saleOrder,
  saleOrderItem,
  tenders,
  visits,
} from '@/db/schema';

import { makeDeviceUid } from './device-uid';
import type { BranchRow } from './download-branches';
import type { CompanySchemes } from './download-schemes';
import type { DownloadedCustomer, LocalCustomerFigures } from './download-customers';
import type { ItemDownload } from './download-items';
import type { LedgerDownload } from './download-ledgers';
import type { ServerAddress } from './server-address';
import type { PendingCustomer } from './upload-customers';
import type { PendingOrder } from './upload-orders';
import type { LocalBank, ReceiptData } from './download-receipt-data';
import type { PendingReceipt } from './upload-receipts';
import type { PendingVisit } from './upload-visits';
import type { PendingEdit } from './update-customers';
import type { CreatedOrder, CreatedReceipt, CreatedVisit, CustomerOptions, ItemOptions, MobileMe, ReceiptStatus } from './vk-nex-api';

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
      // cityId comes from VK Nex since 2026-11-19 (offers for a city); an older VK Nex keeps the old one.
      const city = a.cityId === undefined ? {} : { cityId: a.cityId ?? null };
      tx.insert(beats)
        .values({ id: a.id, name: a.name, position: i + 1, ...city })
        .onConflictDoUpdate({ target: beats.id, set: { name: a.name, position: i + 1, ...city } })
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
 * The customers' balance and outstanding from the list Sync just read, replacing the old ones in
 * one go. null (VK Nex read none: the login has no company, or no year holds today) clears them,
 * so the list never shows figures from another company or an old year as current.
 */
export function saveCustomerFigures(rows: readonly LocalCustomerFigures[] | null, syncedOn: string): void {
  db.transaction((tx) => {
    tx.delete(customerBalances).run();
    for (let i = 0; rows && i < rows.length; i += CHUNK) tx.insert(customerBalances).values(rows.slice(i, i + CHUNK)).onConflictDoNothing().run();
  });
  setMeta('customerFiguresSyncedAt', syncedOn);
}

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
  // Lines saved before migration 0015 carry no factor: send the unit's, as Sync keeps it (an
  // iuc row's factor is the item's, the same in every company).
  const unitIds = [...new Set(lines.filter((l) => l.soiToBaseFactor === null).map((l) => l.soiItemUnitId))];
  const unitFactors: Record<string, string> = {};
  for (let i = 0; i < unitIds.length; i += 500) {
    const found = db.select({ iucId: itemUnits.iucId, factor: itemUnits.iucToBaseFactor }).from(itemUnits).where(inArray(itemUnits.iucId, unitIds.slice(i, i + 500))).all();
    for (const u of found) unitFactors[u.iucId] = u.factor;
  }
  return heads.map((h) => ({
    header: h.header,
    lines: lines.filter((l) => l.soiOrderId === h.header.soId),
    customerPending: h.customerPending === true,
    customerPriceLevelId: h.customerPriceLevelId ?? null,
    unitFactors,
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

/**
 * Receipts not yet on VK Nex, oldest first, with their payment lines. A receipt for a shop still
 * waiting to upload waits for it. Whether VK Nex takes a transfer's type is per company, as its
 * options said at the last Sync.
 */
export function pendingReceipts(): PendingReceipt[] {
  const heads = db
    .select({ header: receipts, customerPending: customers.appPendingUpload, takesTransferType: receiptSettings.appTakesTransferType })
    .from(receipts)
    .leftJoin(customers, eq(customers.cusId, receipts.avhPartyId))
    .leftJoin(receiptSettings, eq(receiptSettings.companyId, receipts.avhCompanyId))
    .where(eq(receipts.appPendingUpload, true))
    .orderBy(asc(receipts.avhCreatedOn))
    .all();
  const ids = heads.map((h) => h.header.avhClientUuid);
  const lines: (typeof receiptTenders.$inferSelect)[] = [];
  const allocs: (typeof receiptAllocations.$inferSelect)[] = [];
  for (let i = 0; i < ids.length; i += 500) {
    const part = ids.slice(i, i + 500);
    lines.push(...db.select().from(receiptTenders).where(inArray(receiptTenders.tdSrcDocId, part)).all());
    allocs.push(...db.select().from(receiptAllocations).where(and(inArray(receiptAllocations.ralReceiptId, part), eq(receiptAllocations.ralSource, 'PLANNED'))).all());
  }
  return heads.map((h) => ({
    header: h.header,
    lines: lines.filter((l) => l.tdSrcDocId === h.header.avhClientUuid),
    allocations: allocs.filter((a) => a.ralReceiptId === h.header.avhClientUuid),
    customerPending: h.customerPending === true,
    takesTransferType: h.takesTransferType === true,
  }));
}

const moneyText = (v: string | number | null | undefined): string => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x.toFixed(2) : '0.00';
};

/** VK Nex has the receipt (posted now, or before under the same client uuid): keep its id, number and status. */
export function markReceiptSynced(localId: string, created: CreatedReceipt): void {
  // What VK Nex really did (an older VK Nex answers without it): replaces any earlier POSTED rows.
  const posted = [
    ...(created.allocations ?? []).map((a) => ({
      ralKind: 'BILL',
      ralBillId: a.billId,
      ralBillAccYear: a.billAccYear,
      appDocRefno: a.docRefno ?? null,
      ralAmount: moneyText(a.amount),
      ralDiscount: moneyText(a.discount),
      ralRoundoff: moneyText(a.roundoff),
    })),
    ...(created.creditsApplied ?? []).map((c) => ({
      ralKind: 'CREDIT',
      ralBillId: c.billId,
      ralBillAccYear: c.billAccYear,
      appDocRefno: c.docRefno ?? null,
      ralAmount: moneyText(c.amount),
      ralDiscount: '0',
      ralRoundoff: '0',
    })),
  ];
  db.transaction((tx) => {
    tx.update(receipts)
      .set({
        avhVoucherId: created.avhVoucherId,
        avhVoucherRefno: created.avhVoucherRefno,
        avhVoucherStatus: created.avhVoucherStatus,
        appSyncedOn: new Date().toISOString(),
        appPendingUpload: false,
        appSyncError: null,
        ...(created.employeeId !== undefined ? { avhEmployeeId: created.employeeId } : {}),
        // VK Nex's figure wins over the phone's plan (receipts saved before 0019 keep none).
        ...(created.onAccount !== undefined && created.onAccount !== null && (created.allocations || created.creditsApplied) ? { appOnAccount: moneyText(created.onAccount) } : {}),
        ...(created.adjusted ? { appAdjusted: created.adjusted.length ? JSON.stringify(created.adjusted) : null } : {}),
        ...(created.pdcVouchers ? { appPdc: created.pdcVouchers.length ? JSON.stringify(created.pdcVouchers) : null } : {}),
      })
      .where(eq(receipts.avhClientUuid, localId))
      .run();
    if (created.allocations || created.creditsApplied) {
      tx.delete(receiptAllocations).where(and(eq(receiptAllocations.ralReceiptId, localId), eq(receiptAllocations.ralSource, 'POSTED'))).run();
      if (posted.length) {
        tx.insert(receiptAllocations)
          .values(posted.map((p, i) => ({ ...p, ralId: `${localId}:P${i}`, ralReceiptId: localId, ralSource: 'POSTED', ralCredit: '0' })))
          .run();
      }
    }
    // The receipt no longer counts as unsent, so the open items it settled come down now, as VK
    // Nex has them, until the next full Sync brings its figures (Send now skips that step). Not on
    // a duplicate: VK Nex took it on an earlier try, and those figures may have come since.
    if (!created.duplicate) {
      const settled = posted.length
        ? posted.map((p) => ({ billId: p.ralBillId, accYear: p.ralBillAccYear, paise: toPaise(p.ralAmount) + toPaise(p.ralDiscount) + toPaise(p.ralRoundoff) }))
        : tx
            .select()
            .from(receiptAllocations)
            .where(and(eq(receiptAllocations.ralReceiptId, localId), eq(receiptAllocations.ralSource, 'PLANNED')))
            .all()
            .map((a) => ({
              billId: a.ralBillId,
              accYear: a.ralBillAccYear,
              paise: toPaise(a.ralAmount) + (a.ralKind === 'BILL' ? toPaise(a.ralCredit) + toPaise(a.ralDiscount) + toPaise(a.ralRoundoff) : 0),
            }));
      for (const s of settled) {
        if (s.paise <= 0) continue;
        tx.update(openBills)
          .set({ pendingPaise: sql`max(0, ${openBills.pendingPaise} - ${s.paise})` })
          .where(and(eq(openBills.billId, s.billId), eq(openBills.billAccYear, s.accYear)))
          .run();
      }
    }
  });
}

/** Rupees as exact text → whole paise. */
const toPaise = (v: string | null | undefined): number => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? Math.round(x * 100) : 0;
};

/**
 * GET /mobile/receipts/status: this phone's receipts as VK Nex has them now (cancelled in the
 * office, a post-dated cheque cleared or bounced). Receipts the phone doesn't have, or hasn't
 * sent, are skipped. Returns how many really changed (status, cancellation or a cheque's state),
 * not how many VK Nex listed.
 */
export function applyReceiptStatus(rows: readonly ReceiptStatus[]): number {
  let changed = 0;
  db.transaction((tx) => {
    for (const r of rows) {
      const was = tx
        .select({ status: receipts.avhVoucherStatus, cancelledOn: receipts.appCancelledOn, pdc: receipts.appPdc })
        .from(receipts)
        .where(and(eq(receipts.avhClientUuid, r.avhClientUuid), eq(receipts.appPendingUpload, false)))
        .get();
      if (!was) continue;
      const pdc = r.pdc ? (r.pdc.length ? JSON.stringify(r.pdc) : null) : was.pdc;
      const pdcStates = (json: string | null) => (json ? (JSON.parse(json) as { status?: string }[]).map((p) => p.status ?? '').join(',') : '');
      if ((was.status ?? '') !== (r.avhVoucherStatus ?? '') || (was.cancelledOn ?? null) !== (r.cancelledOn ?? null) || pdcStates(was.pdc) !== pdcStates(pdc)) changed += 1;
      tx.update(receipts)
        .set({
          avhVoucherId: r.avhVoucherId,
          avhVoucherRefno: r.avhVoucherRefno ?? null,
          avhVoucherStatus: r.avhVoucherStatus,
          appCancelledOn: r.cancelledOn ?? null,
          appCancelReason: r.cancelReason ?? null,
          appPdc: pdc,
        })
        .where(eq(receipts.avhClientUuid, r.avhClientUuid))
        .run();
    }
  });
  return changed;
}

/** GET /mobile/me at Sync: the login's employee (the receipts' collector) and rights. */
export function saveMe(me: MobileMe): void {
  setMeta('me', JSON.stringify(me));
}

export function markReceiptRefused(localId: string, error: string): void {
  db.update(receipts).set({ appSyncError: error }).where(eq(receipts.avhClientUuid, localId)).run();
}

/** The receipt's sync note while it is being sent (see RECEIPT_SEND_TRIED), or put back after. */
export function markReceiptTried(localId: string, error: string | null): void {
  db.update(receipts).set({ appSyncError: error }).where(and(eq(receipts.avhClientUuid, localId), eq(receipts.appPendingUpload, true))).run();
}

/** GET /mobile/banks/list at Sync: the bank list for cheques, replaced whole. */
export function saveBanks(rows: readonly LocalBank[]): void {
  db.transaction((tx) => {
    tx.delete(banks).run();
    for (let i = 0; i < rows.length; i += CHUNK) tx.insert(banks).values(rows.slice(i, i + CHUNK)).run();
  });
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
    tx.delete(receiptSettings).where(inArray(receiptSettings.companyId, d.companyIds)).run();
    if (d.settings.length) tx.insert(receiptSettings).values(d.settings).run();
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

/**
 * Every company's branches, replaced in one transaction: all companies were read, or nothing is
 * saved and the phone keeps its old branches.
 */
export function saveBranches(d: { companyIds: readonly string[]; rows: readonly BranchRow[] }): void {
  db.transaction((tx) => {
    tx.delete(branches).run();
    for (let i = 0; i < d.rows.length; i += CHUNK) tx.insert(branches).values(d.rows.slice(i, i + CHUNK)).run();
  });
}

/**
 * Each company's offers, replaced as a whole in one transaction (never half a set): its schemes
 * and their branch, shop, item and band rows go, then what VK Nex sent comes in. Companies not
 * read keep theirs.
 */
export function saveSchemes(sets: readonly CompanySchemes[], syncedOn: string): void {
  db.transaction((tx) => {
    for (const c of sets) {
      const old = tx.select({ id: promotionScheme.prmId }).from(promotionScheme).where(eq(promotionScheme.prmCompId, c.companyId)).all().map((r) => r.id);
      for (let i = 0; i < old.length; i += CHUNK) {
        const ids = old.slice(i, i + CHUNK);
        tx.delete(promotionSchemeBranch).where(inArray(promotionSchemeBranch.prbPrmId, ids)).run();
        tx.delete(promotionSchemeParty).where(inArray(promotionSchemeParty.prpPrmId, ids)).run();
        tx.delete(promotionSchemeItem).where(inArray(promotionSchemeItem.priPrmId, ids)).run();
        tx.delete(promotionSchemeSlab).where(inArray(promotionSchemeSlab.prsPrmId, ids)).run();
      }
      tx.delete(promotionScheme).where(eq(promotionScheme.prmCompId, c.companyId)).run();
      for (let i = 0; i < c.schemes.length; i += CHUNK) tx.insert(promotionScheme).values(c.schemes.slice(i, i + CHUNK)).run();
      for (let i = 0; i < c.branches.length; i += CHUNK) tx.insert(promotionSchemeBranch).values(c.branches.slice(i, i + CHUNK)).run();
      for (let i = 0; i < c.parties.length; i += CHUNK) tx.insert(promotionSchemeParty).values(c.parties.slice(i, i + CHUNK)).run();
      for (let i = 0; i < c.items.length; i += CHUNK) tx.insert(promotionSchemeItem).values(c.items.slice(i, i + CHUNK)).run();
      for (let i = 0; i < c.slabs.length; i += CHUNK) tx.insert(promotionSchemeSlab).values(c.slabs.slice(i, i + CHUNK)).run();
    }
  });
  setMeta('schemesSyncedOn', syncedOn);
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
