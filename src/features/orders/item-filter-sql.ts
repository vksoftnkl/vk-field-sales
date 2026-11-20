import { and, inArray, or, sql, type SQL } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';

import { itemMaster, itemUnits } from '@/db/schema';

import { searchWords } from './order-items';

/** What an item list is narrowed by: the search box and the filter sheet's groups and brands. */
export interface ItemListFilter {
  search: string;
  groupIds: readonly string[];
  brandIds: readonly string[];
}

/** One string for a filter, for useLiveQuery's deps and to start the list again from its first 50. */
export const itemFilterKey = (f: ItemListFilter): string => `${searchWords(f.search).join(' ')}|${f.groupIds.join(',')}|${f.brandIds.join(',')}`;

/**
 * The search and filter as SQL on item_master, the same rule as filterOrderItems: every typed
 * word in the code, the English name or the Tamil name; groups / brands [] = all. The words are
 * lower-cased as typed; SQLite's lower() folds A-Z only (Tamil has no case). A list with one row
 * per unit passes `unitName`, so "sugar box" finds the Box row of Sugar.
 */
export function itemFilterSql(f: ItemListFilter, unitName?: SQLiteColumn): SQL | undefined {
  const parts: SQL[] = [];
  if (f.groupIds.length) parts.push(inArray(itemMaster.itemGroupId, [...f.groupIds]));
  if (f.brandIds.length) parts.push(inArray(itemMaster.itemBrandId, [...f.brandIds]));
  const unit = unitName ? sql` || ' ' || coalesce(${unitName}, '')` : sql``;
  const text = sql`lower(coalesce(${itemMaster.itemCode}, '') || ' ' || ${itemMaster.itemNameEn} || ' ' || coalesce(${itemMaster.itemNameTa}, '')${unit})`;
  for (const w of searchWords(f.search)) parts.push(sql`instr(${text}, ${w}) > 0`);
  return parts.length ? and(...parts) : undefined;
}

/** toPaise(price) is not 0 (and not empty): the price can be sold at. */
const priced = (col: SQLiteColumn) => sql`round(cast(coalesce(${col}, '0') as real) * 100) <> 0`;

/**
 * The unit has a price a new line can start at for a customer of this level (startingPrice is
 * not null): any of A-D, or the MRP / minimum price when the customer's level is 5 / 6.
 */
export function startingPriceSql(level: number | null): SQL {
  const any = [priced(itemUnits.ipmSalesPriceA), priced(itemUnits.ipmSalesPriceB), priced(itemUnits.ipmSalesPriceC), priced(itemUnits.ipmSalesPriceD)];
  if (level === 5) any.push(priced(itemUnits.ipmMaxPrice));
  if (level === 6) any.push(priced(itemUnits.ipmMinPrice));
  return or(...any)!;
}
