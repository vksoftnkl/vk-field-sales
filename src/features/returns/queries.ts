import { and, asc, eq, max } from 'drizzle-orm';

import { db } from '@/db/client';
import { beats, customers, saleReturn, saleReturnItem } from '@/db/schema';
import { num, paiseText, qtyText, toPaise } from '@/features/orders/order-math';
import { customerName } from '@/features/orders/queries';
import { accYearOf } from '@/features/sales/bill-number';
import type { SaleCustomer, SaleItemRow } from '@/features/sales/queries';
import { taxRate } from '@/features/sales/sale-math';
import { todayISO } from '@/lib/money';
import { uuidv7 } from '@/lib/uuid';

import { isoOrNull, RETURN_NOTES_MAX, returnRefNo, returnTotals, type ReturnLine } from './return-math';

/** Sales return reads and writes; always local SQLite. Items and prices come from the Sales queries. */

/** The shop on the Sales return card: name, address and beat. */
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

/** A new line for a unit picked on Product list: the customer's price, damaged, no batch yet. */
export function seedReturnLine(r: SaleItemRow, price: { level: number; price: string }): ReturnLine {
  return {
    key: '',
    iucId: r.iucId,
    itemId: r.itemId,
    name: r.itemNameEn,
    nameTa: r.itemNameTa,
    unitName: r.unitName,
    qty: '',
    price: price.price,
    priceLevel: price.level,
    mrp: r.ipmMaxPrice,
    reason: 'DAMAGED',
    batchNo: '',
    batchDate: '',
    expiryDate: '',
    notes: '',
    taxPerc: r.taxPerc,
    inclTax: r.itemInclTax,
    taxId: r.taxId,
    hsnCode: r.itemHsnCode,
    factor: r.factor,
  };
}

/** The number the next credit note of this phone gets in a company, today. */
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

/**
 * Create credit note: the return and its lines in one transaction, numbered in the phone's return
 * series. Lines without a quantity are left out.
 */
export function saveReturn(
  d: { companyId: string; lines: readonly ReturnLine[] },
  c: SaleCustomer,
  userId: string,
  deviceUid: string,
): { srId: string; refNo: string } {
  const lines = d.lines.filter((l) => num(l.qty) > 0);
  if (!lines.length) throw new Error('RETURN_EMPTY');
  const t = returnTotals(lines);
  if (t.totalPaise <= 0) throw new Error('RETURN_NOT_POSITIVE');
  const srId = uuidv7();
  const now = new Date().toISOString();
  const today = todayISO();
  let refNo = '';

  db.transaction((tx) => {
    // Read inside the transaction (one SQLite connection), so two saves never take one number.
    const { accYear, slno, refNo: no } = nextReturnNo(d.companyId, deviceUid, today);
    refNo = no;

    tx.insert(saleReturn)
      .values({
        srId,
        srCompanyId: d.companyId,
        srAccYear: accYear,
        srDeviceType: 'MOBILE',
        srDeviceId: deviceUid,
        srDocType: 'CREDIT_NOTE',
        srReturnSlno: slno,
        srReturnRefno: refNo,
        srReturnDate: today,
        srReturnDatetime: now,
        srIsAgainstBill: false,
        srCustId: c.cusId,
        srCustName: customerName(c),
        srCustGstin: c.cusGstNo,
        srCustStcd: c.cusStateCode,
        srPriceLevel: c.cusPriceLevelId,
        srUserId: userId,
        srTotItems: t.items,
        srTotBags: qtyText(t.qty),
        srGrossAmt: paiseText(t.lines.reduce((s, a) => s + a.grossPaise, 0)),
        srTaxableAmt: paiseText(t.taxablePaise),
        srCgstAmt: paiseText(t.cgstPaise),
        srSgstAmt: paiseText(t.sgstPaise),
        srIgstAmt: '0.00',
        srTaxAmt: paiseText(t.taxPaise),
        srRoundOff: paiseText(t.roundOffPaise),
        srReturnAmt: paiseText(t.totalPaise),
        srSettleMode: 'ADJUST',
        srCreatedOn: now,
        appPendingUpload: true,
      })
      .run();
    tx.insert(saleReturnItem)
      .values(
        lines.map((l, i) => {
          const a = t.lines[i]!;
          const rate = taxRate(l.taxPerc);
          const pricePaise = toPaise(l.price) ?? 0;
          const half = (rate / 2).toFixed(3);
          return {
            sriId: uuidv7(),
            sriReturnId: srId,
            sriLineNo: i + 1,
            sriItemId: l.itemId,
            sriItemUnitId: l.iucId,
            sriToBaseFactor: l.factor,
            sriHsnCode: l.hsnCode,
            sriTaxId: l.taxId,
            sriBatchNo: l.batchNo.trim().toUpperCase() || null,
            sriBatchDate: isoOrNull(l.batchDate),
            sriExpiryDate: isoOrNull(l.expiryDate),
            sriCondition: l.reason,
            sriBucket: l.reason,
            sriReturnQty: qtyText(a.qty),
            sriNetQty: qtyText(a.qty),
            sriRate: paiseText(pricePaise),
            sriRatePreTax: paiseText(l.inclTax && rate > 0 ? Math.round((pricePaise * 100) / (100 + rate)) : pricePaise),
            sriMaxPrice: l.mrp,
            sriPriceLevel: l.priceLevel,
            sriIsTaxIncl: l.inclTax,
            sriRateSource: 'TODAY_PRICE',
            sriGrossAmt: paiseText(a.grossPaise),
            sriTaxableAmt: paiseText(a.taxablePaise),
            sriTaxPerc: rate.toFixed(3),
            sriTaxAmt: paiseText(a.taxPaise),
            sriCgstPerc: half,
            sriCgstAmt: paiseText(a.cgstPaise),
            sriSgstPerc: half,
            sriSgstAmt: paiseText(a.sgstPaise),
            sriIgstPerc: '0',
            sriIgstAmt: '0.00',
            sriNetAmt: paiseText(a.netPaise),
            sriRemarks: l.notes.trim().slice(0, RETURN_NOTES_MAX) || null,
          };
        }),
      )
      .run();
  });
  return { srId, refNo };
}

/** Returns the Sync page lists as kept on the phone. */
export const waitingReturnsQuery = () =>
  db
    .select({ id: saleReturn.srId, customerName: saleReturn.srCustName, refNo: saleReturn.srReturnRefno, amount: saleReturn.srReturnAmt })
    .from(saleReturn)
    .where(eq(saleReturn.appPendingUpload, true))
    .orderBy(asc(saleReturn.srCreatedOn));
