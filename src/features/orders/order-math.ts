// Pure TypeScript (no React Native imports) so `npm test` can run it in Node.

/**
 * Order amounts, as the Qt app worked them out (OrderItemDetail.qml calcTotal, OrderCheckout.qml):
 *  - line gross  = qty × price
 *  - discount    = gross × disc % + qty × disc ₹ per unit (the two fields clear each other)
 *  - line net    = gross − discount; it must be above zero
 *  - cooly       = qty × the unit's loading charge, only if the customer AND the item take cooly
 *  - freight     = qty × the unit's freight charge, only if the customer AND the item take freight
 *  - order total = Σ line net + Σ cooly + Σ freight
 * Money is worked in whole paise, so totals never drift; VK Nex gets it as text ('168.00').
 */

/** '168.00' → 16800. null for empty or not a number. */
export function toPaise(s: string | null | undefined): number | null {
  if (s === null || s === undefined || s.trim() === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/** 16800 → '168.00' (no grouping: for the database and VK Nex). */
export const paiseText = (p: number): string => (p / 100).toFixed(2);

/** A typed quantity or amount: '' and junk are 0. */
export function num(s: string | null | undefined): number {
  const n = Number((s ?? '').trim());
  return Number.isFinite(n) && (s ?? '').trim() !== '' ? n : 0;
}

/** 12.480 → '12.48', 3 → '3'. */
export const qtyText = (n: number): string => String(Number(n.toFixed(3)));

/** Keeps what a number box may hold: digits and one dot, at most `decimals` after it. */
export function decimalInput(text: string, decimals = 2): string {
  let s = text.replace(/,/g, '.').replace(/[^\d.]/g, '');
  const dot = s.indexOf('.');
  if (dot >= 0) s = s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, '');
  if (decimals === 0) return s.replace('.', '').split('.')[0]!;
  const [whole, frac] = s.split('.');
  return frac === undefined ? whole! : `${whole}.${frac.slice(0, decimals)}`;
}

/** The prices of one unit, as Sync keeps them (item_units). */
export interface UnitPrices {
  ipmSalesPriceA: string | null;
  ipmSalesPriceB: string | null;
  ipmSalesPriceC: string | null;
  ipmSalesPriceD: string | null;
  ipmMaxPrice: string | null;
  ipmMinPrice: string | null;
}

/** VK Nex's price levels: 1-4 sell at price A-D, 5 at the MRP, 6 at the minimum price. */
export function priceForLevel(u: UnitPrices, level: number): string | null {
  const p = [null, u.ipmSalesPriceA, u.ipmSalesPriceB, u.ipmSalesPriceC, u.ipmSalesPriceD, u.ipmMaxPrice, u.ipmMinPrice][level] ?? null;
  return toPaise(p) ? p : null;
}

/** The levels 1-4 this unit has a price for, for the price-level buttons. */
export const pricedLevels = (u: UnitPrices): number[] => [1, 2, 3, 4].filter((l) => priceForLevel(u, l) !== null);

/**
 * The price a new line starts at: the customer's level, else the first level with a price.
 * null = the unit has no price at all (it is not offered).
 */
export function startingPrice(u: UnitPrices, customerLevel: number | null): { level: number; price: string } | null {
  const own = customerLevel ? priceForLevel(u, customerLevel) : null;
  if (own && customerLevel) return { level: customerLevel, price: own };
  const level = pricedLevels(u)[0];
  return level ? { level, price: priceForLevel(u, level)! } : null;
}

/** One line of the order being taken, as typed. Charges per unit are 0 when they don't apply. */
export interface LineInput {
  qty: string;
  price: string;
  discPerc: string;
  /** Discount in rupees per unit (the Qt app's "Disc (qty)"). */
  discPerUnit: string;
  loadPerUnit: string;
  freightPerUnit: string;
}

export interface LineAmounts {
  qty: number;
  grossPaise: number;
  discPaise: number;
  netPaise: number;
  loadPaise: number;
  freightPaise: number;
}

export function lineAmounts(l: LineInput): LineAmounts {
  const qty = num(l.qty);
  const grossPaise = Math.round(qty * (toPaise(l.price) ?? 0));
  const discPaise = Math.round((grossPaise * num(l.discPerc)) / 100) + Math.round(qty * (toPaise(l.discPerUnit) ?? 0));
  return {
    qty,
    grossPaise,
    discPaise,
    netPaise: grossPaise - discPaise,
    loadPaise: Math.round(qty * (toPaise(l.loadPerUnit) ?? 0)),
    freightPaise: Math.round(qty * (toPaise(l.freightPerUnit) ?? 0)),
  };
}

export interface OrderTotals {
  /** Lines with a quantity. */
  items: number;
  qty: number;
  grossPaise: number;
  discPaise: number;
  loadPaise: number;
  freightPaise: number;
  /** Lines + cooly + freight. */
  totalPaise: number;
}

export function orderTotals(lines: readonly LineInput[]): OrderTotals {
  const t: OrderTotals = { items: 0, qty: 0, grossPaise: 0, discPaise: 0, loadPaise: 0, freightPaise: 0, totalPaise: 0 };
  for (const l of lines) {
    const a = lineAmounts(l);
    if (a.qty <= 0) continue;
    t.items += 1;
    t.qty += a.qty;
    t.grossPaise += a.grossPaise;
    t.discPaise += a.discPaise;
    t.loadPaise += a.loadPaise;
    t.freightPaise += a.freightPaise;
  }
  t.qty = Number(t.qty.toFixed(3));
  t.totalPaise = t.grossPaise - t.discPaise + t.loadPaise + t.freightPaise;
  return t;
}

export type LineProblem = 'noQty' | 'noPrice' | 'belowMin' | 'discTooBig' | 'notPositive';

/**
 * Why Save on Order item can't take this line, or null. minPrice is VK Nex's lowest price for the
 * unit ('' or 0 = none).
 */
export function lineProblem(l: LineInput, minPrice: string | null): LineProblem | null {
  if (num(l.qty) <= 0) return 'noQty';
  const price = toPaise(l.price) ?? 0;
  if (price <= 0) return 'noPrice';
  const min = toPaise(minPrice) ?? 0;
  if (min > 0 && price < min) return 'belowMin';
  if (num(l.discPerc) > 100) return 'discTooBig';
  if (lineAmounts(l).netPaise <= 0) return 'notPositive';
  return null;
}
