import { and, asc, count, desc, eq, gte, lte, max, ne } from 'drizzle-orm';

import { db } from '@/db/client';
import { getMeta } from '@/db/meta';
import { branches, customers, openBills, receiptAllocations, receipts, receiptSettings, receiptTenders, tenders } from '@/db/schema';
import { currentContext } from '@/features/company/company';
import { paiseText } from '@/features/orders/order-math';
import { accYearOf, billRefNo, seriesCode } from '@/features/sales/bill-number';
import { todayISO } from '@/lib/money';
import { uuidv7 } from '@/lib/uuid';

import type { ReceiptDraftState, TenderLine } from './receipt-draft';
import { amountPaise, surchargePaise } from './receipt-math';
import { receiptSendTried } from './receipt-status';
import type { plannedRows } from './receipt-plan';

/** A customer's open items (bills and held credits) in every company, in VK Nex's order per company. */
export const openItemsQuery = (partyId: string) =>
  db
    .select({
      billId: openBills.billId,
      billAccYear: openBills.billAccYear,
      companyId: openBills.companyId,
      kind: openBills.kind,
      docRefno: openBills.docRefno,
      docDate: openBills.docDate,
      dueDate: openBills.dueDate,
      billAmountPaise: openBills.billAmountPaise,
      pendingPaise: openBills.pendingPaise,
      paidPaise: openBills.paidPaise,
      pdcHeldPaise: openBills.pdcHeldPaise,
      ppdSchedule: openBills.ppdSchedule,
      syncedOn: openBills.syncedOn,
    })
    .from(openBills)
    .where(eq(openBills.partyId, partyId))
    .orderBy(asc(openBills.companyId), asc(openBills.seq));

export type OpenItemDbRow = Awaited<ReturnType<ReturnType<typeof openItemsQuery>['all']>>[number];

/** This phone's receipts for the customer that VK Nex does not have yet, oldest first. */
export const unsentReceiptsQuery = (partyId: string) =>
  db
    // onAccount is null only on receipts saved before the desktop-rule receipt (VK Nex fills those oldest first).
    .select({ id: receipts.avhClientUuid, companyId: receipts.avhCompanyId, amount: receipts.avhDocAmount, onAccount: receipts.appOnAccount })
    .from(receipts)
    .where(and(eq(receipts.avhPartyId, partyId), eq(receipts.appPendingUpload, true)))
    .orderBy(asc(receipts.avhCreatedOn));

/** The plans of those receipts (how each settles bills and credits). */
export const unsentPlansQuery = (partyId: string) =>
  db
    .select({
      receiptId: receiptAllocations.ralReceiptId,
      companyId: receipts.avhCompanyId,
      kind: receiptAllocations.ralKind,
      billId: receiptAllocations.ralBillId,
      billAccYear: receiptAllocations.ralBillAccYear,
      amount: receiptAllocations.ralAmount,
      credit: receiptAllocations.ralCredit,
      discount: receiptAllocations.ralDiscount,
      roundoff: receiptAllocations.ralRoundoff,
    })
    .from(receiptAllocations)
    .innerJoin(receipts, eq(receipts.avhClientUuid, receiptAllocations.ralReceiptId))
    .where(and(eq(receipts.avhPartyId, partyId), eq(receipts.appPendingUpload, true), eq(receiptAllocations.ralSource, 'PLANNED')));

/** The company's tenders, as the office orders them. */
export const tendersQuery = (companyId: string) =>
  db
    .select({
      tndId: tenders.tndId,
      tndTypeId: tenders.tndTypeId,
      tndName: tenders.tndName,
      appNeedsRef: tenders.appNeedsRef,
      appRefLabel: tenders.appRefLabel,
      appIsDefault: tenders.appIsDefault,
      appRequiresBank: tenders.appRequiresBank,
      tndSurchargePerc: tenders.tndSurchargePerc,
      tndSurchargeAmount: tenders.tndSurchargeAmount,
    })
    .from(tenders)
    .where(eq(tenders.companyId, companyId))
    .orderBy(asc(tenders.position), asc(tenders.tndName));

export type TenderRow = Awaited<ReturnType<ReturnType<typeof tendersQuery>['all']>>[number];

