import { and, asc, count, desc, eq, ne, or, isNull } from 'drizzle-orm';

import { db } from '@/db/client';
import {
  companies,
  customers,
  itemBrandMaster,
  itemGroupMaster,
  itemMaster,
  itemPriceLevels,
  itemUnits,
  saleOrder,
  saleOrderItem,
  visits,
} from '@/db/schema';
import { todayISO } from '@/lib/money';
import { uuidv7 } from '@/lib/uuid';

import type { DraftLine } from './order-draft';
import { lineAmounts, orderTotals, paiseText, qtyText, toPaise } from './order-math';

/** What Order entry, Order item and Check in need about the shop. */
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
      appOrderStatus: customers.appOrderStatus,
    })
    .from(customers)
    .where(eq(customers.cusId, cusId));

export type OrderCustomer = Awaited<ReturnType<ReturnType<typeof orderCustomerQuery>['all']>>[number];

export const customerName = (c: Pick<OrderCustomer, 'cusName' | 'cusShort' | 'cusCode'>) => c.cusName ?? c.cusShort ?? c.cusCode ?? '';

export const companyQuery = (id: string) => db.select({ id: companies.id, name: companies.name, place: companies.place }).from(companies).where(eq(companies.id, id));

/**
 * Every unit orderable in a company, one row each (as the Qt app listed them), by item name with
 * the default unit first. Units VK Nex has no price for are left out.
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

export const orderItemsQuery = (companyId: string) =>
  db
    .select(orderItemColumns)
    .from(itemUnits)
    .innerJoin(itemMaster, eq(itemMaster.itemId, itemUnits.iucItemId))
    .where(and(eq(itemUnits.appCompanyId, companyId), eq(itemUnits.appPriced, true)))
    .orderBy(asc(itemMaster.itemNameEn), desc(itemUnits.iucIsDefaultUnit), asc(itemUnits.appUnitName));

export type OrderItemRow = Awaited<ReturnType<ReturnType<typeof orderItemsQuery>['all']>>[number];

/** One unit, for Order item. */
export const orderItemQuery = (companyId: string, iucId: string) =>
  db
    .select(orderItemColumns)
    .from(itemUnits)
    .innerJoin(itemMaster, eq(itemMaster.itemId, itemUnits.iucItemId))
    .where(and(eq(itemUnits.appCompanyId, companyId), eq(itemUnits.iucId, iucId)));

export const itemGroupsQuery = () => db.select({ id: itemGroupMaster.itgId, name: itemGroupMaster.itgName }).from(itemGroupMaster).orderBy(asc(itemGroupMaster.itgSort));
export const itemBrandsQuery = () => db.select({ id: itemBrandMaster.brandId, name: itemBrandMaster.brandName }).from(itemBrandMaster).orderBy(asc(itemBrandMaster.brandSort));
export const priceLevelsQuery = () => db.select({ id: itemPriceLevels.iplId, name: itemPriceLevels.iplName }).from(itemPriceLevels).orderBy(asc(itemPriceLevels.iplId));

/** Cooly and freight apply only when the customer takes them AND the item allows them (the Qt rule). */
export function seedLine(r: OrderItemRow, c: OrderCustomer, price: { level: number; price: string }): DraftLine {
  return {
    iucId: r.iucId,
    itemId: r.itemId,
    name: r.itemNameEn,
    nameTa: r.itemNameTa,
    unitName: r.unitName,
    qty: '',
    price: price.price,
    priceLevel: price.level,
    discPerc: '',
    discPerUnit: '',
    loadPerUnit: c.cusLoadingCharge && r.itemAllowLoading ? (r.ipmLoadingCharge ?? '0') : '0',
    freightPerUnit: c.cusFreightCharge && r.itemAllowFreight ? (r.ipmFreightCharge ?? '0') : '0',
    promo: r.itemAllowPromo,
    allowPromo: r.itemAllowPromo,
    mrp: r.ipmMaxPrice,
    minPrice: r.ipmMinPrice,
  };
}

/** VK Nex's so_remarks is 500 long, and the vehicle number rides in it after '###'. */
export const REMARKS_MAX = 480;

/**
 * Save order: the order and its lines in one transaction, waiting for the next Sync (which sends
 * it to VK Nex as soClientUuid = so_id). Lines without a quantity are left out. The shop shows as
 * Ordered on the customer list.
 */
