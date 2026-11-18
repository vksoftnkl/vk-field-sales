// Pure TypeScript (no React Native imports) so `npm test` can run it in Node.
import { num, toPaise } from '../orders/order-math.ts';
import { billTotals, saleLineAmounts, type BillTotals, type SaleLineAmounts, type SaleLineInput } from '../sales/sale-math.ts';
import { billRefNo, seriesCode } from '../sales/bill-number.ts';
import { parseDMY } from '../../lib/date-range.ts';

/**
 * Sales return amounts and checks (the Qt app's ReturnEntry / ReturnItemDetail). A return line is
 * priced like a bill line with no discount: qty × return price, GST inside the price or on top as
 * VK Nex marks the item, half CGST and half SGST. The credit note is rounded to the rupee like a
 * bill. Damaged and expired goods go to VK Nex's damaged / expired stock, never back on the shelf,
 * so a return does not change the stock the phone sells from.
 */

/** Why the goods came back: VK Nex's sri_condition (and sri_bucket). */
export type ReturnReason = 'DAMAGED' | 'EXPIRED';
export const RETURN_REASONS: readonly ReturnReason[] = ['DAMAGED', 'EXPIRED'];

/** One product on the return, as typed. Dates are as typed, dd-mm-yyyy ('' = none). */
export interface ReturnLine {
  /** Made on the phone when the line is first saved; one unit can be on a return twice (two batches). */
  key: string;
  iucId: string;
  itemId: string;
  name: string;
  nameTa: string | null;
  unitName: string;
  qty: string;
  price: string;
  priceLevel: number;
  mrp: string | null;
  reason: ReturnReason;
  batchNo: string;
  batchDate: string;
  expiryDate: string;
  notes: string;
  /** GST % ('5.000') and whether the price already includes it. */
  taxPerc: string | null;
  inclTax: boolean;
  taxId: string | null;
  hsnCode: string | null;
  /** Base units in one of this unit. */
  factor: string;
}

/** VK Nex's limits: sri_batch_no 100, sri_remarks 250. */
export const BATCH_NO_MAX = 100;
export const RETURN_NOTES_MAX = 250;

const asSaleLine = (l: Pick<ReturnLine, 'qty' | 'price' | 'taxPerc' | 'inclTax'>): SaleLineInput => ({
  qty: l.qty,
  price: l.price,
  discPerc: '',
  discPerUnit: '',
  loadPerUnit: '0',
  freightPerUnit: '0',
  taxPerc: l.taxPerc,
  inclTax: l.inclTax,
});

export const returnLineAmounts = (l: Pick<ReturnLine, 'qty' | 'price' | 'taxPerc' | 'inclTax'>): SaleLineAmounts => saleLineAmounts(asSaleLine(l));

/** The credit note's totals; `lines` is in the same order as the input. */
export const returnTotals = (lines: readonly Pick<ReturnLine, 'qty' | 'price' | 'taxPerc' | 'inclTax'>[]): BillTotals =>
  billTotals(lines.map(asSaleLine), { perc: '', amount: '' });

export type ReturnField = 'qty' | 'price' | 'batchDate' | 'expiryDate';
export type ReturnProblem = 'noQty' | 'noPrice' | 'badDate' | 'future' | 'beforeBatch';

/**
 * What stops Save on Return item, per field (empty = fine). The dates may be left blank; a typed
 * date must be a real one, the batch can't be made after today, and it can't expire before it was made.
 */
export function returnLineProblems(l: Pick<ReturnLine, 'qty' | 'price' | 'batchDate' | 'expiryDate'>, today: string): Partial<Record<ReturnField, ReturnProblem>> {
  const out: Partial<Record<ReturnField, ReturnProblem>> = {};
  if (num(l.qty) <= 0) out.qty = 'noQty';
  if ((toPaise(l.price) ?? 0) <= 0) out.price = 'noPrice';
  const made = l.batchDate.trim() ? parseDMY(l.batchDate) : null;
  const expires = l.expiryDate.trim() ? parseDMY(l.expiryDate) : null;
  if (l.batchDate.trim() && !made) out.batchDate = 'badDate';
  else if (made && made > today) out.batchDate = 'future';
  if (l.expiryDate.trim() && !expires) out.expiryDate = 'badDate';
  else if (made && expires && expires < made) out.expiryDate = 'beforeBatch';
  return out;
}

/** A typed date for the database: 'YYYY-MM-DD', or null when blank or not a date. */
export const isoOrNull = (typed: string): string | null => (typed.trim() ? parseDMY(typed) : null);

/**
 * Credit note numbers made on the phone: the bill series with an R in front, one series per
 * phone, company and financial year, e.g. 'R3F9A/2627/00001'. VK Nex numbers returns per device
 * too, apart from bills, so the R keeps a return from looking like a bill of the same serial.
 */
export const returnRefNo = (deviceUid: string, accYear: string, slno: number): string => billRefNo(`R${seriesCode(deviceUid)}`, accYear, slno);
