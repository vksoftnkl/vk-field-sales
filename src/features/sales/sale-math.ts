// Pure TypeScript (no React Native imports) so `npm test` can run it in Node.
import { lineAmounts, lineProblem, num, toPaise, type LineInput, type LineProblem } from '../orders/order-math.ts';

/**
 * Bill amounts (Sales). A line starts as on an order: qty × price − item discount (the "value").
 * Then, unlike an order:
 *  - GST: when VK Nex marks the item inclusive of tax (item_incl_tax) the price already holds
 *    it, and the value before tax is value × 100 / (100 + GST %); otherwise GST goes on top.
 *  - The bill discount (% or ₹; the two boxes clear each other) comes off the value before tax,
 *    shared over the lines by that value, so GST is charged on what the shop really pays.
 *  - GST = taxable × GST %, half CGST and half SGST. The phone does not know the company's GST
 *    state yet, so there is no IGST.
 *  - The bill is rounded to the rupee and the round off kept, as the Qt app did.
 * Cooly and freight are not charged on a bill (the Qt app saved them as 0).
 * Money is worked in whole paise, so totals never drift.
 */

export interface SaleLineInput extends LineInput {
  /** GST % as VK Nex sends it ('5.000'); '0.000' when the company is not GST applicable. */
  taxPerc: string | null;
  inclTax: boolean;
}

export interface SaleLineAmounts {
  qty: number;
  /** qty × price. */
  grossPaise: number;
  itemDiscPaise: number;
  /** gross − item discount, as priced (with GST inside when the price includes it). */
  valuePaise: number;
  /** The value before GST and before the bill discount. */
  preTaxPaise: number;
  /** This line's share of the bill discount (before tax). */
  billDiscPaise: number;
  taxablePaise: number;
  taxPaise: number;
  cgstPaise: number;
  sgstPaise: number;
  /** taxable + GST. */
  netPaise: number;
}

/** '5.000' → 5. Junk and negatives are 0. */
export const taxRate = (perc: string | null): number => Math.max(0, num(perc));

/** One line, with its share of the bill discount (0 on Bill item, which shows the line alone). */
export function saleLineAmounts(l: SaleLineInput, billDiscPaise = 0): SaleLineAmounts {
  const a = lineAmounts(l);
  const rate = taxRate(l.taxPerc);
  const valuePaise = a.netPaise;
  const preTaxPaise = l.inclTax && rate > 0 ? Math.round((valuePaise * 100) / (100 + rate)) : valuePaise;
  const taxablePaise = preTaxPaise - billDiscPaise;
  // Without a bill discount an inclusive price stays exactly what was typed.
  const taxPaise = l.inclTax && billDiscPaise === 0 ? valuePaise - preTaxPaise : Math.round((taxablePaise * rate) / 100);
  const cgstPaise = Math.round(taxPaise / 2);
  return {
    qty: a.qty,
    grossPaise: a.grossPaise,
    itemDiscPaise: a.discPaise,
    valuePaise,
    preTaxPaise,
    billDiscPaise,
    taxablePaise,
    taxPaise,
    cgstPaise,
    sgstPaise: taxPaise - cgstPaise,
    netPaise: taxablePaise + taxPaise,
  };
}

/** The bill discount as typed: a % or an amount in rupees (only one is used, the % first). */
export interface BillDiscount {
  perc: string;
  amount: string;
}

export interface BillTotals {
  /** Lines with a quantity. */
  items: number;
  qty: number;
  /** Per input line, in the same order (lines without a quantity are all zero). */
  lines: SaleLineAmounts[];
  itemDiscPaise: number;
  /** Σ value before tax: the bill's "Subtotal". */
  subtotalPaise: number;
  billDiscPaise: number;
  taxablePaise: number;
  taxPaise: number;
  cgstPaise: number;
  sgstPaise: number;
  /** Before rounding. */
  exactPaise: number;
  /** total − exact (−49 … +50 paise). */
  roundOffPaise: number;
  /** Rounded to the rupee. */
  totalPaise: number;
}

/** Rounds to the nearest rupee, halves up (the Qt app's Math.floor(x + 0.5)). */
export const roundToRupee = (paise: number): number => Math.floor((paise + 50) / 100) * 100;

/** The bill discount in paise for a subtotal (before tax). */
export function billDiscountPaise(d: BillDiscount, subtotalPaise: number): number {
  if (d.perc.trim() !== '') return Math.round((subtotalPaise * num(d.perc)) / 100);
  return Math.max(0, toPaise(d.amount) ?? 0);
}

/**
 * Shares `total` paise over `weights` by size; the rounding left over goes to the biggest weight,
 * so the shares always add up to `total`.
 */
