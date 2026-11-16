// Pure TypeScript (no React Native imports) so `npm test` can run it in Node.
import type { itemMaster, itemUnits } from '@/db/schema';

import type { ItemListPage, MobileItem } from './vk-nex-api';

export type LocalItem = typeof itemMaster.$inferInsert;
export type LocalItemUnit = typeof itemUnits.$inferInsert;

export interface ItemDownloadDeps {
  /** GET /mobile/items/list?companyId=…&page=…: one page of the items orderable for a company. */
  listPage(companyId: string, page: number): Promise<ItemListPage>;
  /** done / total companies. */
  onProgress?(done: number, total: number): void;
}

export interface ItemDownload {
  /** Every item listed for at least one company, once each. */
  items: LocalItem[];
  /** Units with that company's prices and stock, per company read. */
  units: LocalItemUnit[];
  /** The companies read in full: their old units are replaced. */
  companyIds: string[];
}

/** Safety stop for the paging loop (500 a page × 200 = 100 000 items per company). */
const MAX_PAGES = 200;

/** VK Nex's item (GET /mobile/items/list) → the phone's item_master row. */
export function toLocalItem(it: MobileItem): LocalItem {
  return {
    itemId: it.itemId,
    itemCode: it.itemCode,
    itemNameEn: it.itemNameEn,
    itemNameTa: it.itemNameTa,
    // The list is per company already (shared items and the company's own); which company an
    // item may be ordered for is which companies have its units on the phone.
    itemCompanyId: null,
    itemGroupId: it.itemGroupId,
    itemBrandId: it.itemBrandId,
    itemAllowLoading: it.allowLoading,
    itemAllowFreight: it.allowFreight,
    itemAllowPromo: it.allowPromo,
    itemInclTax: it.inclTax,
    // VK Nex lists items by English name; the phone keeps that order.
    itemSortOrder: null,
    itemHsnCode: it.hsnCode,
    appTaxPerc: it.taxPerc,
    appTaxId: it.taxId,
  };
}

/** The units of one item, with this company's prices and stock. Numbers are kept as exact text. */
export function toLocalUnits(companyId: string, it: MobileItem): LocalItemUnit[] {
  return it.units.map((u) => ({
    appCompanyId: companyId,
    iucId: u.iucId,
    iucItemId: it.itemId,
    appUnitName: u.unitName ?? '',
    iucToBaseFactor: String(u.factor),
    iucIsDefaultUnit: u.isDefaultUnit,
    iucUomWeight: String(u.weight),
    appPriced: u.priced,
    ipmSalesPriceA: u.priceA,
    ipmSalesPriceB: u.priceB,
    ipmSalesPriceC: u.priceC,
    ipmSalesPriceD: u.priceD,
    ipmMaxPrice: u.mrp,
    ipmMinPrice: u.minPrice,
    ipmLoadingCharge: u.loadingCharge,
    ipmFreightCharge: u.freightCharge,
    isbAvailableQty: String(u.availableQty),
  }));
}

/**
 * Reads every page of every company's items. Throws on the first failure (no answer, a refusal):
 * the phone then keeps the items it had, since a half-read price list is worse than an old one.
 */
export async function downloadItems(companyIds: readonly string[], deps: ItemDownloadDeps): Promise<ItemDownload> {
  const items = new Map<string, LocalItem>();
  const units: LocalItemUnit[] = [];
  for (const [i, companyId] of companyIds.entries()) {
    deps.onProgress?.(i, companyIds.length);
    for (let page = 1; page <= MAX_PAGES; page++) {
      const p = await deps.listPage(companyId, page);
      for (const it of p.items) {
        items.set(it.itemId, toLocalItem(it));
        units.push(...toLocalUnits(companyId, it));
      }
      if (!p.hasMore || p.items.length === 0) break;
    }
  }
  deps.onProgress?.(companyIds.length, companyIds.length);
  return { items: [...items.values()], units, companyIds: [...companyIds] };
}
