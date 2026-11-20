// Pure TypeScript (no React Native imports) so `npm test` can run it in Node.
import { num, toPaise } from '../orders/order-math.ts';
import { billRefNo, seriesCode } from '../sales/bill-number.ts';
import { daysBetween } from '../../lib/money.ts';
import { parseDMY } from '../../lib/date-range.ts';

/**
 * Sales return on the phone (canvas 6b), by the VK Nex desktop Sale Return's rules (menu 13).
 * VK Nex works every rupee out from the bill line at Sync (it ignores money from a client), so
 * everything here is the phone's ESTIMATE, shown as such:
 *  - a line gives back qty in base units × the bill line's taxable value per base unit (after
 *    every discount), plus its GST at the bill line's rates;
 *  - a no-bill line uses the shop's last sale of the item (inside the return window), else today's
 *    price at the shop's level;
 *  - the credit note is the lines rounded to the rupee (VK Nex also gives back freight and loading
 *    by the reason's rule and takes back the bill's cash discount; the phone has neither).
 * The quantity check is VK Nex's too: all parts of one bill line together, in base units, can't
 * pass what is left on it (billed − posted returns).
 */

/** VK Nex's sri_condition. RESTOCK = Good (back to saleable stock). */
export type Condition = 'RESTOCK' | 'DAMAGED' | 'EXPIRED' | 'SCRAP';
export const CONDITIONS: readonly Condition[] = ['RESTOCK', 'DAMAGED', 'EXPIRED', 'SCRAP'];
export const isCondition = (v: string | null | undefined): v is Condition => !!v && (CONDITIONS as readonly string[]).includes(v);

export type RateSource = 'BILL' | 'LAST_SALE' | 'TODAY_PRICE';
export type SettleMode = 'ADJUST' | 'ADVANCE';

/** One part of a returned line as typed: a bill line, or one of its splits, or a no-bill item. */
export interface ReturnPart {
  /** Made on the phone; a split is its own part. */
  key: string;
  /** The bill line it comes back from; null on a no-bill line. */
  billItemId: string | null;
  billAccYear: string | null;
  /** 0 = the bill line itself, 1, 2 … its splits. */
  splitNo: number;
  itemId: string;
  /** The unit (VK Nex's item_unit_conversion id) and base units in one of it. */
  iucId: string;
  unitName: string;
  factor: string;
  name: string;
  nameTa: string | null;
  qty: string;
  condition: Condition;
  notes: string;
  /** Typed only on a no-bill line (a bill line brings its own lot); expiry as dd-mm-yyyy. */
  batchNo: string;
  expiryDate: string;
  /** Estimate inputs: taxable per BASE unit and GST %; igst = IGST rather than CGST + SGST. */
  ratePreTaxBase: string;
  taxPerc: string;
  igst: boolean;
  rateSource: RateSource;
  /** The bill a no-bill line's rate came from (its last sale), for the chip. */
  rateFrom: string | null;
}

/** VK Nex's limits: sri_batch_no 100, sri_remarks 250, sr_usr_refno 100, sr_remarks 250. */
export const BATCH_NO_MAX = 100;
export const RETURN_NOTES_MAX = 250;
export const DEBIT_NOTE_MAX = 100;
export const REMARKS_MAX = 250;

/** Base units in a part (qty × the unit's factor). */
export const baseQty = (p: Pick<ReturnPart, 'qty' | 'factor'>): number => num(p.qty) * (num(p.factor) || 1);

export interface PartAmounts {
  taxablePaise: number;
  taxPaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  netPaise: number;
}

/** One part's estimate, in whole paise (GST rounded per line, as VK Nex does). */
export function partAmounts(p: Pick<ReturnPart, 'qty' | 'factor' | 'ratePreTaxBase' | 'taxPerc' | 'igst'>): PartAmounts {
  const taxablePaise = Math.round(baseQty(p) * num(p.ratePreTaxBase) * 100);
  const taxPaise = Math.round((taxablePaise * num(p.taxPerc)) / 100);
  const cgstPaise = p.igst ? 0 : Math.floor(taxPaise / 2);
  const sgstPaise = p.igst ? 0 : taxPaise - cgstPaise;
  return { taxablePaise, taxPaise, cgstPaise, sgstPaise, igstPaise: p.igst ? taxPaise : 0, netPaise: taxablePaise + taxPaise };
}

