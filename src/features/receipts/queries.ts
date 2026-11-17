import { and, asc, count, eq, max } from 'drizzle-orm';

import { db } from '@/db/client';
import { customers, openBills, receipts, receiptTenders, tenders } from '@/db/schema';
import { paiseText, toPaise } from '@/features/orders/order-math';
import { accYearOf, billRefNo, seriesCode } from '@/features/sales/bill-number';
import { todayISO } from '@/lib/money';
import { uuidv7 } from '@/lib/uuid';

import type { TenderLine } from './receipt-draft';
import { afterReceipts, amountPaise, surchargePaise, type PayableBill } from './receipt-math';

/** A customer's open bills in every company, in VK Nex's order per company (the order it fills them in). */
export const openBillsQuery = (partyId: string) =>
  db
    .select({
      billId: openBills.billId,
      billAccYear: openBills.billAccYear,
      companyId: openBills.companyId,
      docRefno: openBills.docRefno,
      docDate: openBills.docDate,
      dueDate: openBills.dueDate,
      billAmountPaise: openBills.billAmountPaise,
      pendingPaise: openBills.pendingPaise,
      syncedOn: openBills.syncedOn,
    })
    .from(openBills)
    .where(eq(openBills.partyId, partyId))
    .orderBy(asc(openBills.companyId), asc(openBills.seq));

export type OpenBillRow = Awaited<ReturnType<ReturnType<typeof openBillsQuery>['all']>>[number];

/** This phone's receipts for the customer that VK Nex does not have yet, oldest first. */
export const unsentReceiptsQuery = (partyId: string) =>
  db
    .select({ companyId: receipts.avhCompanyId, amount: receipts.avhDocAmount })
    .from(receipts)
    .where(and(eq(receipts.avhPartyId, partyId), eq(receipts.appPendingUpload, true)))
    .orderBy(asc(receipts.avhCreatedOn));

export type UnsentReceiptRow = Awaited<ReturnType<ReturnType<typeof unsentReceiptsQuery>['all']>>[number];

/** A bill on the Receipt screens: VK Nex's figures, with this phone's unsent receipts taken off. */
export type ReceiptBill = OpenBillRow & PayableBill;

/**
 * One company's bills as they stand now: the phone's own unsent receipts fill them oldest first,
 * as VK Nex will when it takes them. Both Receipt screens use this, so their totals agree (the
 * Qt app's did not).
 */
export function billsNow(bills: readonly OpenBillRow[], unsent: readonly UnsentReceiptRow[], companyId: string): ReceiptBill[] {
  const mine = bills.filter((b) => b.companyId === companyId).map((b) => ({ ...b, key: `${b.billId}|${b.billAccYear}` }));
  return afterReceipts(
    mine,
    unsent.filter((r) => r.companyId === companyId).map((r) => toPaise(r.amount) ?? 0),
  );
}

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
      tndSurchargePerc: tenders.tndSurchargePerc,
      tndSurchargeAmount: tenders.tndSurchargeAmount,
    })
    .from(tenders)
    .where(eq(tenders.companyId, companyId))
    .orderBy(asc(tenders.position), asc(tenders.tndName));

export type TenderRow = Awaited<ReturnType<ReturnType<typeof tendersQuery>['all']>>[number];

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

/** VK Nex's td_ref_no is 100 long, td_bank_name 150, avh_remarks 2000. */
export const REF_MAX = 100;
export const BANK_MAX = 150;
export const RECEIPT_REMARKS_MAX = 500;

/**
 * Save receipt: the receipt and its payment lines in one transaction, numbered in the phone's
 * series, waiting for the next Sync. The shop shows as Received on the customer list.
 */
export function saveReceipt(
  d: { customerId: string; customerName: string; companyId: string; amountPaise: number; lines: readonly TenderLine[]; remarks: string },
  userId: string,
  deviceUid: string,
): { id: string; refNo: string } {
  const lines = d.lines.filter((l) => amountPaise(l.amount) > 0);
  if (!lines.length || d.amountPaise <= 0) throw new Error('RECEIPT_EMPTY');
  const id = uuidv7();
  const now = new Date().toISOString();
  const today = todayISO();
  let refNo = '';
  db.transaction((tx) => {
    // Read inside the transaction (one SQLite connection), so two saves never take one number.
    const no = nextReceiptNo(d.companyId, deviceUid, today);
    refNo = no.refNo;
    tx.insert(receipts)
      .values({
        avhClientUuid: id,
        avhCompanyId: d.companyId,
        avhPartyId: d.customerId,
        appPartyName: d.customerName,
        avhVoucherDate: today,
        avhUsrRefno: no.refNo,
        appSlno: no.slno,
        appAccYear: no.accYear,
        avhDeviceId: deviceUid,
        avhDocAmount: paiseText(d.amountPaise),
        avhRemarks: d.remarks.trim().slice(0, RECEIPT_REMARKS_MAX) || null,
        appUserId: userId,
        avhCreatedOn: now,
        appPendingUpload: true,
      })
      .run();
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
          };
        }),
      )
      .run();
    tx.update(customers).set({ appReceived: true }).where(eq(customers.cusId, d.customerId)).run();
  });
  return { id, refNo };
}

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
