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
