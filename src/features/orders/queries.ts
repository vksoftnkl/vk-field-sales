import { and, asc, count, desc, eq, gt, gte, inArray, isNull, lte, max, min, ne, notExists, or, sql } from 'drizzle-orm';
import { alias, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';

import { db } from '@/db/client';
import {
  beats,
  companies,
  customers,
  itemBrandMaster,
  itemGroupMaster,
  itemMaster,
  itemPriceLevels,
  itemUnits,
  openBills,
  saleBill,
  saleBillItem,
  saleOrder,
  saleOrderItem,
  visits,
} from '@/db/schema';
import { addDays } from '@/lib/date-range';
import { todayISO } from '@/lib/money';
import { uuidv7 } from '@/lib/uuid';

import { applyOffersOf } from '../schemes/scheme-draft';
import { evaluateDraftNow, resolveFreeUnit } from '../schemes/scheme-load';
import { itemFilterSql, type ItemListFilter } from './item-filter-sql';
import type { CheckIn, OrderDraftState, SoLine } from './order-draft';
import { paiseText, qtyText, startingPrice, toPaise } from './order-math';
import { buildOrderRows, offersOnFromSaved, paidRows } from './order-rows';
import { nextRefSeq, phoneRef, validUntil, VALID_DAYS } from './order-status';
import { soLineAmounts, type DiscMode } from './so-math';
import { SO_ORDER_TYPE, toPriority } from './so-priority';

/** What the order screens, Receipt and Check in need about the shop. */
export const orderCustomerQuery = (cusId: string) =>
  db
    .select({
      cusId: customers.cusId,
      cusName: customers.cusName,
      cusShort: customers.cusShort,
      cusCode: customers.cusCode,
      cusPriceLevelId: customers.cusPriceLevelId,
      cusLoadingCharge: customers.cusLoadingCharge,
      cusFreightCharge: customers.cusFreightCharge,
      cusAllowPromotion: customers.cusAllowPromotion,
      cusCreditAllowed: customers.cusCreditAllowed,
      appOrderStatus: customers.appOrderStatus,
      // For offers: the shop's group, its beat and the beat's city.
      cusGroupId: customers.cusGroupId,
      cusAreaId: customers.cusAreaId,
      cityId: beats.cityId,
    })
    .from(customers)
    .leftJoin(beats, eq(beats.id, customers.cusAreaId))
    .where(eq(customers.cusId, cusId));

export type OrderCustomer = Awaited<ReturnType<ReturnType<typeof orderCustomerQuery>['all']>>[number];

export const customerName = (c: Pick<OrderCustomer, 'cusName' | 'cusShort' | 'cusCode'>) => c.cusName ?? c.cusShort ?? c.cusCode ?? '';

/** Visit: the beat, GST registration and credit terms (the rest comes from customerDetailQuery). */
export const visitCustomerQuery = (cusId: string) =>
  db
    .select({
      beatName: beats.name,
      cusGstNo: customers.cusGstNo,
      cusGstType: customers.cusGstType,
      cusCreditAmtLimit: customers.cusCreditAmtLimit,
      cusCreditDays: customers.cusCreditDays,
    })
    .from(customers)
    .leftJoin(beats, eq(beats.id, customers.cusAreaId))
    .where(eq(customers.cusId, cusId));

/** VK Nex's GST types: anything but UNREGISTERED with a GSTIN is registered. */
export const isGstRegistered = (c: { cusGstNo: string | null; cusGstType: string | null }): boolean =>
  !!c.cusGstNo?.trim() && (c.cusGstType ?? '').toUpperCase() !== 'UNREGISTERED';

export const companyQuery = (id: string) => db.select({ id: companies.id, name: companies.name, place: companies.place }).from(companies).where(eq(companies.id, id));

/** The oldest bill of the shop still pending in a company, from the open bills Sync brought. */
export const oldestOpenBillQuery = (cusId: string, companyId: string) =>
  db
    .select({ date: min(openBills.docDate) })
    .from(openBills)
    .where(and(eq(openBills.partyId, cusId), eq(openBills.companyId, companyId), gt(openBills.pendingPaise, 0)));

/**
 * Every orderable unit in a company, one row each (Sales lists these). Units VK Nex has no price
 * for are left out.
 */
export const orderItemColumns = {
  iucId: itemUnits.iucId,
  itemId: itemMaster.itemId,
  itemCode: itemMaster.itemCode,
  itemNameEn: itemMaster.itemNameEn,
  itemNameTa: itemMaster.itemNameTa,
  itemGroupId: itemMaster.itemGroupId,
  itemBrandId: itemMaster.itemBrandId,
  itemAllowLoading: itemMaster.itemAllowLoading,
  itemAllowFreight: itemMaster.itemAllowFreight,
  itemAllowPromo: itemMaster.itemAllowPromo,
  unitName: itemUnits.appUnitName,
  ipmSalesPriceA: itemUnits.ipmSalesPriceA,
  ipmSalesPriceB: itemUnits.ipmSalesPriceB,
  ipmSalesPriceC: itemUnits.ipmSalesPriceC,
  ipmSalesPriceD: itemUnits.ipmSalesPriceD,
  ipmMaxPrice: itemUnits.ipmMaxPrice,
  ipmMinPrice: itemUnits.ipmMinPrice,
  ipmLoadingCharge: itemUnits.ipmLoadingCharge,
  ipmFreightCharge: itemUnits.ipmFreightCharge,
  stockQty: itemUnits.isbAvailableQty,
};

/** A unit as the order screens use it: the Sales columns plus the unit, tax and price flags. */
const soUnitColumns = {
  ...orderItemColumns,
  isDefault: itemUnits.iucIsDefaultUnit,
  appPriced: itemUnits.appPriced,
  factor: itemUnits.iucToBaseFactor,
  inclTax: itemMaster.itemInclTax,
  taxPerc: itemMaster.appTaxPerc,
  taxId: itemMaster.appTaxId,
  hsnCode: itemMaster.itemHsnCode,
};

/** Every unit of every item in a company, priced or not (Add items shows unpriced ones greyed). */
export const soUnitsQuery = (companyId: string) =>
  db
    .select(soUnitColumns)
    .from(itemUnits)
    .innerJoin(itemMaster, eq(itemMaster.itemId, itemUnits.iucItemId))
    .where(eq(itemUnits.appCompanyId, companyId))
    .orderBy(asc(itemMaster.itemNameEn), desc(itemUnits.iucIsDefaultUnit), asc(itemUnits.iucToBaseFactor), asc(itemUnits.appUnitName));

export type SoUnitRow = Awaited<ReturnType<ReturnType<typeof soUnitsQuery>['all']>>[number];

/** Add items' search and filter on a company's items (any unit, priced or not). */
const soItemWhere = (companyId: string, f: ItemListFilter) => and(eq(itemUnits.appCompanyId, companyId), itemFilterSql(f));

/** How many items Add items lists for this search and filter (one row per item). */
export const soItemCountQuery = (companyId: string, f: ItemListFilter) =>
  db
    .select({ n: sql<number>`count(distinct ${itemMaster.itemId})`.mapWith(Number) })
    .from(itemUnits)
    .innerJoin(itemMaster, eq(itemMaster.itemId, itemUnits.iucItemId))
    .where(soItemWhere(companyId, f));

/**
 * Add items as far as it is scrolled: the first `limit` items, by name (then id, so the rows
 * already shown never move when the next 50 come).
 */
export const soItemsUpToQuery = (companyId: string, f: ItemListFilter, limit: number) =>
  db
    .selectDistinct({ itemId: itemMaster.itemId, name: itemMaster.itemNameEn })
    .from(itemUnits)
    .innerJoin(itemMaster, eq(itemMaster.itemId, itemUnits.iucItemId))
    .where(soItemWhere(companyId, f))
    .orderBy(asc(itemMaster.itemNameEn), asc(itemMaster.itemId))
    .limit(limit);

/** Every unit of these items in a company, in the same order (the rows of the items loaded). */
export const soUnitsOfItemsQuery = (companyId: string, itemIds: readonly string[]) =>
  db
    .select(soUnitColumns)
    .from(itemUnits)
    .innerJoin(itemMaster, eq(itemMaster.itemId, itemUnits.iucItemId))
    .where(and(eq(itemUnits.appCompanyId, companyId), inArray(itemUnits.iucItemId, [...itemIds])))
    .orderBy(asc(itemMaster.itemNameEn), asc(itemMaster.itemId), desc(itemUnits.iucIsDefaultUnit), asc(itemUnits.iucToBaseFactor), asc(itemUnits.appUnitName));

/**
 * Add items' rows since 2026-11-20: one per unit, so "Sugar 1kg – Pcs" and "Sugar 1kg – Box" are
 * two rows, each with its own price, stock and offers. Every priced unit is a row; an item with no
 * priced unit at all keeps one greyed row (its default unit, else its smallest) so the salesman
 * sees it and asks the office. An unpriced unit of an item that has a priced one is left out: it
 * can't be ordered (the old Pick unit sheet didn't offer it either).
 */
const soUnitRowWhere = (companyId: string, f: ItemListFilter) => {
  const p = alias(itemUnits, 'p');
  const q = alias(itemUnits, 'q');
  const sameItem = (t: { appCompanyId: AnySQLiteColumn; iucItemId: AnySQLiteColumn }) => and(eq(t.appCompanyId, itemUnits.appCompanyId), eq(t.iucItemId, itemUnits.iucItemId));
  const noPricedUnit = notExists(db.select({ one: sql`1` }).from(p).where(and(sameItem(p), eq(p.appPriced, true))));
  const firstUnit = eq(
    itemUnits.iucId,
    db
      .select({ id: q.iucId })
      .from(q)
      .where(sameItem(q))
      .orderBy(desc(q.iucIsDefaultUnit), sql`cast(${q.iucToBaseFactor} as real)`, asc(q.appUnitName), asc(q.iucId))
      .limit(1),
  );
  return and(eq(itemUnits.appCompanyId, companyId), itemFilterSql(f, itemUnits.appUnitName), or(eq(itemUnits.appPriced, true), and(noPricedUnit, firstUnit)));
};

/** How many unit rows Add items lists for this search and filter. */
export const soUnitRowCountQuery = (companyId: string, f: ItemListFilter) =>
  db
    .select({ n: count() })
    .from(itemUnits)
    .innerJoin(itemMaster, eq(itemMaster.itemId, itemUnits.iucItemId))
    .where(soUnitRowWhere(companyId, f));

/**
 * Add items as far as it is scrolled: the first `limit` unit rows, by item name, then each item's
 * units from the smallest (Pcs, Box, Carton), so an item's units sit together and the rows already
 * shown never move when the next 50 come.
 */
export const soUnitRowsUpToQuery = (companyId: string, f: ItemListFilter, limit: number) =>
  db
    .select(soUnitColumns)
    .from(itemUnits)
    .innerJoin(itemMaster, eq(itemMaster.itemId, itemUnits.iucItemId))
    .where(soUnitRowWhere(companyId, f))
    .orderBy(asc(itemMaster.itemNameEn), asc(itemMaster.itemId), sql`cast(${itemUnits.iucToBaseFactor} as real)`, asc(itemUnits.appUnitName), asc(itemUnits.iucId))
    .limit(limit);

/**
 * The size of every unit of these items (priced or not), so a row reads "1 Box = 12 Pcs" and
 * "Stock 4 Box (48 Pcs)" against the item's base unit even when that unit has no row.
 */
export const soUnitSizesQuery = (companyId: string, itemIds: readonly string[]) =>
  db
    .select({ itemId: itemUnits.iucItemId, iucId: itemUnits.iucId, unitName: itemUnits.appUnitName, factor: itemUnits.iucToBaseFactor })
    .from(itemUnits)
    .where(and(eq(itemUnits.appCompanyId, companyId), inArray(itemUnits.iucItemId, [...itemIds])));

export type SoUnitSize = Awaited<ReturnType<ReturnType<typeof soUnitSizesQuery>['all']>>[number];

/** One item's units in a company, for Order item. */
export const soItemUnitsQuery = (companyId: string, itemId: string) =>
  db
    .select(soUnitColumns)
    .from(itemUnits)
    .innerJoin(itemMaster, eq(itemMaster.itemId, itemUnits.iucItemId))
    .where(and(eq(itemUnits.appCompanyId, companyId), eq(itemUnits.iucItemId, itemId)))
    .orderBy(desc(itemUnits.iucIsDefaultUnit), asc(itemUnits.iucToBaseFactor), asc(itemUnits.appUnitName));

export const itemGroupsQuery = () => db.select({ id: itemGroupMaster.itgId, name: itemGroupMaster.itgName }).from(itemGroupMaster).orderBy(asc(itemGroupMaster.itgSort));
export const itemBrandsQuery = () => db.select({ id: itemBrandMaster.brandId, name: itemBrandMaster.brandName }).from(itemBrandMaster).orderBy(asc(itemBrandMaster.brandSort));
export const priceLevelsQuery = () => db.select({ id: itemPriceLevels.iplId, name: itemPriceLevels.iplName }).from(itemPriceLevels).orderBy(asc(itemPriceLevels.iplId));

/**
 * A new order line for a unit at a price. Cooly and freight apply only when the customer AND the
 * item take them (the Qt rule); promotion when both allow it (the office applies the scheme).
 */
export function soSeedLine(u: SoUnitRow, c: OrderCustomer, price: { level: number; price: string }): SoLine {
  return {
    itemId: u.itemId,
    iucId: u.iucId,
    name: u.itemNameEn,
    nameTa: u.itemNameTa,
    unitName: u.unitName,
    factor: u.factor,
    qty: '',
    price: price.price,
    priceLevel: price.level,
    discMode: 'perc',
    disc: '',
    taxPerc: u.taxPerc,
    inclTax: u.inclTax,
    taxId: u.taxId,
    hsnCode: u.hsnCode,
    loadPerUnit: c.cusLoadingCharge && u.itemAllowLoading ? (u.ipmLoadingCharge ?? '0') : '0',
    freightPerUnit: c.cusFreightCharge && u.itemAllowFreight ? (u.ipmFreightCharge ?? '0') : '0',
    mrp: u.ipmMaxPrice,
    minPrice: u.ipmMinPrice,
    promo: c.cusAllowPromotion && u.itemAllowPromo,
  };
}

/** VK Nex's so_remarks is varchar(500). */
export const REMARKS_MAX = 500;

/** The draft fields Save order writes. */
export type OrderToSave = Pick<OrderDraftState, 'customerId' | 'companyId' | 'branchId' | 'editingSoId' | 'lines' | 'deliveryDate' | 'priority' | 'remarks' | 'checkIn' | 'offersOn' | 'applyOffers'>;

/**
 * Save order: the order and its lines in one transaction, waiting for the next Sync (which sends it
 * as soClientUuid = so_id). Lines without a quantity are left out. Editing an order not yet sent
 * keeps its id, date and phone ref and replaces its lines; one VK Nex already has can't be edited.
 * The shop shows as Ordered on the customer list.
 */
export function saveOrder(d: OrderToSave, c: OrderCustomer, userId: string, deviceUid: string): { soId: string; ref: string } {
  const lines = d.lines.filter((l) => soLineAmounts(l).qty > 0);
  if (!lines.length || !d.customerId || !d.companyId) throw new Error('ORDER_EMPTY');
  const companyId = d.companyId;
  // A new order always has Switch company's branch (Take order asks first); only an order saved
  // before branches came may be edited without one.
  if (!d.branchId && !d.editingSoId) throw new Error('ORDER_NO_BRANCH');
  const now = new Date().toISOString();
  const today = todayISO();

  return db.transaction((tx) => {
    const old = d.editingSoId ? tx.select().from(saleOrder).where(eq(saleOrder.soId, d.editingSoId)).get() : undefined;
    if (d.editingSoId && !old) throw new Error('ORDER_GONE');
    if (old && !old.appPendingUpload) throw new Error('ORDER_SENT');

    const soId = old?.soId ?? uuidv7();
    const orderDate = old?.soOrderDate ?? today;
    const ref =
      old?.soUsrRefno ??
      phoneRef(
        deviceUid,
        orderDate,
        nextRefSeq(
          tx
            .select({ ref: saleOrder.soUsrRefno })
            .from(saleOrder)
            .where(eq(saleOrder.soOrderDate, orderDate))
            .all()
            .map((r) => r.ref),
        ),
      );
    // The offers worked out again now, on the order's own date, so what is saved is what Review showed.
    const { order, itemAttrs } = evaluateDraftNow({ ...d, lines }, c, orderDate);
    const built = buildOrderRows({
      soId,
      lines,
      order,
      itemAttrs,
      offersOn: d.offersOn,
      applyOffers: applyOffersOf(d, c),
      resolveFree: (f) => resolveFreeUnit(companyId, f),
      newId: uuidv7,
    });
    const t = built.totals;
    const delivery = d.deliveryDate && d.deliveryDate > orderDate ? d.deliveryDate : orderDate;
    const header = {
      soCompanyId: d.companyId!,
      // Kept with the order, so it reaches VK Nex in this branch even after a later switch.
      soBranchId: d.branchId,
      // VK Nex needs a level on the order; the customer's, else A (each line keeps its own).
      soPriceLevel: c.cusPriceLevelId ?? 1,
      soCustId: c.cusId,
      soCustName: customerName(c),
      soHasLoad: c.cusLoadingCharge,
      soHasFreight: c.cusFreightCharge,
      // The order's Apply offers switch (its own value, else the shop's allow-promotion flag).
      soHasPromo: applyOffersOf(d, c),
      soUserId: userId,
      soTotItems: t.items,
      soTotBags: qtyText(t.qty),
      soGrossAmt: paiseText(t.grossPaise),
      soItemDisc: paiseText(t.discPaise),
      soTaxableAmt: paiseText(t.taxablePaise),
      soCgstAmt: paiseText(t.cgstPaise),
      soSgstAmt: paiseText(t.sgstPaise),
      soIgstAmt: paiseText(t.igstPaise),
      soTaxAmt: paiseText(t.taxPaise),
      soFreightAmt: paiseText(t.freightPaise),
      soLoadAmt: paiseText(t.loadPaise),
      soRoundOff: paiseText(t.roundOffPaise),
      soSchDisc: built.schDisc,
      soBillSchDisc: built.billSchDisc,
      soOrderAmt: paiseText(t.totalPaise),
      // Always on credit, whatever the customer's credit flag (user's rule, 2026-11-18).
      soOrderType: SO_ORDER_TYPE,
      soPriority: d.priority,
      soDeliveryDate: delivery,
      soValidUntil: validUntil(orderDate),
      soRemarks: d.remarks.trim().slice(0, REMARKS_MAX) || null,
      soUsrRefno: ref,
    };

    if (old) {
      // A new try: the reason VK Nex sent it back no longer applies.
      tx.update(saleOrder).set({ ...header, appVehicleNo: null, appSyncError: null }).where(eq(saleOrder.soId, soId)).run();
      tx.delete(saleOrderItem).where(eq(saleOrderItem.soiOrderId, soId)).run();
    } else {
      tx.insert(saleOrder)
        .values({
          ...header,
          soId,
          soOrderDate: orderDate,
          soOrderDatetime: now,
          soCreatedOn: now,
          appCheckinAt: d.checkIn?.at ?? null,
          appCheckinLat: d.checkIn?.fix?.latitude ?? null,
          appCheckinLng: d.checkIn?.fix?.longitude ?? null,
          appCheckinAccuracyM: d.checkIn?.fix?.accuracyM ?? null,
          appPendingUpload: true,
        })
        .run();
    }
    tx.insert(saleOrderItem).values(built.rows).run();
    tx.update(customers).set({ appOrderStatus: 'ordered' }).where(eq(customers.cusId, c.cusId)).run();
    return { soId, ref };
  });
}

/** Delete from phone: only an order VK Nex doesn't have yet. */
export function deleteOrder(soId: string): void {
  db.transaction((tx) => {
    const o = tx.select({ pending: saleOrder.appPendingUpload, cusId: saleOrder.soCustId, date: saleOrder.soOrderDate }).from(saleOrder).where(eq(saleOrder.soId, soId)).get();
    if (!o) return;
    if (!o.pending) throw new Error('ORDER_SENT');
    tx.delete(saleOrderItem).where(eq(saleOrderItem.soiOrderId, soId)).run();
    tx.delete(saleOrder).where(eq(saleOrder.soId, soId)).run();
    // The shop stops showing as Ordered when no other order was taken there that day.
    const others = tx
      .select({ n: count() })
      .from(saleOrder)
      .where(and(eq(saleOrder.soCustId, o.cusId), eq(saleOrder.soOrderDate, o.date)))
      .get();
    if (!others?.n) tx.update(customers).set({ appOrderStatus: null }).where(and(eq(customers.cusId, o.cusId), eq(customers.appOrderStatus, 'ordered'))).run();
  });
}

/** One order on the phone. */
export const orderQuery = (soId: string) => db.select().from(saleOrder).where(eq(saleOrder.soId, soId));
export type SavedOrder = typeof saleOrder.$inferSelect;

/** Its lines with the names to show (as ordered; older lines fall back to the item list). */
export const orderLinesQuery = (soId: string) =>
  db
    .select({
      line: saleOrderItem,
      itemNameEn: itemMaster.itemNameEn,
      itemNameTa: itemMaster.itemNameTa,
    })
    .from(saleOrderItem)
    .leftJoin(itemMaster, eq(itemMaster.itemId, saleOrderItem.soiItemId))
    .where(eq(saleOrderItem.soiOrderId, soId))
    .orderBy(asc(saleOrderItem.soiLineNo));

export type SavedLine = Awaited<ReturnType<ReturnType<typeof orderLinesQuery>['all']>>[number];

/** Unit names of a company's units, for older lines saved without one. */
const unitNameOf = (companyId: string, iucId: string): string =>
  db
    .select({ name: itemUnits.appUnitName })
    .from(itemUnits)
    .where(and(eq(itemUnits.appCompanyId, companyId), eq(itemUnits.iucId, iucId)))
    .get()?.name ?? '';

export const lineName = (l: SavedLine): { en: string; ta: string | null } => ({
  en: l.line.appItemName ?? l.itemNameEn ?? '',
  ta: l.line.appItemNameTa ?? l.itemNameTa ?? null,
});

/** Edit before sending: the saved order as a draft (Review opens on it). */
export function loadOrderDraft(soId: string): Omit<OrderDraftState, 'entry'> | null {
  const o = orderQuery(soId).get();
  if (!o || !o.appPendingUpload) return null;
  const units = new Map(soUnitsQuery(o.soCompanyId).all().map((u) => [u.iucId, u]));
  const shop = orderCustomerQuery(o.soCustId).get();
  const switches: { iucId: string; savedPromo: boolean; allowed: boolean }[] = [];
  // Free lines are worked out again, never loaded.
  const lines: SoLine[] = paidRows(orderLinesQuery(soId).all())
    .map((row) => {
      const l = row.line;
      const u = units.get(l.soiItemUnitId);
      // The shop and the item allow offers (the line's own switch is the draft's offersOn).
      const allowed = !!shop && !!u && shop.cusAllowPromotion && u.itemAllowPromo;
      switches.push({ iucId: l.soiItemUnitId, savedPromo: l.soiIsPromo, allowed });
      const mode = (l.appDiscMode as DiscMode | null) ?? (Number(l.soiItemDiscQty) > 0 ? 'perUnit' : 'perc');
      const disc = mode === 'perc' ? l.soiItemDiscPerc : mode === 'perUnit' ? l.soiItemDiscQty : l.soiItemDiscAmt;
      const perUnit = (amt: string, qty: string) => (Number(qty) > 0 ? paiseText(Math.round((toPaise(amt) ?? 0) / Number(qty))) : '0');
      const name = lineName(row);
      return {
        itemId: l.soiItemId,
        iucId: l.soiItemUnitId,
        name: name.en,
        nameTa: name.ta,
        unitName: l.appUnitName ?? u?.unitName ?? unitNameOf(o.soCompanyId, l.soiItemUnitId),
        factor: l.soiToBaseFactor ?? u?.factor ?? '1',
        qty: l.soiOrderQty,
        price: l.soiRate,
        priceLevel: l.soiPriceLevel,
        discMode: mode,
        disc: Number(disc) > 0 ? disc : '',
        taxPerc: l.soiTaxPerc ?? u?.taxPerc ?? null,
        inclTax: l.soiIsTaxIncl ?? u?.inclTax ?? false,
        taxId: l.soiTaxId ?? u?.taxId ?? null,
        hsnCode: l.soiHsnCode ?? u?.hsnCode ?? null,
        loadPerUnit: perUnit(l.soiLoadAmt, l.soiLoadQty),
        freightPerUnit: perUnit(l.soiFreightAmt, l.soiFreightQty),
        mrp: Number(l.soiMaxPrice) > 0 ? l.soiMaxPrice : (u?.ipmMaxPrice ?? null),
        minPrice: l.soiMinPrice ?? u?.ipmMinPrice ?? null,
        promo: u && shop ? allowed : l.soiIsPromo,
      };
    });
  return {
    customerId: o.soCustId,
    companyId: o.soCompanyId,
    branchId: o.soBranchId,
    editingSoId: o.soId,
    lines,
    deliveryDate: o.soDeliveryDate,
    // Saved before the dropdown: the old urgent flag is URGENT, no flag (null) NORMAL.
    priority: toPriority(o.soPriority),
    // Orders saved before the vehicle number was dropped keep it in the remarks.
    remarks: [o.soRemarks ?? '', o.appVehicleNo ? `Vehicle ${o.appVehicleNo}` : ''].filter(Boolean).join(' · '),
    checkIn: o.appCheckinAt ? { at: o.appCheckinAt, fix: null } : null,
    // Offers: the Apply offers switch as saved (older orders: untouched = the shop's flag), and each line the salesman switched off.
    applyOffers: o.soHasPromo ?? null,
    // Saved with Apply offers off, every line went with soiIsPromo = false: that is not a per-line choice.
    offersOn: o.soHasPromo === false ? {} : offersOnFromSaved(switches),
  };
}

/**
 * Repeat order (Qt's Copy as new): the lines again at today's prices for the customer, in the same
 * units and quantities, for the company picked in Switch company now (a new order, like any other).
 * Units that company has no price for today are left out (`skipped`).
 */
export function repeatLines(soId: string, c: OrderCustomer, companyId: string): { lines: SoLine[]; skipped: number } | null {
  const o = orderQuery(soId).get();
  if (!o) return null;
  const units = new Map(soUnitsQuery(companyId).all().map((u) => [u.iucId, u]));
  const lines: SoLine[] = [];
  let skipped = 0;
  // Free lines are not copied (the offers are worked out again) and are not "skipped" either.
  for (const { line } of paidRows(orderLinesQuery(soId).all())) {
    const u = units.get(line.soiItemUnitId);
    const start = u?.appPriced ? startingPrice(u, c.cusPriceLevelId) : null;
    if (!u || !start || lines.some((l) => l.iucId === u.iucId)) {
      skipped += 1;
      continue;
    }
    lines.push({ ...soSeedLine(u, c, start), qty: line.soiOrderQty });
  }
  return { lines, skipped };
}

/** My orders: the phone's orders taken between two dates, newest first. */
export const myOrdersQuery = (from: string, to: string) =>
  db
    .select({
      soId: saleOrder.soId,
      soCustId: saleOrder.soCustId,
      soCustName: saleOrder.soCustName,
      soOrderDate: saleOrder.soOrderDate,
      soOrderDatetime: saleOrder.soOrderDatetime,
      soUsrRefno: saleOrder.soUsrRefno,
      soOrderRefno: saleOrder.soOrderRefno,
      soStatus: saleOrder.soStatus,
      soTotItems: saleOrder.soTotItems,
      soOrderAmt: saleOrder.soOrderAmt,
      appPendingUpload: saleOrder.appPendingUpload,
      appSyncError: saleOrder.appSyncError,
    })
    .from(saleOrder)
    .where(and(gte(saleOrder.soOrderDate, from), lte(saleOrder.soOrderDate, to)))
    .orderBy(desc(saleOrder.soOrderDatetime));

export type MyOrderRow = Awaited<ReturnType<ReturnType<typeof myOrdersQuery>['all']>>[number];

/** The reference to show: VK Nex's number once it has one, else the phone's. */
export const orderRef = (o: { soOrderRefno: string | null; soUsrRefno: string | null }): string => o.soOrderRefno ?? o.soUsrRefno ?? '—';

/**
 * The shop's recent orders for a company with their lines (Visit's open orders, the "already on
 * an order" hint on Add items). The phone only knows its own orders, and their status as of the
 * upload.
 */
export const shopOrderLinesQuery = (cusId: string, companyId: string, today = todayISO()) =>
  db
    .select({
      soId: saleOrder.soId,
      soOrderDate: saleOrder.soOrderDate,
      soUsrRefno: saleOrder.soUsrRefno,
      soOrderRefno: saleOrder.soOrderRefno,
      soStatus: saleOrder.soStatus,
      soOrderAmt: saleOrder.soOrderAmt,
      soTotItems: saleOrder.soTotItems,
      appPendingUpload: saleOrder.appPendingUpload,
      appSyncError: saleOrder.appSyncError,
      itemId: saleOrderItem.soiItemId,
      iucId: saleOrderItem.soiItemUnitId,
      qty: saleOrderItem.soiOrderQty,
      unitName: saleOrderItem.appUnitName,
    })
    .from(saleOrder)
    .innerJoin(saleOrderItem, eq(saleOrderItem.soiOrderId, saleOrder.soId))
    .where(and(eq(saleOrder.soCustId, cusId), eq(saleOrder.soCompanyId, companyId), gte(saleOrder.soOrderDate, addDays(today, -VALID_DAYS)), eq(saleOrderItem.soiIsFree, false)))
    .orderBy(desc(saleOrder.soOrderDatetime));

/**
 * Last rates for this shop (Order item): the item on the phone's own bills and orders for the
 * customer, newest first. Bills VK Nex made elsewhere don't come to the phone with their lines.
 */
export function lastRates(cusId: string, itemId: string, exceptSoId: string | null, limit = 5): { date: string; qty: string; unitName: string; rate: string }[] {
  const bills = db
    .select({ date: saleBill.sbBillDate, at: saleBill.sbBillDatetime, qty: saleBillItem.sbiBillQty, rate: saleBillItem.sbiRate, unitName: itemUnits.appUnitName })
    .from(saleBillItem)
    .innerJoin(saleBill, eq(saleBill.sbId, saleBillItem.sbiBillId))
    .leftJoin(itemUnits, and(eq(itemUnits.iucId, saleBillItem.sbiItemUnitId), eq(itemUnits.appCompanyId, saleBill.sbCompanyId)))
    .where(and(eq(saleBill.sbCustId, cusId), eq(saleBillItem.sbiItemId, itemId)))
    .orderBy(desc(saleBill.sbBillDatetime))
    .limit(limit)
    .all();
  const orders = db
    .select({ date: saleOrder.soOrderDate, at: saleOrder.soOrderDatetime, qty: saleOrderItem.soiOrderQty, rate: saleOrderItem.soiRate, unitName: saleOrderItem.appUnitName })
    .from(saleOrderItem)
    .innerJoin(saleOrder, eq(saleOrder.soId, saleOrderItem.soiOrderId))
    .where(and(eq(saleOrder.soCustId, cusId), eq(saleOrderItem.soiItemId, itemId), exceptSoId ? ne(saleOrder.soId, exceptSoId) : undefined))
    .orderBy(desc(saleOrder.soOrderDatetime))
    .limit(limit)
    .all();
  return [...bills, ...orders]
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, limit)
    .map((r) => ({ date: r.date, qty: r.qty, unitName: r.unitName ?? '', rate: r.rate }));
}