/** The company's receipt rules from the last Sync (none from an older VK Nex). */
export const receiptSettingsQuery = (companyId: string) => db.select().from(receiptSettings).where(eq(receiptSettings.companyId, companyId));

/** GET /mobile/me as kept at the last Sync. */
export interface MeInfo {
  employeeId: string | null;
  employeeName: string | null;
  /** The Post right on Receipt (menu 99); null = not known (older VK Nex): assumed. */
  receiptPost: boolean | null;
}

export function readMe(userId?: string | null): MeInfo {
  try {
    const me = JSON.parse(getMeta('me') ?? 'null') as {
      userId?: string | null;
      employeeId?: string | null;
      employeeName?: string | null;
      rights?: Record<string, { post?: boolean }> | null;
    } | null;
    // Kept for another login (who synced last, before an offline switch): not known for this one.
    if (userId && me?.userId && me.userId !== userId) return { employeeId: null, employeeName: null, receiptPost: null };
    const post = me?.rights?.['99']?.post;
    return { employeeId: me?.employeeId ?? null, employeeName: me?.employeeName ?? null, receiptPost: typeof post === 'boolean' ? post : null };
  } catch {
    return { employeeId: null, employeeName: null, receiptPost: null };
  }
}

/** The number the next receipt of this phone gets in a company: 'R' + the bill series. */
export function nextReceiptNo(companyId: string, deviceUid: string, today = todayISO()): { accYear: string; slno: number; refNo: string } {
  const accYear = accYearOf(today);
  const last = db
    .select({ n: max(receipts.appSlno) })
    .from(receipts)
    .where(and(eq(receipts.avhCompanyId, companyId), eq(receipts.avhDeviceId, deviceUid), eq(receipts.appAccYear, accYear)))
    .get();
  const slno = (last?.n ?? 0) + 1;
  return { accYear, slno, refNo: `R${billRefNo(seriesCode(deviceUid), accYear, slno)}` };
}

/** VK Nex's td_ref_no is 100 long, td_bank_name 150, avh_remarks 2000, avh_doc_refno 50. */
export const REF_MAX = 100;
export const BANK_MAX = 150;
export const RECEIPT_REMARKS_MAX = 500;
export const DOC_REF_MAX = 50;
export const IFSC_MAX = 11;

export interface ReceiptToSave {
  customerId: string;
  customerName: string;
  companyId: string;
  branchId: string | null;
  amountPaise: number;
  onAccountPaise: number;
  lines: readonly TenderLine[];
  remarks: string;
  docRefno: string;
  docDate: string | null;
  plan: ReturnType<typeof plannedRows>;
  /**
   * The shop had open items on the phone in this company. Without any, the receipt is saved as
   * before the desktop-rule receipt (no plan, no on-account figure) and VK Nex fills the oldest
   * bills it has itself.
   */
  hadItems: boolean;
  /** A receipt VK Nex doesn't have, fixed (Edit): replaced in place, same id and number. */
  editingId: string | null;
}

/**
 * Save receipt: the receipt, its payment lines and its plan in one transaction, numbered in the
 * phone's series, waiting for the next Sync. The shop shows as Received on the customer list.
 * Edit replaces a receipt VK Nex doesn't have in place, keeping its id: if VK Nex did take it
 * after all, the resend is answered as a duplicate and never posted twice.
 */
