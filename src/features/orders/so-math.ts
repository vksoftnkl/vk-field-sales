// Pure TypeScript (no React Native imports) so `npm test` can run it in Node.
import { num, toPaise } from './order-math.ts';
import { roundToRupee, taxRate } from '../sales/sale-math.ts';

/**
 * Amounts of a sale order taken on the phone (canvas page "3b · Sale order (new)"):
 *  - gross     = qty × rate
 *  - discount  = one field in one of three modes: % of gross, ₹ per unit, or ₹ for the line
 *  - value     = gross − discount, as priced
 *  - GST       = on top of the value, or already inside it when VK Nex marks the item inclusive
 *                (item_incl_tax): then taxable = value × 100 / (100 + GST %)
 *  - GST split = CGST + SGST, or IGST when the order is inter-state. The phone does not know the
 *                company's GST state yet, so screens pass interState = false (as on Sales).
 *  - line total = taxable + GST; VK Nex's soi_net_amt also holds the line's freight and cooly
 *  - order total = Σ line totals + freight + cooly, rounded to the rupee (round off kept)
 * Freight and cooly go on top, untaxed, as the review screen shows them. Money in whole paise.
 * Totals are an estimate: the office confirms prices and applies schemes.
 */

export type DiscMode = 'perc' | 'perUnit' | 'total';
export const DISC_MODES: readonly DiscMode[] = ['perc', 'perUnit', 'total'];

export interface SoLineInput {
  qty: string;
  /** Rate per unit as typed: before GST, or with GST inside when inclTax. */
  price: string;
  discMode: DiscMode;
  /** The discount as typed, in the mode's terms ('2' = 2 %, ₹2 per unit or ₹2 on the line). */
  disc: string;
  /** '5.000'; '0.000' when the company is not GST applicable. */
  taxPerc: string | null;
  inclTax: boolean;
  /** Per unit; '0' when the customer or the item doesn't take them. */
  loadPerUnit: string;
  freightPerUnit: string;
}

export interface SoLineAmounts {
  qty: number;
  grossPaise: number;
  discPaise: number;
  /** gross − discount, as priced. */
  valuePaise: number;
  taxablePaise: number;
  taxPaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  /** taxable + GST: what the line costs the shop before freight and cooly. */
  lineTotalPaise: number;
  loadPaise: number;
  freightPaise: number;
  /** VK Nex's soi_net_amt: the line total with its freight and cooly. */
  netPaise: number;
}

/** The discount in paise for a gross amount and quantity. Never negative. */
export function discountPaise(mode: DiscMode, disc: string, grossPaise: number, qty: number): number {
  const d = num(disc);
  if (d <= 0) return 0;
  if (mode === 'perc') return Math.round((grossPaise * d) / 100);
  if (mode === 'perUnit') return Math.round(qty * (toPaise(disc) ?? 0));
  return toPaise(disc) ?? 0;
}

export function soLineAmounts(l: SoLineInput, interState = false): SoLineAmounts {
  const qty = num(l.qty);
  const grossPaise = Math.round(qty * (toPaise(l.price) ?? 0));
  const discPaise = discountPaise(l.discMode, l.disc, grossPaise, qty);
  const valuePaise = grossPaise - discPaise;
  const rate = taxRate(l.taxPerc);
  const taxablePaise = l.inclTax && rate > 0 ? Math.round((valuePaise * 100) / (100 + rate)) : valuePaise;
  // An inclusive rate stays exactly what was typed; on top, GST is taxable × rate.
  const taxPaise = l.inclTax ? valuePaise - taxablePaise : Math.round((taxablePaise * rate) / 100);
  const cgstPaise = interState ? 0 : Math.round(taxPaise / 2);
  const sgstPaise = interState ? 0 : taxPaise - cgstPaise;
  const lineTotalPaise = taxablePaise + taxPaise;
  const loadPaise = Math.round(qty * (toPaise(l.loadPerUnit) ?? 0));
  const freightPaise = Math.round(qty * (toPaise(l.freightPerUnit) ?? 0));
  return {
    qty,
    grossPaise,
    discPaise,
    valuePaise,
    taxablePaise,
    taxPaise,
    cgstPaise,
    sgstPaise,
    igstPaise: interState ? taxPaise : 0,
    lineTotalPaise,
    loadPaise,
    freightPaise,
    netPaise: lineTotalPaise + loadPaise + freightPaise,
  };
}

