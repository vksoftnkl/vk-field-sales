import { and, asc, desc, eq, max, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { customers, itemMaster, itemUnits, saleBill, saleBillItem } from '@/db/schema';
import { num, paiseText, qtyText, toPaise } from '@/features/orders/order-math';
import { customerName, orderItemColumns } from '@/features/orders/queries';
import { addDays } from '@/lib/date-range';
import { todayISO } from '@/lib/money';
import { uuidv7 } from '@/lib/uuid';

import { accYearOf, billRefNo, seriesCode } from './bill-number';
import type { SaleLine } from './sale-draft';
import { billTotals, stockLeft, taxRate } from './sale-math';

/** What the Sales screens need about the shop. */
export const saleCustomerQuery = (cusId: string) =>
  db
    .select({
      cusId: customers.cusId,
      cusName: customers.cusName,
      cusShort: customers.cusShort,
      cusCode: customers.cusCode,
      cusPriceLevelId: customers.cusPriceLevelId,
      cusLoadingCharge: customers.cusLoadingCharge,
      cusFreightCharge: customers.cusFreightCharge,
      cusGstNo: customers.cusGstNo,
      cusStateCode: customers.cusStateCode,
      cusCreditDays: customers.cusCreditDays,
    })
    .from(customers)
    .where(eq(customers.cusId, cusId));

export type SaleCustomer = Awaited<ReturnType<ReturnType<typeof saleCustomerQuery>['all']>>[number];

const saleItemColumns = {
  ...orderItemColumns,
  itemInclTax: itemMaster.itemInclTax,
  itemHsnCode: itemMaster.itemHsnCode,
  taxPerc: itemMaster.appTaxPerc,
  taxId: itemMaster.appTaxId,
  factor: itemUnits.iucToBaseFactor,
};

/** Every priced unit of the company, as on Order entry, with tax and the unit's base factor. */
export const saleItemsQuery = (companyId: string) =>
  db
    .select(saleItemColumns)
    .from(itemUnits)
    .innerJoin(itemMaster, eq(itemMaster.itemId, itemUnits.iucItemId))
    .where(and(eq(itemUnits.appCompanyId, companyId), eq(itemUnits.appPriced, true)))
    .orderBy(asc(itemMaster.itemNameEn), desc(itemUnits.iucIsDefaultUnit), asc(itemUnits.appUnitName));

export type SaleItemRow = Awaited<ReturnType<ReturnType<typeof saleItemsQuery>['all']>>[number];

/** One unit, for Bill item. */
export const saleItemQuery = (companyId: string, iucId: string) =>
  db
    .select(saleItemColumns)
    .from(itemUnits)
    .innerJoin(itemMaster, eq(itemMaster.itemId, itemUnits.iucItemId))
    .where(and(eq(itemUnits.appCompanyId, companyId), eq(itemUnits.iucId, iucId)));

/**
 * Base quantity per item on this phone's bills that VK Nex does not have yet, in a company. The
 * stock Sync brings never includes them, so they come off it until VK Nex takes the bills.
 */
export const billedOnPhoneQuery = (companyId: string) =>
  db
    .select({
      itemId: saleBillItem.sbiItemId,
      base: sql<number>`sum(cast(${saleBillItem.sbiBillQty} as real) * cast(${saleBillItem.sbiToBaseFactor} as real))`.mapWith(Number),
    })
    .from(saleBillItem)
    .innerJoin(saleBill, eq(saleBill.sbId, saleBillItem.sbiBillId))
    .where(and(eq(saleBill.sbCompanyId, companyId), eq(saleBill.appPendingUpload, true)))
    .groupBy(saleBillItem.sbiItemId);

/** A new bill line at the customer's price. Cooly and freight are not charged on a bill. */
export function seedSaleLine(r: SaleItemRow, price: { level: number; price: string }, billedBase: number): SaleLine {
  return {
    iucId: r.iucId,
    itemId: r.itemId,
    name: r.itemNameEn,
    nameTa: r.itemNameTa,
    unitName: r.unitName,
    qty: '',
    price: price.price,
    priceLevel: price.level,
    discPerc: '',
    discPerUnit: '',
    loadPerUnit: '0',
    freightPerUnit: '0',
    promo: r.itemAllowPromo,
    allowPromo: r.itemAllowPromo,
    mrp: r.ipmMaxPrice,
    minPrice: r.ipmMinPrice,
    taxPerc: r.taxPerc,
    inclTax: r.itemInclTax,
    taxId: r.taxId,
    hsnCode: r.itemHsnCode,
    factor: r.factor,
    stockLeft: stockLeft(r.stockQty, r.factor, billedBase),
  };
}

/** VK Nex's sb_remarks is 500 long. */
export const BILL_REMARKS_MAX = 500;

/** The number the next bill of this phone gets in a company, today. */
export function nextBillNo(companyId: string, deviceUid: string, today = todayISO()): { accYear: string; slno: number; refNo: string } {
  const accYear = accYearOf(today);
  const last = db
    .select({ n: max(saleBill.sbBillSlno) })
    .from(saleBill)
    .where(and(eq(saleBill.sbCompanyId, companyId), eq(saleBill.sbDeviceId, deviceUid), eq(saleBill.sbAccYear, accYear)))
    .get();
  const slno = (last?.n ?? 0) + 1;
  return { accYear, slno, refNo: billRefNo(seriesCode(deviceUid), accYear, slno) };
}

/**
 * Save bill: the bill and its lines in one transaction, numbered in the phone's series. Lines
 * without a quantity are left out. The shop shows as Billed on the customer list.
 */
export function saveBill(
  d: { customerId: string; companyId: string; lines: readonly SaleLine[]; discPerc: string; discAmount: string; remarks: string },
  c: SaleCustomer,
  userId: string,
  deviceUid: string,
): { sbId: string; refNo: string } {
  const lines = d.lines.filter((l) => num(l.qty) > 0);
  if (!lines.length) throw new Error('BILL_EMPTY');
  const t = billTotals(lines, { perc: d.discPerc, amount: d.discAmount });
  if (t.totalPaise <= 0) throw new Error('BILL_NOT_POSITIVE');
  const sbId = uuidv7();
  const now = new Date().toISOString();
  const today = todayISO();
  const days = c.cusCreditDays > 0 ? c.cusCreditDays : null;
  const cashPerc = t.subtotalPaise > 0 ? ((t.billDiscPaise * 100) / t.subtotalPaise).toFixed(4) : '0';
  let refNo = '';

  db.transaction((tx) => {
    // Read inside the transaction (one SQLite connection), so two saves never take one number.
    const { accYear, slno, refNo: no } = nextBillNo(d.companyId, deviceUid, today);
    refNo = no;

    tx.insert(saleBill)
      .values({
        sbId,
        sbCompanyId: d.companyId,
        sbAccYear: accYear,
        sbDeviceType: 'MOBILE',
        sbDeviceId: deviceUid,
        sbDocType: 'TAX_INVOICE',
        sbBillType: 'CREDIT',
        // VK Nex needs a level on the bill; the customer's, else A (each line keeps its own).
        sbPriceLevel: c.cusPriceLevelId ?? 1,
        sbBillSlno: slno,
        sbBillRefno: refNo,
        sbBillDate: today,
        sbBillDatetime: now,
        sbDueDays: days,
        sbDueDate: days ? addDays(today, days) : null,
        sbCustId: c.cusId,
        sbCustName: customerName(c),
        sbCustGstin: c.cusGstNo,
        sbCustStcd: c.cusStateCode,
        sbHasLoad: c.cusLoadingCharge,
        sbHasFreight: c.cusFreightCharge,
        sbUserId: userId,
        sbTotItems: t.items,
        sbTotBags: qtyText(t.qty),
        sbGrossAmt: paiseText(t.lines.reduce((s, a) => s + a.grossPaise, 0)),
        sbItemDisc: paiseText(t.itemDiscPaise),
        sbCashDisc: paiseText(t.billDiscPaise),
        sbTaxableAmt: paiseText(t.taxablePaise),
        sbCgstAmt: paiseText(t.cgstPaise),
        sbSgstAmt: paiseText(t.sgstPaise),
        sbIgstAmt: '0.00',
        sbTaxAmt: paiseText(t.taxPaise),
        sbRoundOff: paiseText(t.roundOffPaise),
        sbBillAmt: paiseText(t.totalPaise),
        sbCreditAmt: paiseText(t.totalPaise),
        sbBalanceAmt: paiseText(t.totalPaise),
        sbPayStatus: 'UNPAID',
        sbRemarks: d.remarks.trim().slice(0, BILL_REMARKS_MAX) || null,
        sbCreatedOn: now,
        appPendingUpload: true,
      })
      .run();
    tx.insert(saleBillItem)
      .values(
        lines.map((l, i) => {
          const a = t.lines[i]!;
          const rate = taxRate(l.taxPerc);
          const pricePaise = toPaise(l.price) ?? 0;
          const half = (rate / 2).toFixed(3);
          return {
            sbiId: uuidv7(),
            sbiBillId: sbId,
            sbiLineNo: i + 1,
            sbiItemId: l.itemId,
            sbiItemUnitId: l.iucId,
            sbiToBaseFactor: l.factor,
            sbiHsnCode: l.hsnCode,
            sbiPriceLevel: l.priceLevel,
            sbiIsTaxIncl: l.inclTax,
            sbiIsPromo: l.allowPromo && l.promo,
            sbiBillQty: qtyText(a.qty),
            sbiNetQty: qtyText(a.qty),
            sbiAvailableStock: qtyText(l.stockLeft),
            sbiRate: paiseText(pricePaise),
            sbiRatePreTax: paiseText(l.inclTax && rate > 0 ? Math.round((pricePaise * 100) / (100 + rate)) : pricePaise),
            sbiMaxPrice: l.mrp,
            sbiMinPrice: l.minPrice,
            sbiItemDiscPerc: l.discPerc.trim() || '0',
            sbiItemDiscQty: l.discPerUnit.trim() || '0',
            sbiItemDiscAmt: paiseText(a.itemDiscPaise),
            sbiCashDiscPerc: cashPerc,
            sbiCashDiscAmt: paiseText(a.billDiscPaise),
            sbiGrossAmt: paiseText(a.grossPaise),
            sbiTaxId: l.taxId,
            sbiTaxableAmt: paiseText(a.taxablePaise),
            sbiTaxPerc: rate.toFixed(3),
            sbiTaxAmt: paiseText(a.taxPaise),
            sbiCgstPerc: half,
            sbiCgstAmt: paiseText(a.cgstPaise),
            sbiSgstPerc: half,
            sbiSgstAmt: paiseText(a.sgstPaise),
            sbiIgstPerc: '0',
            sbiIgstAmt: '0.00',
            sbiNetAmt: paiseText(a.netPaise),
          };
        }),
      )
      .run();
    tx.update(customers).set({ appBilled: true }).where(eq(customers.cusId, c.cusId)).run();
  });
  return { sbId, refNo };
}

/** Bills the Sync page lists as kept on the phone. */
export const waitingBillsQuery = () =>
  db
    .select({ id: saleBill.sbId, customerName: saleBill.sbCustName, refNo: saleBill.sbBillRefno, amount: saleBill.sbBillAmt })
    .from(saleBill)
    .where(eq(saleBill.appPendingUpload, true))
    .orderBy(asc(saleBill.sbCreatedOn));