export interface ReturnEstimate {
  /** Parts with a quantity. */
  parts: number;
  /** Bill lines / items coming back. */
  lines: number;
  /** Quantity typed (in the parts' own units) and how much of it is good. */
  qty: number;
  goodQty: number;
  taxablePaise: number;
  taxPaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  /** Lines before rounding, the round-off to the rupee, and the credit note. */
  exactPaise: number;
  roundOffPaise: number;
  totalPaise: number;
}

/** The credit note's estimate. Parts without a quantity are left out. */
export function returnEstimate(parts: readonly ReturnPart[]): ReturnEstimate {
  const live = parts.filter((p) => num(p.qty) > 0);
  const sum = { taxablePaise: 0, taxPaise: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0 };
  for (const p of live) {
    const a = partAmounts(p);
    sum.taxablePaise += a.taxablePaise;
    sum.taxPaise += a.taxPaise;
    sum.cgstPaise += a.cgstPaise;
    sum.sgstPaise += a.sgstPaise;
    sum.igstPaise += a.igstPaise;
  }
  const exactPaise = sum.taxablePaise + sum.taxPaise;
  const totalPaise = Math.round(exactPaise / 100) * 100;
  return {
    parts: live.length,
    lines: new Set(live.map(lineKeyOf)).size,
    qty: live.reduce((s, p) => s + num(p.qty), 0),
    goodQty: live.filter((p) => p.condition === 'RESTOCK').reduce((s, p) => s + num(p.qty), 0),
    ...sum,
    exactPaise,
    roundOffPaise: totalPaise - exactPaise,
    totalPaise,
  };
}

/** The line a part belongs to: its bill line, or (no bill) the part itself. */
export const lineKeyOf = (p: Pick<ReturnPart, 'billItemId' | 'billAccYear' | 'key'>): string => (p.billItemId ? `${p.billItemId}|${p.billAccYear ?? ''}` : p.key);

/** What a bill line can still take back, in base units. */
export interface BillLineLeft {
  qtyLeftBase: string;
}

/**
 * How many base units the parts of one bill line ask for, against what is left on it.
 * over > 0: too many (VK Nex would refuse SALES_RETURN_OVER_QTY).
 */
export function lineQtyCheck(parts: readonly Pick<ReturnPart, 'qty' | 'factor'>[], line: BillLineLeft): { askedBase: number; leftBase: number; over: number } {
  const askedBase = Number(parts.reduce((s, p) => s + baseQty(p), 0).toFixed(3));
  const leftBase = num(line.qtyLeftBase);
  return { askedBase, leftBase, over: Math.max(0, Number((askedBase - leftBase).toFixed(3))) };
}

export type PartField = 'qty' | 'expiryDate';
export type PartProblem = 'noQty' | 'badDate';

/** What stops Save on a return line, per part key and field. A typed expiry must be a real date. */
export function partProblems(parts: readonly ReturnPart[]): Record<string, Partial<Record<PartField, PartProblem>>> {
  const out: Record<string, Partial<Record<PartField, PartProblem>>> = {};
  for (const p of parts) {
    const e: Partial<Record<PartField, PartProblem>> = {};
    if (num(p.qty) <= 0) e.qty = 'noQty';
    if (p.expiryDate.trim() && !parseDMY(p.expiryDate)) e.expiryDate = 'badDate';
    if (Object.keys(e).length) out[p.key] = e;
  }
  return out;
}

/** A typed date for the database: 'YYYY-MM-DD', or null when blank or not a date. */
export const isoOrNull = (typed: string): string | null => (typed.trim() ? parseDMY(typed) : null);

/** The next split number for a bill line (0 is the line itself). */
export const nextSplitNo = (parts: readonly Pick<ReturnPart, 'billItemId' | 'billAccYear' | 'key' | 'splitNo'>[], lineKey: string): number =>
  parts.filter((p) => lineKeyOf(p) === lineKey).reduce((m, p) => Math.max(m, p.splitNo + 1), 0);

/** A bill older than the company's return window (0 = no window): VK Nex holds that return for the office. */
export const pastWindow = (billDate: string, today: string, windowDays: number): boolean => windowDays > 0 && daysBetween(billDate, today) > windowDays;

