// Reads of the phone's offer tables and item lookups for the engine (drizzle). The pure engine is
// in scheme-order.ts; this file only turns SQLite rows into its input.
import { and, asc, eq, inArray } from 'drizzle-orm';

import { db } from '@/db/client';
import { itemMaster, itemUnits, promotionScheme, promotionSchemeBranch, promotionSchemeItem, promotionSchemeParty, promotionSchemeSlab } from '@/db/schema';
import type { OrderCustomer } from '@/features/orders/queries';
import type { FreeUnit } from '@/features/orders/order-rows';
import { todayISO } from '@/lib/money';

import { clockTime, offersInput, type DraftForOffers } from './scheme-draft';
import { evaluateOrder, type ItemAttrs, type OrderFreeLine, type SchemeOrder } from './scheme-order';
import type { SchemeInput } from './scheme-types';

/** The company's offers (the header rows). A live query on this re-reads when Sync replaces them. */
export const companySchemesQuery = (companyId: string) =>
  db
    .select()
    .from(promotionScheme)
    .where(eq(promotionScheme.prmCompId, companyId))
    .orderBy(asc(promotionScheme.prmPriority), asc(promotionScheme.prmCode), asc(promotionScheme.prmId));

export type SchemeHeaderRow = Awaited<ReturnType<ReturnType<typeof companySchemesQuery>['all']>>[number];

/** SQLite takes a limited number of ? in one statement: ask in parts. */
function inParts<T>(ids: readonly string[], read: (part: string[]) => T[]): T[] {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 400) out.push(...read(ids.slice(i, i + 400)));
  return out;
}

const group = <T>(rows: readonly T[], key: (r: T) => string): Map<string, T[]> => {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    const list = m.get(k);
    if (list) list.push(r);
    else m.set(k, [r]);
  }
  return m;
};

/** The headers with their branches, shops, items and bands, in the engine's input shape (plan §5.2 rows, camelCased). */
export function loadSchemeInputs(headers: readonly SchemeHeaderRow[]): SchemeInput[] {
  if (headers.length === 0) return [];
  const ids = headers.map((h) => h.prmId);
  const branches = group(
    inParts(ids, (p) => db.select().from(promotionSchemeBranch).where(inArray(promotionSchemeBranch.prbPrmId, p)).all()),
    (r) => r.prbPrmId,
  );
  const parties = group(
    inParts(ids, (p) => db.select().from(promotionSchemeParty).where(inArray(promotionSchemeParty.prpPrmId, p)).all()),
    (r) => r.prpPrmId,
  );
  const items = group(
    inParts(ids, (p) => db.select().from(promotionSchemeItem).where(inArray(promotionSchemeItem.priPrmId, p)).all()),
    (r) => r.priPrmId,
  );
  const slabs = group(
    inParts(ids, (p) => db.select().from(promotionSchemeSlab).where(inArray(promotionSchemeSlab.prsPrmId, p)).orderBy(asc(promotionSchemeSlab.prsSlno)).all()),
    (r) => r.prsPrmId,
  );
  return headers.map((h) => ({
    ...h,
    branches: branches.get(h.prmId) ?? [],
    parties: parties.get(h.prmId) ?? [],
    items: items.get(h.prmId) ?? [],
    slabs: slabs.get(h.prmId) ?? [],
  }));
}

/** Group, brand, category, section and allow-promo of these items (item_master). */
export function loadItemAttrs(itemIds: readonly string[]): Record<string, ItemAttrs> {
  const out: Record<string, ItemAttrs> = {};
  const rows = inParts(itemIds, (p) =>
    db
      .select({
        itemId: itemMaster.itemId,
        groupId: itemMaster.itemGroupId,
        brandId: itemMaster.itemBrandId,
        categoryId: itemMaster.itemCategoryId,
        sectionId: itemMaster.itemSectionId,
        allowPromo: itemMaster.itemAllowPromo,
      })
      .from(itemMaster)
      .where(inArray(itemMaster.itemId, p))
      .all(),
  );
  for (const r of rows)
    out[r.itemId] = {
      groupId: r.groupId,
      brandId: r.brandId,
      categoryId: r.categoryId,
      sectionId: r.sectionId,
      allowPromo: r.allowPromo,
    };
  return out;
}

/** iucId -> the unit id offers compare, for these units in the company: the iucId itself. */
export function loadUnitIds(companyId: string, iucIds: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const rows = inParts(iucIds, (p) =>
    db
      .select({ iucId: itemUnits.iucId, unitId: itemUnits.iucUnitId })
      .from(itemUnits)
      .where(and(eq(itemUnits.appCompanyId, companyId), inArray(itemUnits.iucId, p)))
      .all(),
  );
  // VK Nex's pri_unit_id / prs_free_unit_id hold item_unit_conversion.iuc_id (checked live
  // 2026-11-19), the same id as the line's iucId, and the desktop compares them as they are.
  for (const r of rows) out[r.iucId] = r.iucId;
  return out;
}

/**
 * Where a free line's unit is on this phone: the company's item_units row of the free item whose
 * iucId is the offer's prs_free_unit_id (an item_unit_conversion id), else the unit with the
 * offer's unit name. null = none.
 */
export function resolveFreeUnit(companyId: string, f: OrderFreeLine): FreeUnit | null {
  const rows = db
    .select({
      iucId: itemUnits.iucId,
      unitId: itemUnits.iucUnitId,
      unitName: itemUnits.appUnitName,
      factor: itemUnits.iucToBaseFactor,
    })
    .from(itemUnits)
    .where(and(eq(itemUnits.appCompanyId, companyId), eq(itemUnits.iucItemId, f.freeItemId)))
    .all();
  const hit = rows.find((r) => f.freeUnitId !== '' && r.iucId === f.freeUnitId) ?? rows.find((r) => f.freeUnitName !== '' && r.unitName === f.freeUnitName);
  return hit ? { iucId: hit.iucId, unitName: hit.unitName, factor: String(hit.factor) } : null;
}

/** The offers on a draft right now (Save uses this, so what is saved is what Review showed). */
export function evaluateDraftNow(
  draft: DraftForOffers & { lines: DraftForOffers['lines'] },
  customer: OrderCustomer,
  orderDate: string = todayISO(),
): { order: SchemeOrder; itemAttrs: Record<string, ItemAttrs> } {
  const companyId = draft.companyId ?? '';
  const headers = companyId ? companySchemesQuery(companyId).all() : [];
  const itemAttrs = loadItemAttrs(draft.lines.map((l) => l.itemId));
  const unitIds = loadUnitIds(
    companyId,
    draft.lines.map((l) => l.iucId),
  );
  const order = evaluateOrder(
    offersInput({
      draft,
      customer,
      schemes: loadSchemeInputs(headers),
      itemAttrs,
      unitIds,
      date: orderDate,
      time: clockTime(),
    }),
  );
  return { order, itemAttrs };
}