export function saveOrder(
  d: { customerId: string; companyId: string; lines: readonly DraftLine[]; vehicleNo: string; remarks: string },
  c: OrderCustomer,
  userId: string,
): string {
  const lines = d.lines.filter((l) => lineAmounts(l).qty > 0);
  if (!lines.length) throw new Error('ORDER_EMPTY');
  const t = orderTotals(lines);
  const soId = uuidv7();
  const now = new Date().toISOString();
  db.transaction((tx) => {
    tx.insert(saleOrder)
      .values({
        soId,
        soCompanyId: d.companyId,
        // VK Nex needs a level on the order; the customer's, else A (each line keeps its own).
        soPriceLevel: c.cusPriceLevelId ?? 1,
        soOrderDate: todayISO(),
        soOrderDatetime: now,
        soCustId: c.cusId,
        soCustName: customerName(c),
        soHasLoad: c.cusLoadingCharge,
        soHasFreight: c.cusFreightCharge,
        soUserId: userId,
        soTotItems: t.items,
        soTotBags: qtyText(t.qty),
        soGrossAmt: paiseText(t.grossPaise),
        soItemDisc: paiseText(t.discPaise),
        soFreightAmt: paiseText(t.freightPaise),
        soLoadAmt: paiseText(t.loadPaise),
        soOrderAmt: paiseText(t.totalPaise),
        soRemarks: d.remarks.trim() || null,
        soCreatedOn: now,
        appVehicleNo: d.vehicleNo.trim().toUpperCase() || null,
        appPendingUpload: true,
      })
      .run();
    tx.insert(saleOrderItem)
      .values(
        lines.map((l, i) => {
          const a = lineAmounts(l);
          return {
            soiId: uuidv7(),
            soiOrderId: soId,
            soiLineNo: i + 1,
            soiItemId: l.itemId,
            soiItemUnitId: l.iucId,
            soiPriceLevel: l.priceLevel,
            soiIsPromo: l.allowPromo && l.promo,
            soiOrderQty: qtyText(a.qty),
            soiNetQty: qtyText(a.qty),
            soiRate: paiseText(toPaise(l.price) ?? 0),
            soiMaxPrice: l.mrp ?? '0',
            soiItemDiscPerc: l.discPerc.trim() || '0',
            soiItemDiscQty: l.discPerUnit.trim() || '0',
            soiItemDiscAmt: paiseText(a.discPaise),
            soiGrossAmt: paiseText(a.grossPaise),
            soiFreightQty: a.freightPaise > 0 ? qtyText(a.qty) : '0',
            soiFreightAmt: paiseText(a.freightPaise),
            soiLoadQty: a.loadPaise > 0 ? qtyText(a.qty) : '0',
            soiLoadAmt: paiseText(a.loadPaise),
            soiNetAmt: paiseText(a.netPaise),
          };
        }),
      )
      .run();
    tx.update(customers).set({ appOrderStatus: 'ordered' }).where(eq(customers.cusId, c.cusId)).run();
  });
  return soId;
}

export type VisitReason = 'shopClosed' | 'noOrder' | 'shopBusy' | 'ownerAway' | 'paymentPending' | 'nextVisit';
export const VISIT_REASONS: readonly VisitReason[] = ['shopClosed', 'noOrder', 'shopBusy', 'ownerAway', 'paymentPending', 'nextVisit'];
/**
 * Why nothing was collected (Receipt's "No collection" check-in), as VK Nex's visit reason codes:
 * it has no collection reasons of its own, so "Will pay next visit" goes as paymentPending.
 */
export const COLLECTION_REASONS: readonly VisitReason[] = ['shopClosed', 'ownerAway', 'paymentPending'];

export interface VisitFix {
  latitude: number;
  longitude: number;
  accuracyM: number | null;
  locatedAt: string;
}

/**
 * Save visit (Check in): waits for the next Sync. After a "no order" check-in the shop shows as
 * "No order" on the customer list, unless an order was already taken there on this trip; a "no
 * collection" check-in leaves the shop's status alone.
 */
export function saveVisit(
  v: { customerId: string; companyId: string | null; reason: VisitReason; remarks: string; fix: VisitFix | null; kind?: 'order' | 'collection' },
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
        visitedAt: new Date().toISOString(),
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

/** For the Upload button: orders and check-ins still to send. */
export const pendingOrdersCountQuery = () => db.select({ n: count() }).from(saleOrder).where(eq(saleOrder.appPendingUpload, true));
export const pendingVisitsCountQuery = () => db.select({ n: count() }).from(visits).where(eq(visits.appPendingUpload, true));