export function saveReceipt(d: ReceiptToSave, userId: string, deviceUid: string): { id: string; refNo: string } {
  const lines = d.lines.filter((l) => amountPaise(l.amount) > 0);
  // VK Nex refuses a receipt without money, and the lines must be exactly the amount received.
  const linesPaise = lines.reduce((s, l) => s + amountPaise(l.amount), 0);
  if (d.amountPaise <= 0 || !lines.length) throw new Error('RECEIPT_EMPTY');
  if (linesPaise !== d.amountPaise) throw new Error('RECEIPT_LINES_MISMATCH');
  const id = d.editingId ?? uuidv7();
  const now = new Date().toISOString();
  const today = todayISO();
  let refNo = '';
  db.transaction((tx) => {
    const old = d.editingId ? tx.select().from(receipts).where(eq(receipts.avhClientUuid, d.editingId)).get() : undefined;
    if (d.editingId) {
      // VK Nex has it, or may have it (sent once without an answer): it can't be changed here.
      if (!old || !old.appPendingUpload) throw new Error('RECEIPT_ALREADY_SENT');
      if (receiptSendTried(old.appSyncError)) throw new Error('RECEIPT_MAYBE_SENT');
      tx.delete(receiptTenders).where(eq(receiptTenders.tdSrcDocId, id)).run();
      tx.delete(receiptAllocations).where(eq(receiptAllocations.ralReceiptId, id)).run();
      tx.delete(receipts).where(eq(receipts.avhClientUuid, id)).run();
    }
    // Read inside the transaction (one SQLite connection), so two saves never take one number.
    const no = old ? { accYear: old.appAccYear, slno: old.appSlno, refNo: old.avhUsrRefno } : nextReceiptNo(d.companyId, deviceUid, today);
    refNo = no.refNo;
    tx.insert(receipts)
      .values({
        avhClientUuid: id,
        avhCompanyId: d.companyId,
        avhBranchId: d.branchId,
        avhPartyId: d.customerId,
        appPartyName: d.customerName,
        avhVoucherDate: today,
        avhUsrRefno: no.refNo,
        appSlno: no.slno,
        appAccYear: no.accYear,
        avhDeviceId: deviceUid,
        avhDocAmount: paiseText(d.amountPaise),
        avhRemarks: d.remarks.trim().slice(0, RECEIPT_REMARKS_MAX) || null,
        avhDocRefno: d.docRefno.trim().slice(0, DOC_REF_MAX) || null,
        avhDocDate: d.docRefno.trim() ? (d.docDate ?? today) : null,
        appOnAccount: d.hadItems ? paiseText(d.onAccountPaise) : null,
        appUserId: userId,
        avhCreatedOn: now,
        appPendingUpload: true,
      })
      .run();
    if (lines.length) {
      tx.insert(receiptTenders)
        .values(
          lines.map((l, i) => {
            const principal = amountPaise(l.amount);
            const surcharge = surchargePaise(principal, l.surchargePerc, l.surchargeFlat);
            return {
              tdId: uuidv7(),
              tdSrcDocId: id,
              tdRowNo: i + 1,
              tdTenderId: l.tndId,
              tdTenderTypeId: l.typeId,
              appTenderName: l.name,
              // Surcharge inside, as VK Nex takes it; the receipt amount is the principals.
              tdAmount: paiseText(principal + surcharge),
              tdSurchargeAmt: paiseText(surcharge),
              tdRefNo: l.refNo.trim().slice(0, REF_MAX) || null,
              tdBankName: l.bankName.trim().slice(0, BANK_MAX) || null,
              tdInstrumentDate: l.instrumentDate,
              appChequeBranch: l.chequeBranch?.trim().slice(0, BANK_MAX) || null,
              appChequeIfsc: l.chequeIfsc?.trim().toUpperCase().slice(0, IFSC_MAX) || null,
              appChequeDrawer: l.chequeDrawer?.trim().slice(0, BANK_MAX) || null,
            };
          }),
        )
        .run();
    }
    if (d.hadItems && d.plan.length) {
      tx.insert(receiptAllocations)
        .values(
          d.plan.map((p, i) => ({
            ralId: `${id}:${i}`,
            ralReceiptId: id,
            ralSource: 'PLANNED',
            ralKind: p.kind,
            ralBillId: p.billId,
            ralBillAccYear: p.billAccYear,
            appDocRefno: p.docRefno,
            ralAmount: p.amount,
            ralCredit: p.credit,
            ralDiscount: p.discount,
            ralRoundoff: p.roundoff,
          })),
        )
        .run();
    }
    tx.update(customers).set({ appReceived: true }).where(eq(customers.cusId, d.customerId)).run();
  });
  return { id, refNo };
}

