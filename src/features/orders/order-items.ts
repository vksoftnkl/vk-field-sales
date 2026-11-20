// Pure TypeScript (no React Native imports) so `npm test` can run it in Node.
import { num } from './order-math.ts';

/** The fields Order entry searches and filters on. */
export interface SearchableItem {
  itemCode: string | null;
  itemNameEn: string;
  itemNameTa: string | null;
  itemGroupId: string;
  itemBrandId: string | null;
}

/**
 * Order entry's search and filter: every typed word must be in the code, the English name or the
 * Tamil name ("rice 25" finds "Ponni Raw Rice 25 kg"); groups / brands [] = all.
 */
export function filterOrderItems<T extends SearchableItem>(
  rows: readonly T[],
  query: string,
  groupIds: readonly string[],
  brandIds: readonly string[],
): T[] {
  const words = searchWords(query);
  return rows.filter((r) => {
    if (groupIds.length && !groupIds.includes(r.itemGroupId)) return false;
    if (brandIds.length && !(r.itemBrandId && brandIds.includes(r.itemBrandId))) return false;
    if (!words.length) return true;
    const text = `${r.itemCode ?? ''} ${r.itemNameEn} ${r.itemNameTa ?? ''}`.toLocaleLowerCase();
    return words.every((w) => text.includes(w));
  });
}

/** The typed search as lower-case words (the item lists' SQL search uses the same words). */
export const searchWords = (query: string): string[] => query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);

/** The name to show: Tamil when the app is in Tamil and the item has one (the Qt app showed Tamil always: a bug). */
export const itemName = (r: { itemNameEn: string; itemNameTa: string | null }, language: string): string =>
  language.startsWith('ta') && r.itemNameTa?.trim() ? r.itemNameTa : r.itemNameEn;

/** The unit fields Add items needs to pick an item's row unit. */
export interface UnitRow {
  itemId: string;
  iucId: string;
  isDefault: boolean;
  appPriced: boolean;
}

/** One item on Add items: all its units, and the one its row shows. */
export interface ItemUnits<T extends UnitRow> {
  itemId: string;
  units: T[];
  /** The default unit when it has a price today, else the first priced unit, else the first. */
  rowUnit: T;
  /** Some unit has a price today: the item can be ordered. */
  priced: boolean;
}

/**
 * Groups unit rows (one per unit, as Sync keeps them) into items, keeping the rows' order (the
 * no-bill return list shows one row per item; order Add items lists every unit since 2026-11-20).
 */
export function groupUnits<T extends UnitRow>(rows: readonly T[]): ItemUnits<T>[] {
  const byItem = new Map<string, T[]>();
  for (const r of rows) {
    const list = byItem.get(r.itemId);
    if (list) list.push(r);
    else byItem.set(r.itemId, [r]);
  }
  return [...byItem.entries()].map(([itemId, units]) => {
    const priced = units.filter((u) => u.appPriced);
    const rowUnit = priced.find((u) => u.isDefault) ?? priced[0] ?? units.find((u) => u.isDefault) ?? units[0]!;
    return { itemId, units, rowUnit, priced: priced.length > 0 };
  });
}

/**
 * A unit's size: VK Nex's iuc_to_base_factor (quantity in this unit × factor = quantity in the
 * item's base unit). Factors come as text ('12.000000') or numbers.
 */
export interface UnitFactor {
  unitName: string;
  factor: string | number | null;
}

const factorOf = (u: UnitFactor): number => {
  const f = Number(u.factor);
  return Number.isFinite(f) && f > 0 ? f : 0;
};

/**
 * The item's base unit among its units: the one with factor 1 (VK Nex's base unit). When the phone
 * has no such unit, the smallest one stands in for it, so "1 Box = 12 Pcs" still reads right.
 */
export function baseUnitOf<T extends UnitFactor>(units: readonly T[]): T | undefined {
  const sized = units.filter((u) => factorOf(u) > 0);
  return sized.find((u) => factorOf(u) === 1) ?? [...sized].sort((a, b) => factorOf(a) - factorOf(b))[0];
}

/**
 * How many base units one of `u` holds ("1 Box = 12 Pcs" → { n: 12, base: 'Pcs' }), or null for
 * the base unit itself, a unit of the same size, or missing factors.
 */
export function unitInBase<T extends UnitFactor>(u: T, units: readonly T[]): { n: number; base: string } | null {
  const base = baseUnitOf(units);
  const f = factorOf(u);
  const bf = base ? factorOf(base) : 0;
  if (!base || !f || !bf || !base.unitName.trim()) return null;
  const n = Number((f / bf).toFixed(3));
  return n === 1 ? null : { n, base: base.unitName };
}

/** A quantity in one unit, in the base unit (stock 4 Box → 48 Pcs). Null as for unitInBase. */
export function qtyInBase<T extends UnitFactor>(qty: number, u: T, units: readonly T[]): { qty: number; base: string } | null {
  const conv = unitInBase(u, units);
  return conv ? { qty: Number((qty * conv.n).toFixed(3)), base: conv.base } : null;
}

/** A line of the order as stock sees it: its unit, quantity and size. */
export interface StockLine {
  itemId: string;
  iucId: string;
  qty: string;
  factor: string | number | null;
}

/**
 * The stock a line (or an Add items row) may still draw, in its own unit: the unit's stock as of
 * Sync less what the item's lines in other units ahead of it take, since they all come out of one
 * stock (4 Box and 10 Pcs of Sugar both draw on its 48 Pcs). The first line gets the stock first, as
 * VK Nex reserves line by line; a row with no line yet comes after every line. Unknown factors
 * leave the stock as it is.
 */
export function stockLeft(lines: readonly StockLine[], u: Omit<StockLine, 'qty'>, stock: number): number {
  const f = factorOf({ unitName: '', factor: u.factor });
  if (!f) return stock;
  let used = 0;
  for (const l of lines) {
    if (l.iucId === u.iucId) break;
    if (l.itemId === u.itemId) used += num(l.qty) * factorOf({ unitName: '', factor: l.factor });
  }
  return used > 0 ? Number((stock - used / f).toFixed(3)) : stock;
}
