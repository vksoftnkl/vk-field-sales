import { and, asc, desc, eq, gt, gte, inArray, lte, max, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import {
  beats,
  customers,
  itemMaster,
  openBills,
  returnBillLines,
  returnBills,
  returnGodowns,
  returnReasons,
  returnSettings,
  saleReturn,
  saleReturnItem,
} from '@/db/schema';
import { num, paiseText, qtyText } from '@/features/orders/order-math';
import { customerName } from '@/features/orders/queries';
import { accYearOf } from '@/features/sales/bill-number';
import type { SaleCustomer } from '@/features/sales/queries';
import { toDMY } from '@/lib/date-range';
import { todayISO } from '@/lib/money';
import { uuidv7 } from '@/lib/uuid';

import type { ReturnDraftState } from './return-draft';
import { baseQty, isCondition, isoOrNull, partAmounts, REMARKS_MAX, RETURN_NOTES_MAX, returnEstimate, returnRefNo, type ReturnPart, type SettleMode } from './return-math';

/** Sales return reads and writes (canvas 6b); always local SQLite. */

/** The shop on the return: name, address and beat. */
export const returnCustomerQuery = (cusId: string) =>
  db
    .select({
      cusId: customers.cusId,
      cusName: customers.cusName,
      cusShort: customers.cusShort,
      cusCode: customers.cusCode,
      cusAddr1: customers.cusAddr1,
      cusAddr2: customers.cusAddr2,
      cusAddr3: customers.cusAddr3,
      cusCity: customers.cusCity,
      cusPin: customers.cusPin,
      cusPriceLevelId: customers.cusPriceLevelId,
      beatName: beats.name,
    })
    .from(customers)
    .leftJoin(beats, eq(beats.id, customers.cusAreaId))
    .where(eq(customers.cusId, cusId));

/** The shop's posted bills a return can come back on, newest first (from Sync). */
export const shopReturnBillsQuery = (custId: string, companyId: string) =>
  db
    .select()
    .from(returnBills)
    .where(and(eq(returnBills.custId, custId), eq(returnBills.companyId, companyId)))
    .orderBy(desc(returnBills.billDate), desc(returnBills.refno));

/** How many lines each of the shop's bills has, and how many can still come back. */
export const shopBillLineCountsQuery = (custId: string, companyId: string) =>
  db
    .select({
      sbId: returnBillLines.sbId,
      accYear: returnBillLines.sbAccYear,
      lines: sql<number>`count(*)`.mapWith(Number),
      open: sql<number>`sum(case when cast(${returnBillLines.qtyLeftBase} as real) > 0 and ${returnBillLines.allowReturn} = 1 then 1 else 0 end)`.mapWith(Number),
      itemNames: sql<string>`group_concat(lower(coalesce(${returnBillLines.itemName}, '')), ' ')`,
    })
    .from(returnBillLines)
    .innerJoin(returnBills, and(eq(returnBills.sbId, returnBillLines.sbId), eq(returnBills.accYear, returnBillLines.sbAccYear)))
    .where(and(eq(returnBills.custId, custId), eq(returnBills.companyId, companyId)))
    .groupBy(returnBillLines.sbId, returnBillLines.sbAccYear);

/** One bill's lines, in bill order, with the item's Tamil name. */
export const billLinesQuery = (sbId: string, accYear: string) =>
  db
    .select({ line: returnBillLines, nameEn: itemMaster.itemNameEn, nameTa: itemMaster.itemNameTa })
    .from(returnBillLines)
    .leftJoin(itemMaster, eq(itemMaster.itemId, returnBillLines.itemId))
    .where(and(eq(returnBillLines.sbId, sbId), eq(returnBillLines.sbAccYear, accYear)))
    .orderBy(asc(returnBillLines.lineNo));

export type BillLineRow = Awaited<ReturnType<ReturnType<typeof billLinesQuery>['all']>>[number];

/**
 * The shop's paid lines of these items on its synced bills, newest first: a no-bill line's rate
 * (VK Nex's LAST_SALE) and the "it is on bill …" hint.
 */
export const shopItemSalesQuery = (custId: string, companyId: string, itemIds: readonly string[]) =>
  db
    .select({ line: returnBillLines, refno: returnBills.refno, billDate: returnBills.billDate })
    .from(returnBillLines)
    .innerJoin(returnBills, and(eq(returnBills.sbId, returnBillLines.sbId), eq(returnBills.accYear, returnBillLines.sbAccYear)))
    .where(and(eq(returnBills.custId, custId), eq(returnBills.companyId, companyId), inArray(returnBillLines.itemId, [...itemIds]), eq(returnBillLines.isFree, false)))
    .orderBy(desc(returnBills.billDate), desc(returnBills.refno));

/** VK Nex's return reasons for a company (claim reasons stay in the office). */
export const returnReasonsQuery = (companyId: string) =>
  db
    .select()
    .from(returnReasons)
    .where(and(eq(returnReasons.companyId, companyId), eq(returnReasons.isClaim, false)))
    .orderBy(asc(returnReasons.sortOrder), asc(returnReasons.name));

export const returnSettingsQuery = (companyId: string) => db.select().from(returnSettings).where(eq(returnSettings.companyId, companyId));

/** The branch's godowns, the default first. */
export const returnGodownsQuery = (companyId: string) =>
  db.select().from(returnGodowns).where(eq(returnGodowns.companyId, companyId)).orderBy(desc(returnGodowns.isDefault), asc(returnGodowns.position), asc(returnGodowns.name));

/** The shop's open bills a credit note can be set against, in VK Nex's order (from the receipts' Sync). */
export const adjustBillsQuery = (custId: string, companyId: string) =>
  db
    .select({ billId: openBills.billId, billAccYear: openBills.billAccYear, refno: openBills.docRefno, date: openBills.docDate, dueDate: openBills.dueDate, pendingPaise: openBills.pendingPaise })
    .from(openBills)
    .where(and(eq(openBills.partyId, custId), eq(openBills.companyId, companyId), eq(openBills.kind, 'BILL'), gt(openBills.pendingPaise, 0)))
    .orderBy(asc(openBills.seq));

/** One saved return and its lines (with the item's Tamil name). */
export const returnRowQuery = (srId: string) => db.select().from(saleReturn).where(eq(saleReturn.srId, srId));
export const returnItemsQuery = (srId: string) =>
  db
    .select({ item: saleReturnItem, nameEn: itemMaster.itemNameEn, nameTa: itemMaster.itemNameTa })
    .from(saleReturnItem)
    .leftJoin(itemMaster, eq(itemMaster.itemId, saleReturnItem.sriItemId))
    .where(eq(saleReturnItem.sriReturnId, srId))
    .orderBy(asc(saleReturnItem.sriLineNo));

/** This phone's returns between two dates (one shop's, or every shop's), newest first. */
export const phoneReturnsQuery = (custId: string | null, from: string, to: string) =>
  db
    .select()
    .from(saleReturn)
    .where(and(custId ? eq(saleReturn.srCustId, custId) : undefined, gte(saleReturn.srReturnDate, from), lte(saleReturn.srReturnDate, to)))
    .orderBy(desc(saleReturn.srCreatedOn));

/** Every line of the returns not posted yet (one shop's, or all): the goods still in the van. */
export const vanGoodsQuery = (custId: string | null) =>
  db
    .select({ condition: saleReturnItem.sriCondition, qty: saleReturnItem.sriReturnQty, unit: saleReturnItem.appUnitName })
    .from(saleReturnItem)
    .innerJoin(saleReturn, eq(saleReturn.srId, saleReturnItem.sriReturnId))
    .where(and(custId ? eq(saleReturn.srCustId, custId) : undefined, inArray(saleReturn.appStatus, ['WAITING', 'HELD', 'SENT_BACK'])));

/** Good and other quantities of each return (for the list rows). */
export const returnQtyByConditionQuery = (ids: readonly string[]) =>
  db
    .select({ id: saleReturnItem.sriReturnId, condition: saleReturnItem.sriCondition, qty: saleReturnItem.sriReturnQty })
    .from(saleReturnItem)
    .where(inArray(saleReturnItem.sriReturnId, [...ids]));

/** Returns waiting to be sent (every shop). */
export const pendingReturnsCountQuery = () =>
  db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(saleReturn)
    .where(eq(saleReturn.appPendingUpload, true));

/** When this phone last heard from VK Nex about a return. */
export const lastReturnSentQuery = () => db.select({ at: max(saleReturn.appSyncedOn) }).from(saleReturn);

/** Returns the Sync page lists: waiting to send, or sent back. */
export const waitingReturnsQuery = () =>
  db
    .select({ id: saleReturn.srId, customerName: saleReturn.srCustName, refNo: saleReturn.srReturnRefno, amount: saleReturn.srReturnAmt, status: saleReturn.appStatus })
    .from(saleReturn)
    .where(inArray(saleReturn.appStatus, ['WAITING', 'SENT_BACK']))
    .orderBy(asc(saleReturn.srCreatedOn));

/** The number the next return of this phone gets in a company, today. */
export function nextReturnNo(companyId: string, deviceUid: string, today = todayISO()): { accYear: string; slno: number; refNo: string } {
  const accYear = accYearOf(today);
  const last = db
    .select({ n: max(saleReturn.srReturnSlno) })
    .from(saleReturn)
    .where(and(eq(saleReturn.srCompanyId, companyId), eq(saleReturn.srDeviceId, deviceUid), eq(saleReturn.srAccYear, accYear)))
    .get();
  const slno = (last?.n ?? 0) + 1;
  return { accYear, slno, refNo: returnRefNo(deviceUid, accYear, slno) };
}

/** VK Nex's stock bucket for a condition (sale-return-preview.ts). */
const BUCKET: Record<string, string> = { RESTOCK: 'SALEABLE', DAMAGED: 'DAMAGED', EXPIRED: 'EXPIRED', SCRAP: 'QUARANTINE' };

/** Where a saved return can still be changed on the phone. */
export const canEditOnPhone = (status: string | null | undefined): boolean => status === 'WAITING' || status === 'SENT_BACK';

/**
 * Save return: the return and its lines in one transaction. A new one is numbered in the phone's
 * R series; an edited one (draft.editingId) keeps its id and number and goes back to waiting.
 * Money is the phone's estimate; VK Nex works it out again at Sync.
 */
export function saveReturnDraft(
  d: ReturnDraftState,
  c: SaleCustomer,
  o: { userId: string; deviceUid: string; reasonName: string | null; settleMode: SettleMode; adjust: ReturnDraftState['adjust'] },
): { srId: string; refNo: string } {
  const parts = d.parts.filter((p) => num(p.qty) > 0);
  if (!d.companyId || !parts.length) throw new Error('RETURN_EMPTY');
  if (!d.reasonId) throw new Error('RETURN_NO_REASON');
  const companyId = d.companyId;
  const e = returnEstimate(parts);
  const now = new Date().toISOString();
  const today = todayISO();
  let srId = d.editingId ?? uuidv7();
  let refNo = '';

  db.transaction((tx) => {
    const was = d.editingId ? tx.select().from(saleReturn).where(eq(saleReturn.srId, d.editingId)).get() : undefined;
    if (d.editingId && (!was || !canEditOnPhone(was.appStatus))) throw new Error('RETURN_NOT_EDITABLE');
    // Read inside the transaction (one SQLite connection), so two saves never take one number.
    const no = was ? { accYear: was.srAccYear, slno: was.srReturnSlno, refNo: was.srReturnRefno } : nextReturnNo(companyId, o.deviceUid, today);
    refNo = no.refNo;
    srId = was?.srId ?? srId;
    const header = {
      srCompanyId: companyId,
      srAccYear: no.accYear,
      srDeviceType: 'MOBILE',
      srDeviceId: o.deviceUid,
      srDocType: 'CREDIT_NOTE',
      srReturnSlno: no.slno,
      srReturnRefno: no.refNo,
      srReturnDate: was?.srReturnDate ?? today,
      srReturnDatetime: was?.srReturnDatetime ?? now,
      srIsAgainstBill: !!d.bill,
      srCustId: c.cusId,
      srCustName: customerName(c),
      srCustGstin: c.cusGstNo,
      srCustStcd: c.cusStateCode,
      srPriceLevel: c.cusPriceLevelId,
      srUserId: o.userId,
      srTotItems: e.lines,
      srTotBags: qtyText(e.qty),
      srGrossAmt: paiseText(e.taxablePaise),
      srTaxableAmt: paiseText(e.taxablePaise),
      srCgstAmt: paiseText(e.cgstPaise),
      srSgstAmt: paiseText(e.sgstPaise),
      srIgstAmt: paiseText(e.igstPaise),
      srTaxAmt: paiseText(e.taxPaise),
      srRoundOff: paiseText(e.roundOffPaise),
      srReturnAmt: paiseText(e.totalPaise),
      srSettleMode: o.settleMode,
      srCreatedOn: was?.srCreatedOn ?? now,
      appPendingUpload: true,
      appSyncError: null,
      srBranchId: d.branchId,
      srBillId: d.bill?.sbId ?? null,
      srBillAccYear: d.bill?.accYear ?? null,
      appBillRefno: d.bill?.refno ?? null,
      appBillDate: d.bill?.date ?? null,
      srReasonId: d.reasonId,
      srReturnReason: o.reasonName,
      srGodownId: d.godownId,
      srUsrRefno: d.usrRefno.trim().slice(0, 100) || null,
      srUsrRefdate: d.usrRefno.trim() ? isoOrNull(d.usrRefdate) : null,
      srRemarks: d.remarks.trim().slice(0, REMARKS_MAX) || null,
      appAdjust: o.settleMode === 'ADJUST' && o.adjust ? JSON.stringify(o.adjust.map((r) => ({ billId: r.billId, billAccYear: r.billAccYear, refno: r.refno, amount: paiseText(r.amountPaise) }))) : null,
      appStatus: 'WAITING',
      appVkNote: null,
    };
    if (was) {
      tx.update(saleReturn).set(header).where(eq(saleReturn.srId, srId)).run();
      tx.delete(saleReturnItem).where(eq(saleReturnItem.sriReturnId, srId)).run();
    } else {
      tx.insert(saleReturn)
        .values({ srId, ...header })
        .run();
    }
    tx.insert(saleReturnItem)
      .values(
        parts.map((p, i) => {
          const a = partAmounts(p);
          const factor = num(p.factor) || 1;
          const perUnit = (num(p.ratePreTaxBase) * factor).toFixed(4);
          const perc = num(p.taxPerc);
          const half = p.igst ? '0' : (perc / 2).toFixed(3);
          return {
            sriId: uuidv7(),
            sriReturnId: srId,
            sriLineNo: i + 1,
            sriItemId: p.itemId,
            sriItemUnitId: p.iucId,
            sriToBaseFactor: String(factor),
            sriBatchNo: d.bill ? null : p.batchNo.trim().toUpperCase().slice(0, 100) || null,
            sriExpiryDate: d.bill ? null : isoOrNull(p.expiryDate),
            sriCondition: p.condition,
            sriBucket: BUCKET[p.condition] ?? 'DAMAGED',
            sriReturnQty: qtyText(num(p.qty)),
            sriNetQty: qtyText(baseQty(p)),
            sriRate: perUnit,
            sriRatePreTax: perUnit,
            sriPriceLevel: c.cusPriceLevelId ?? 1,
            sriIsTaxIncl: false,
            sriRateSource: p.rateSource,
            sriGrossAmt: paiseText(a.taxablePaise),
            sriTaxableAmt: paiseText(a.taxablePaise),
            sriTaxPerc: perc.toFixed(3),
            sriTaxAmt: paiseText(a.taxPaise),
            sriCgstPerc: half,
            sriCgstAmt: paiseText(a.cgstPaise),
            sriSgstPerc: half,
            sriSgstAmt: paiseText(a.sgstPaise),
            sriIgstPerc: p.igst ? perc.toFixed(3) : '0',
            sriIgstAmt: paiseText(a.igstPaise),
            sriNetAmt: paiseText(a.netPaise),
            sriRemarks: p.notes.trim().slice(0, RETURN_NOTES_MAX) || null,
            sriBillItemId: p.billItemId,
            sriBillAccYear: p.billAccYear,
            sriSplitNo: p.splitNo,
            appUnitName: p.unitName,
            appItemName: p.name,
          };
        }),
      )
      .run();
  });
  return { srId, refNo };
}

/** A saved return as a draft again (Edit on a waiting or sent-back return). */
export function draftOfSaved(srId: string): Omit<ReturnDraftState, 'startedFor'> | null {
  const h = returnRowQuery(srId).get();
  if (!h || !canEditOnPhone(h.appStatus)) return null;
  const items = returnItemsQuery(srId).all();
  const parts: ReturnPart[] = items.map(({ item: i, nameEn, nameTa }) => {
    const factor = num(i.sriToBaseFactor) || 1;
    return {
      key: i.sriId,
      billItemId: i.sriBillItemId,
      billAccYear: i.sriBillAccYear,
      splitNo: i.sriSplitNo,
      itemId: i.sriItemId,
      iucId: i.sriItemUnitId,
      unitName: i.appUnitName ?? '',
      factor: String(factor),
      name: i.appItemName ?? nameEn ?? '',
      nameTa,
      qty: i.sriReturnQty,
      condition: isCondition(i.sriCondition) ? i.sriCondition : 'DAMAGED',
      notes: i.sriRemarks ?? '',
      batchNo: i.sriBatchNo ?? '',
      expiryDate: i.sriExpiryDate ? toDMY(i.sriExpiryDate) : '',
      ratePreTaxBase: (num(i.sriRatePreTax) / factor).toFixed(4),
      taxPerc: i.sriTaxPerc,
      igst: num(i.sriIgstPerc) > 0,
      rateSource: i.sriRateSource === 'BILL' || i.sriRateSource === 'LAST_SALE' ? i.sriRateSource : 'TODAY_PRICE',
      rateFrom: null,
    };
  });
  const adjust = h.appAdjust
    ? (JSON.parse(h.appAdjust) as { billId: string; billAccYear: string; refno: string; amount: string }[]).map((r) => ({ ...r, amountPaise: Math.round(num(r.amount) * 100) }))
    : null;
  return {
    editingId: h.srId,
    customerId: h.srCustId,
    companyId: h.srCompanyId,
    branchId: h.srBranchId,
    bill: h.srBillId && h.srBillAccYear ? { sbId: h.srBillId, accYear: h.srBillAccYear, refno: h.appBillRefno ?? '', date: h.appBillDate ?? '' } : null,
    noBill: !h.srBillId,
    reasonId: h.srReasonId,
    parts,
    settleMode: h.srSettleMode === 'ADJUST' || h.srSettleMode === 'ADVANCE' ? h.srSettleMode : null,
    adjust,
    godownId: h.srGodownId,
    usrRefno: h.srUsrRefno ?? '',
    usrRefdate: h.srUsrRefdate ? toDMY(h.srUsrRefdate) : '',
    remarks: h.srRemarks ?? '',
  };
}

/**
 * Delete a return VK Nex has never had (waiting, never sent; or an old page-6 return). A return
 * that reached VK Nex as a draft is deleted there first (sync/return-actions.ts).
 */
export function deleteLocalReturn(srId: string): void {
  db.transaction((tx) => {
    const h = tx.select({ status: saleReturn.appStatus, note: saleReturn.appSyncError }).from(saleReturn).where(eq(saleReturn.srId, srId)).get();
    if (!h) return;
    if (h.status !== 'WAITING' && h.status !== 'OLD' && h.status !== 'SENT_BACK') throw new Error('RETURN_NOT_DELETABLE');
    tx.delete(saleReturnItem).where(eq(saleReturnItem.sriReturnId, srId)).run();
    tx.delete(saleReturn).where(eq(saleReturn.srId, srId)).run();
  });
}

/** Send again on a sent-back return: it waits for the next Sync (or Send now) unchanged. */
export function queueReturnAgain(srId: string): void {
  db.update(saleReturn)
    .set({ appPendingUpload: true, appStatus: 'WAITING' })
    .where(and(eq(saleReturn.srId, srId), eq(saleReturn.appStatus, 'SENT_BACK')))
    .run();
}