/** Delete a receipt VK Nex doesn't have (waiting or sent back); not one sent once without an answer. */
export function deleteReceipt(id: string): void {
  db.transaction((tx) => {
    const r = tx.select({ id: receipts.avhClientUuid, error: receipts.appSyncError }).from(receipts).where(and(eq(receipts.avhClientUuid, id), eq(receipts.appPendingUpload, true))).get();
    if (!r || receiptSendTried(r.error)) return;
    tx.delete(receiptTenders).where(eq(receiptTenders.tdSrcDocId, id)).run();
    tx.delete(receiptAllocations).where(eq(receiptAllocations.ralReceiptId, id)).run();
    tx.delete(receipts).where(eq(receipts.avhClientUuid, id)).run();
  });
}

/** When VK Nex last took one of this phone's receipts (My receipts: "last sent"). */
export const lastReceiptSentQuery = () => db.select({ at: max(receipts.appSyncedOn) }).from(receipts);

/** For the Upload button: receipts still to send. */
export const pendingReceiptsCountQuery = () => db.select({ n: count() }).from(receipts).where(eq(receipts.appPendingUpload, true));

/** Receipts the Sync page lists as waiting, with the last refusal. */
export const waitingReceiptsQuery = () =>
  db
    .select({
      id: receipts.avhClientUuid,
      customerName: receipts.appPartyName,
      refNo: receipts.avhUsrRefno,
      amount: receipts.avhDocAmount,
      appSyncError: receipts.appSyncError,
    })
    .from(receipts)
    .where(eq(receipts.appPendingUpload, true))
    .orderBy(asc(receipts.avhCreatedOn));

/** My receipts: this phone's receipts dated in a range, newest first; with partyId, one shop's only. */
export const myReceiptsQuery = (from: string, to: string, partyId?: string) =>
  db
    .select({
      id: receipts.avhClientUuid,
      customerName: receipts.appPartyName,
      refNo: receipts.avhUsrRefno,
      voucherRefno: receipts.avhVoucherRefno,
      status: receipts.avhVoucherStatus,
      amount: receipts.avhDocAmount,
      date: receipts.avhVoucherDate,
      createdOn: receipts.avhCreatedOn,
      pending: receipts.appPendingUpload,
      syncError: receipts.appSyncError,
      cancelledOn: receipts.appCancelledOn,
    })
    .from(receipts)
    .where(and(gte(receipts.avhVoucherDate, from), lte(receipts.avhVoucherDate, to), partyId ? eq(receipts.avhPartyId, partyId) : undefined))
    .orderBy(desc(receipts.avhCreatedOn));

export type MyReceiptRow = Awaited<ReturnType<ReturnType<typeof myReceiptsQuery>['all']>>[number];

/** The payment lines of the receipts in a range, for the totals by mode (the caller leaves out CANCELLED). */
export const collectionLinesQuery = (from: string, to: string, partyId?: string) =>
  db
    .select({
      receiptId: receiptTenders.tdSrcDocId,
      typeId: receiptTenders.tdTenderTypeId,
      name: receiptTenders.appTenderName,
      amount: receiptTenders.tdAmount,
      surcharge: receiptTenders.tdSurchargeAmt,
      status: receipts.avhVoucherStatus,
    })
    .from(receiptTenders)
    .innerJoin(receipts, eq(receipts.avhClientUuid, receiptTenders.tdSrcDocId))
    .where(and(gte(receipts.avhVoucherDate, from), lte(receipts.avhVoucherDate, to), partyId ? eq(receipts.avhPartyId, partyId) : undefined));

export const receiptQuery = (id: string) => db.select().from(receipts).where(eq(receipts.avhClientUuid, id));
export const receiptLinesQuery = (id: string) => db.select().from(receiptTenders).where(eq(receiptTenders.tdSrcDocId, id)).orderBy(asc(receiptTenders.tdRowNo));
export const receiptAllocsQuery = (id: string) => db.select().from(receiptAllocations).where(eq(receiptAllocations.ralReceiptId, id));

/** Other receipts of the shop today for the same amount (the desktop's warning; never a block). */
export function sameAmountToday(partyId: string, companyId: string, amountPaiseValue: number, exceptId: string | null): number {
  const rows = db
    .select({ id: receipts.avhClientUuid, amount: receipts.avhDocAmount })
    .from(receipts)
    .where(and(eq(receipts.avhPartyId, partyId), eq(receipts.avhCompanyId, companyId), eq(receipts.avhVoucherDate, todayISO())))
    .all();
  return rows.filter((r) => r.id !== exceptId && amountPaise(r.amount) === amountPaiseValue).length;
}