/** When the phone last got an answer for an order (My orders' "last sent"). */
export const lastSentQuery = () => db.select({ at: max(saleOrder.appSyncedOn) }).from(saleOrder);

export type VisitReason = 'shopClosed' | 'noOrder' | 'shopBusy' | 'ownerAway' | 'paymentPending' | 'nextVisit';
export const VISIT_REASONS: readonly VisitReason[] = ['shopClosed', 'noOrder', 'shopBusy', 'ownerAway', 'paymentPending', 'nextVisit'];
/**
 * Why nothing was collected (Receipt's "No collection" check-in), as VK Nex's visit reason codes:
 * it has no collection reasons of its own, so "Will pay next visit" goes as paymentPending.
 */
export const COLLECTION_REASONS: readonly VisitReason[] = ['shopClosed', 'ownerAway', 'paymentPending'];

export type VisitFix = NonNullable<CheckIn['fix']>;

/**
 * Save visit (No order, or Receipt's no collection): waits for the next Sync. After a "no order"
 * visit the shop shows as "No order" on the customer list, unless an order was already taken there
 * on this trip; a "no collection" visit leaves the shop's status alone. `visitedAt` is the check-in
 * time when the visit screen made one.
 */
export function saveVisit(
  v: { customerId: string; companyId: string | null; reason: VisitReason; remarks: string; fix: VisitFix | null; kind?: 'order' | 'collection'; visitedAt?: string },
  userId: string,
): string {
  const id = uuidv7();
  db.transaction((tx) => {
    tx.insert(visits)
      .values({
        id,
        companyId: v.companyId,
        customerId: v.customerId,
        userId,
        reason: v.reason,
        remarks: v.remarks.trim().slice(0, 500) || null,
        latitude: v.fix?.latitude ?? null,
        longitude: v.fix?.longitude ?? null,
        accuracyM: v.fix?.accuracyM ?? null,
        locatedAt: v.fix?.locatedAt ?? null,
        visitedAt: v.visitedAt ?? new Date().toISOString(),
        appPendingUpload: true,
      })
      .run();
    if (v.kind === 'collection') return;
    tx.update(customers)
      .set({ appOrderStatus: 'no_order' })
      .where(and(eq(customers.cusId, v.customerId), or(isNull(customers.appOrderStatus), ne(customers.appOrderStatus, 'ordered'))))
      .run();
  });
  return id;
}

/** For the Upload button and My orders: orders and check-ins still to send. */
export const pendingOrdersCountQuery = () => db.select({ n: count() }).from(saleOrder).where(eq(saleOrder.appPendingUpload, true));
export const pendingVisitsCountQuery = () => db.select({ n: count() }).from(visits).where(eq(visits.appPendingUpload, true));

