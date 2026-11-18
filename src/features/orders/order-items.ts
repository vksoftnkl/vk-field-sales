// Pure TypeScript (no React Native imports) so `npm test` can run it in Node.

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
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter((r) => {
    if (groupIds.length && !groupIds.includes(r.itemGroupId)) return false;
    if (brandIds.length && !(r.itemBrandId && brandIds.includes(r.itemBrandId))) return false;
    if (!words.length) return true;
    const text = `${r.itemCode ?? ''} ${r.itemNameEn} ${r.itemNameTa ?? ''}`.toLocaleLowerCase();
    return words.every((w) => text.includes(w));
  });
}

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
 * Groups unit rows (one per unit, as Sync keeps them) into items, keeping the rows' order. Since
 * the 3b workflow an item is one row in its default unit; Order item switches the unit.
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