export interface SoTotals {
  /** Lines with a quantity. */
  items: number;
  qty: number;
  grossPaise: number;
  discPaise: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  taxPaise: number;
  freightPaise: number;
  loadPaise: number;
  /** Before rounding. */
  exactPaise: number;
  /** total − exact (−49 … +50 paise). */
  roundOffPaise: number;
  /** Rounded to the rupee. */
  totalPaise: number;
}

export function soTotals(lines: readonly SoLineInput[], interState = false): SoTotals {
  const t: SoTotals = {
    items: 0,
    qty: 0,
    grossPaise: 0,
    discPaise: 0,
    taxablePaise: 0,
    cgstPaise: 0,
    sgstPaise: 0,
    igstPaise: 0,
    taxPaise: 0,
    freightPaise: 0,
    loadPaise: 0,
    exactPaise: 0,
    roundOffPaise: 0,
    totalPaise: 0,
  };
  for (const l of lines) {
    const a = soLineAmounts(l, interState);
    if (a.qty <= 0) continue;
    t.items += 1;
    t.qty += a.qty;
    t.grossPaise += a.grossPaise;
    t.discPaise += a.discPaise;
    t.taxablePaise += a.taxablePaise;
    t.cgstPaise += a.cgstPaise;
    t.sgstPaise += a.sgstPaise;
    t.igstPaise += a.igstPaise;
    t.taxPaise += a.taxPaise;
    t.freightPaise += a.freightPaise;
    t.loadPaise += a.loadPaise;
    t.exactPaise += a.netPaise;
  }
  t.qty = Number(t.qty.toFixed(3));
  t.totalPaise = t.items > 0 ? roundToRupee(t.exactPaise) : 0;
  t.roundOffPaise = t.totalPaise - t.exactPaise;
  return t;
}

export type SoLineProblem = 'noQty' | 'noPrice' | 'belowMin' | 'aboveMrp' | 'discTooBig' | 'notPositive';

/**
 * Why Save line can't take this line, or null. VK Nex does not check the minimum price or the MRP
 * on a phone order, so the phone does (as the Qt screen does). '' / 0 = no minimum / no MRP.
 */
export function soLineProblem(l: SoLineInput, limits: { minPrice: string | null; mrp: string | null }): SoLineProblem | null {
  if (num(l.qty) <= 0) return 'noQty';
  const price = toPaise(l.price) ?? 0;
  if (price <= 0) return 'noPrice';
  const min = toPaise(limits.minPrice) ?? 0;
  if (min > 0 && price < min) return 'belowMin';
  const mrp = toPaise(limits.mrp) ?? 0;
  if (mrp > 0 && price > mrp) return 'aboveMrp';
  if (l.discMode === 'perc' && num(l.disc) > 100) return 'discTooBig';
  if (soLineAmounts(l).valuePaise <= 0) return 'notPositive';
  return null;
}

/**
 * How much of a quantity would be a back-order: the part above the stock as of the last Sync.
 * Stock never blocks an order (VK Nex allows back-orders, as the Qt screen does); 0 = none.
 */
export function backOrderQty(qty: number, stock: number): number {
  if (qty <= 0) return 0;
  return Number(Math.max(0, qty - Math.max(0, stock)).toFixed(3));
}

/** 'Box' of 12 'Pouch': how many default units one unit holds, from VK Nex's base factors. */
export function unitsPerDefault(factor: string | number | null, defaultFactor: string | number | null): number {
  const f = num(String(factor ?? ''));
  const d = num(String(defaultFactor ?? ''));
  return f > 0 && d > 0 ? Number((f / d).toFixed(3)) : 1;
}