export function shareOut(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((s, w) => s + w, 0);
  if (sum <= 0 || total === 0) return weights.map(() => 0);
  const shares = weights.map((w) => Math.round((total * w) / sum));
  const left = total - shares.reduce((s, x) => s + x, 0);
  if (left !== 0) {
    const biggest = weights.reduce((best, w, i) => (w > weights[best]! ? i : best), 0);
    shares[biggest] = (shares[biggest] ?? 0) + left;
  }
  return shares;
}

export function billTotals(lines: readonly SaleLineInput[], discount: BillDiscount): BillTotals {
  const plain = lines.map((l) => saleLineAmounts(l));
  const counted = plain.map((a) => a.qty > 0);
  const subtotalPaise = plain.reduce((s, a, i) => (counted[i] ? s + a.preTaxPaise : s), 0);
  // Never more than the subtotal; billProblem says when the typed discount is too big.
  const billDiscPaise = Math.min(billDiscountPaise(discount, subtotalPaise), Math.max(0, subtotalPaise));
  const shares = shareOut(
    billDiscPaise,
    plain.map((a, i) => (counted[i] ? Math.max(0, a.preTaxPaise) : 0)),
  );
  const amounts = lines.map((l, i) => (counted[i] ? saleLineAmounts(l, shares[i]) : { ...plain[i]!, billDiscPaise: 0 }));

  const t: BillTotals = {
    items: 0,
    qty: 0,
    lines: amounts,
    itemDiscPaise: 0,
    subtotalPaise,
    billDiscPaise,
    taxablePaise: 0,
    taxPaise: 0,
    cgstPaise: 0,
    sgstPaise: 0,
    exactPaise: 0,
    roundOffPaise: 0,
    totalPaise: 0,
  };
  amounts.forEach((a, i) => {
    if (!counted[i]) return;
    t.items += 1;
    t.qty += a.qty;
    t.itemDiscPaise += a.itemDiscPaise;
    t.taxablePaise += a.taxablePaise;
    t.taxPaise += a.taxPaise;
    t.cgstPaise += a.cgstPaise;
    t.sgstPaise += a.sgstPaise;
    t.exactPaise += a.netPaise;
  });
  t.qty = Number(t.qty.toFixed(3));
  t.totalPaise = roundToRupee(t.exactPaise);
  t.roundOffPaise = t.totalPaise - t.exactPaise;
  return t;
}

export type BillProblem = 'discTooBig' | 'notPositive';

/** Why the bill discount can't be taken, or null. */
export function billProblem(d: BillDiscount, t: BillTotals): BillProblem | null {
  if (d.perc.trim() !== '' && num(d.perc) > 100) return 'discTooBig';
  if (t.items > 0 && billDiscountPaise(d, t.subtotalPaise) >= t.subtotalPaise) return 'notPositive';
  return null;
}

/** What Select items, Bill item and Bill need to check a line's stock. */
export interface StockLine {
  iucId: string;
  itemId: string;
  qty: string;
  /** item_unit_conversion.iuc_to_base_factor: base units in one of this unit. */
  factor: string;
  /** Free to sell in this unit: the last Sync's stock less this phone's bills not yet on VK Nex. */
  stockLeft: number;
}

/** Stock left in a unit, after the base quantity this phone has already billed of the item. */
export function stockLeft(syncedQty: string | null, factor: string | null, billedBase: number): number {
  const f = num(factor) > 0 ? num(factor) : 1;
  return Number((num(syncedQty) - billedBase / f).toFixed(3));
}

/**
 * Lines asking for more than there is: the units of one item share its stock, so a bag and a
 * pack of the same rice are counted together (in base units). Selling below zero is not allowed,
 * as in the Qt app with "allow negative stock" off.
 */
export function overStock(lines: readonly StockLine[]): Set<string> {
  const baseOf = (l: StockLine) => num(l.qty) * (num(l.factor) > 0 ? num(l.factor) : 1);
  const byItem = new Map<string, number>();
  for (const l of lines) byItem.set(l.itemId, (byItem.get(l.itemId) ?? 0) + baseOf(l));
  const short = new Set<string>();
  for (const l of lines) {
    if (num(l.qty) <= 0) continue;
    const f = num(l.factor) > 0 ? num(l.factor) : 1;
    if ((byItem.get(l.itemId) ?? 0) > l.stockLeft * f + 1e-6) short.add(l.iucId);
  }
  return short;
}

export type SaleLineProblem = LineProblem | 'noStock';

/** Why Save on Bill item can't take this line, or null: the order rules, then the stock. */
export function saleLineProblem(l: LineInput & StockLine, minPrice: string | null, others: readonly StockLine[]): SaleLineProblem | null {
  const p = lineProblem(l, minPrice);
  if (p) return p;
  return overStock([...others.filter((o) => o.iucId !== l.iucId), l]).has(l.iucId) ? 'noStock' : null;
}