/**
 * The branch a receipt for this company is booked in: the one picked in Switch company when the
 * receipt is for that company, else the company's default branch; null = VK Nex's own rule.
 */
export function receiptBranchFor(companyId: string): string | null {
  const ctx = currentContext();
  if (ctx?.companyId === companyId) return ctx.branchId;
  const b = db
    .select({ id: branches.id })
    .from(branches)
    .where(eq(branches.companyId, companyId))
    .orderBy(desc(branches.isDefault), asc(branches.position))
    .get();
  return b?.id ?? null;
}

/**
 * A sent-back (or waiting) receipt as a draft again (Edit): its amount, payment lines, refs and
 * narration, with its planned bills and credits as typed by hand, so the plan comes back as saved.
 * null when VK Nex already has it.
 */
export function receiptDraftFor(id: string): ReceiptDraftState | null {
  const r = db.select().from(receipts).where(and(eq(receipts.avhClientUuid, id), eq(receipts.appPendingUpload, true))).get();
  if (!r) return null;
  const lines = db.select().from(receiptTenders).where(eq(receiptTenders.tdSrcDocId, id)).orderBy(asc(receiptTenders.tdRowNo)).all();
  const plan = db
    .select()
    .from(receiptAllocations)
    .where(and(eq(receiptAllocations.ralReceiptId, id), eq(receiptAllocations.ralSource, 'PLANNED')))
    .all();
  const tnd = new Map(db.select().from(tenders).where(eq(tenders.companyId, r.avhCompanyId)).all().map((x) => [x.tndId, x]));
  const key = (a: { ralBillId: string; ralBillAccYear: string }) => `${a.ralBillId}|${a.ralBillAccYear}`;
  return {
    customerId: r.avhPartyId,
    companyId: r.avhCompanyId,
    amount: r.avhDocAmount,
    lines: lines.map((l) => {
      const t = tnd.get(l.tdTenderId);
      const surcharge = amountPaise(l.tdSurchargeAmt ?? '');
      return {
        tndId: l.tdTenderId,
        typeId: l.tdTenderTypeId,
        name: l.appTenderName || t?.tndName || '',
        needsRef: t?.appNeedsRef ?? false,
        refLabel: t?.appRefLabel ?? null,
        // Saved with the fee inside; the draft keeps what goes towards the receipt.
        amount: paiseText(Math.max(0, amountPaise(l.tdAmount) - surcharge)),
        refNo: l.tdRefNo ?? '',
        bankName: l.tdBankName ?? '',
        instrumentDate: l.tdInstrumentDate,
        surchargePerc: t?.tndSurchargePerc ?? '0',
        surchargeFlat: t?.tndSurchargeAmount ?? '0',
        chequeBranch: l.appChequeBranch ?? '',
        chequeIfsc: l.appChequeIfsc ?? '',
        chequeDrawer: l.appChequeDrawer ?? '',
      };
    }),
    remarks: r.avhRemarks ?? '',
    typedBills: Object.fromEntries(
      plan.filter((a) => a.ralKind === 'BILL').map((a) => [key(a), { receive: a.ralAmount, discount: a.ralDiscount, roundoff: a.ralRoundoff }]),
    ),
    // Credits as planned; one the shop held then but the plan left unused stays unused.
    typedCredits: Object.fromEntries([
      ...db
        .select({ billId: openBills.billId, accYear: openBills.billAccYear })
        .from(openBills)
        .where(and(eq(openBills.partyId, r.avhPartyId), eq(openBills.companyId, r.avhCompanyId), ne(openBills.kind, 'BILL')))
        .all()
        .map((c) => [`${c.billId}|${c.accYear}`, '0.00']),
      ...plan.filter((a) => a.ralKind === 'CREDIT').map((a) => [key(a), a.ralAmount]),
    ]),
    docRefno: r.avhDocRefno ?? '',
    docDate: r.avhDocDate,
    editingId: r.avhClientUuid,
  };
}