/**
 * Where a new return starts: VK Nex's own rule (sale-return-settlement.ts) — the company's
 * sales.return_settle_default when it is ADVANCE, else ADJUST when the return is against a bill of
 * this branch that still owes money, else ADVANCE. ADJUST needs a bill (VK Nex refuses it without).
 */
export function defaultSettle(settleDefault: string | null | undefined, againstBill: boolean, billDuePaise: number): SettleMode {
  if (settleDefault === 'ADVANCE') return 'ADVANCE';
  return againstBill && billDuePaise > 0 ? 'ADJUST' : 'ADVANCE';
}

/** One open bill the credit note can be set against (from the receipts' open bills). */
export interface AdjustBill {
  billId: string;
  billAccYear: string;
  refno: string;
  pendingPaise: number;
  /** The bill the goods came on: filled first, as on the desktop. */
  isThisBill: boolean;
}

export interface AdjustRow {
  billId: string;
  billAccYear: string;
  refno: string;
  amountPaise: number;
}

/**
 * The desktop's Adjust split: the bill the goods came on first, then the others in VK Nex's order
 * (the order given), each up to what it owes, until the credit note is used. Rows in `typed` keep
 * their amount (capped at the bill), as the desktop's Alt+A leaves typed rows; the rest fill. What
 * is not set off stays with the shop as credit.
 */
export function planAdjust(creditPaise: number, bills: readonly AdjustBill[], typed: ReadonlyMap<string, number> = new Map()): { rows: AdjustRow[]; adjustedPaise: number; leftPaise: number } {
  const keyOf = (b: Pick<AdjustBill, 'billId' | 'billAccYear'>) => `${b.billId}|${b.billAccYear}`;
  const ordered = [...bills.filter((b) => b.isThisBill), ...bills.filter((b) => !b.isThisBill)];
  const amounts = new Map<string, number>();
  let left = creditPaise;
  for (const b of ordered) {
    const t = typed.get(keyOf(b));
    if (t === undefined) continue;
    const a = Math.max(0, Math.min(t, b.pendingPaise, left));
    amounts.set(keyOf(b), a);
    left -= a;
  }
  for (const b of ordered) {
    if (typed.has(keyOf(b))) continue;
    const a = Math.max(0, Math.min(b.pendingPaise, left));
    amounts.set(keyOf(b), a);
    left -= a;
  }
  const rows = ordered.map((b) => ({ billId: b.billId, billAccYear: b.billAccYear, refno: b.refno, amountPaise: amounts.get(keyOf(b)) ?? 0 }));
  const adjustedPaise = rows.reduce((s, r) => s + r.amountPaise, 0);
  return { rows, adjustedPaise, leftPaise: creditPaise - adjustedPaise };
}

/** A typed adjust row that passes its bill or (all rows) the credit note. */
export function adjustProblem(rows: readonly AdjustRow[], bills: readonly AdjustBill[], creditPaise: number): 'overBill' | 'overCredit' | null {
  for (const r of rows) {
    const b = bills.find((x) => x.billId === r.billId && x.billAccYear === r.billAccYear);
    if (b && r.amountPaise > b.pendingPaise) return 'overBill';
  }
  return rows.reduce((s, r) => s + r.amountPaise, 0) > creditPaise ? 'overCredit' : null;
}

/** A rate for a no-bill line from today's price: price per unit (GST inside or on top) → taxable per base unit. */
export function todayRateBase(price: string, factor: string, taxPerc: string, inclTax: boolean): string {
  const perUnit = num(price) / (num(factor) || 1);
  const taxable = inclTax ? perUnit / (1 + num(taxPerc) / 100) : perUnit;
  return taxable.toFixed(4);
}

/**
 * The phone's ref for a return: the bill series with an R in front, one series per phone,
 * company and financial year, e.g. 'R3F9A/2627/00001'. Sent as srMobileRefno; VK Nex gives the
 * return its own SRT number.
 */
export const returnRefNo = (deviceUid: string, accYear: string, slno: number): string => billRefNo(`R${seriesCode(deviceUid)}`, accYear, slno);

/** Paise of a VK Nex money text ('1750.00'); 0 when missing. */
export const moneyPaise = (v: string | number | null | undefined): number => (typeof v === 'number' ? Math.round(v * 100) : (toPaise(v ?? null) ?? 0));
