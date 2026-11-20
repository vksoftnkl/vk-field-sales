// Pure TypeScript (no React Native imports) so `npm test` can run it in Node.
import type { saleOrder, saleOrderItem } from '@/db/schema';

import { SO_ORDER_TYPE, toPriority } from '../features/orders/so-priority.ts';

import type { ApiError, CreatedOrder } from './vk-nex-api';

export type OrderHeader = typeof saleOrder.$inferSelect;
export type OrderLine = typeof saleOrderItem.$inferSelect;

/** An order taken on the phone and not yet on VK Nex, with what the upload needs about its customer. */
export interface PendingOrder {
  header: OrderHeader;
  lines: OrderLine[];
  /** The customer is still waiting to reach VK Nex (or was refused): the order must wait for it. */
  customerPending: boolean;
  /** The customer's price level, for an order saved without one. */
  customerPriceLevelId: number | null;
  /**
   * iuc_id → iuc_to_base_factor (from the units Sync keeps) for lines saved without a factor (before
   * migration 0015). VK Nex stores a missing factor as 0, which its challans read as 1: a Box line
   * would be delivered as one base unit.
   */
  unitFactors?: Readonly<Record<string, string>>;
}

/** VK Nex's so_remarks is varchar(500). */
const REMARKS_MAX = 500;

/** The Qt app's way of carrying the vehicle number (VK Nex's order has no column for it). */
export function remarksWithVehicle(remarks: string | null, vehicleNo: string | null): string | null {
  const r = (remarks ?? '').trim();
  const v = (vehicleNo ?? '').trim();
  const text = v ? `${r}###${v}` : r;
  return text ? text.slice(0, REMARKS_MAX) : null;
}

/** Keys with no value are left out: VK Nex fills its defaults, and it refuses null on most number fields. */
function compact(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== null && v !== undefined && v !== '') out[k] = v;
  return out;
}

/**
 * Body for POST /mobile/orders/create: VK Nex's desktop order (so* / soi*) without the keys it
 * fills itself (branch, year, device, number, status). The phone's so_id goes as soClientUuid;
 * the phone-only app_* columns (names, discount mode, check-in) stay on the phone.
 * soUserId is not sent: Sync always signs in, and VK Nex then takes the signed-in user. deviceUid
 * is added by the client.
 */
export function toOrderPayload(o: PendingOrder): Record<string, unknown> {
  const h = o.header;
  return {
    ...compact({
      soClientUuid: h.soId,
      soCompanyId: h.soCompanyId,
      // The branch picked in Switch company when the order was taken. Absent on older orders: VK Nex
      // then uses the phone's Device List branch, else the company's default, as before.
      soBranchId: h.soBranchId,
      soCustId: h.soCustId,
      soCustName: h.soCustName,
      soPriceLevel: h.soPriceLevel ?? o.customerPriceLevelId,
      soOrderDate: h.soOrderDate,
      soOrderDatetime: h.soOrderDatetime,
      soTotItems: h.soTotItems,
      soTotBags: h.soTotBags,
      soGrossAmt: h.soGrossAmt,
      soItemDisc: h.soItemDisc,
      soFreightAmt: h.soFreightAmt,
      soLoadAmt: h.soLoadAmt,
      soOrderAmt: h.soOrderAmt,
      soRemarks: remarksWithVehicle(h.soRemarks, h.appVehicleNo),
      // Since the 3b workflow; null on older orders, so their keys stay out as before.
      soUsrRefno: h.soUsrRefno,
      // Phone orders are on credit. Older orders saved without a term go as CREDIT too (VK Nex's
      // own default would be CASH); a term saved on the order is sent as it is.
      soOrderType: h.soOrderType ?? SO_ORDER_TYPE,
      soDeliveryDate: h.soDeliveryDate,
      // Always sent: the old urgent flag ('URGENT') stays URGENT, no flag (null) goes as NORMAL.
      soPriority: toPriority(h.soPriority),
      soValidUntil: h.soValidUntil,
      soHasPromo: h.soHasPromo,
      soTaxableAmt: h.soTaxableAmt,
      soCgstAmt: h.soCgstAmt,
      soSgstAmt: h.soSgstAmt,
      soIgstAmt: h.soIgstAmt,
      soTaxAmt: h.soTaxAmt,
      soRoundOff: h.soRoundOff,
      // Offers (migration 0018): null on older orders, so their keys stay out as before.
      soSchDisc: h.soSchDisc,
      soBillSchDisc: h.soBillSchDisc,
    }),
    soHasLoad: h.soHasLoad,
    soHasFreight: h.soHasFreight,
    items: [...o.lines]
      .sort((a, b) => a.soiLineNo - b.soiLineNo)
      .map((l) => ({
        ...compact({
          soiLineNo: l.soiLineNo,
          soiItemId: l.soiItemId,
          soiItemUnitId: l.soiItemUnitId,
          soiPriceLevel: l.soiPriceLevel,
          soiOrderQty: l.soiOrderQty,
          soiNetQty: l.soiNetQty,
          soiRate: l.soiRate,
          soiMaxPrice: l.soiMaxPrice,
          soiItemDiscPerc: l.soiItemDiscPerc,
          soiItemDiscQty: l.soiItemDiscQty,
          soiItemDiscAmt: l.soiItemDiscAmt,
          soiGrossAmt: l.soiGrossAmt,
          soiFreightQty: l.soiFreightQty,
          soiFreightAmt: l.soiFreightAmt,
          soiLoadQty: l.soiLoadQty,
          soiLoadAmt: l.soiLoadAmt,
          soiNetAmt: l.soiNetAmt,
          soiToBaseFactor: l.soiToBaseFactor ?? o.unitFactors?.[l.soiItemUnitId] ?? null,
          soiHsnCode: l.soiHsnCode,
          soiTaxId: l.soiTaxId,
          soiIsTaxIncl: l.soiIsTaxIncl,
          soiMinPrice: l.soiMinPrice,
          soiTaxableAmt: l.soiTaxableAmt,
          soiTaxPerc: l.soiTaxPerc,
          soiTaxAmt: l.soiTaxAmt,
          soiCgstPerc: l.soiCgstPerc,
          soiCgstAmt: l.soiCgstAmt,
          soiSgstPerc: l.soiSgstPerc,
          soiSgstAmt: l.soiSgstAmt,
          soiIgstPerc: l.soiIgstPerc,
          soiIgstAmt: l.soiIgstAmt,
          // Offers: a free line (type SCHEME, rate 0) and a paid line's scheme money. Null on lines
          // with no offer and on older orders, so the keys stay out; soiIsFree only when true.
          soiIsFree: l.soiIsFree ? true : null,
          soiFreeType: l.soiFreeType,
          soiSchemeId: l.soiSchemeId,
          soiSchemeName: l.soiSchemeName,
          soiSchDiscPerc: l.soiSchDiscPerc,
          soiSchDiscQty: l.soiSchDiscQty,
          soiSchDiscAmt: l.soiSchDiscAmt,
          soiBillSchPerc: l.soiBillSchPerc,
          soiBillSchAmt: l.soiBillSchAmt,
        }),
        soiIsPromo: l.soiIsPromo,
      })),
  };
}

export type OrderUploadStatus = 'uploaded' | 'alreadySaved' | 'refused' | 'waiting';

export interface OrderOutcome {
  /** The phone's so_id (= soClientUuid). */
  localId: string;
  customerName: string;
  status: OrderUploadStatus;
  /** VK Nex's order number and status once it has the order. */
  orderRefno?: string;
  orderStatus?: string;
  /** VK Nex deleted the order since it was first sent. */
  deletedOnServer?: boolean;
  /** VK Nex took the order but could not confirm it, so it is a draft for the office: its code and words. */
  keptDraft?: string;
  error?: string;
}

export interface OrderUploadDeps {
  create(payload: Record<string, unknown>): Promise<CreatedOrder>;
  /** VK Nex has it: keep its id, number and status, clear the upload flag. */
  markSynced(localId: string, created: CreatedOrder): void;
  /** Keep it waiting, with the reason to show. */
  markRefused(localId: string, error: string): void;
  onProgress?(done: number, total: number): void;
}

export interface SendResult<T> {
  outcomes: T[];
  /**
   * VK Nex refused the phone itself (403: not registered on the Device List screen, blocked,
   * switched off, or no right). Orders and visits stop; the rest of Sync goes on.
   */
  refusedBy?: ApiError;
  /** No answer, 5xx, sign-in lost: the whole Sync stops; the rest stay waiting. */
  stoppedBy?: unknown;
}

const isApi = (e: unknown): e is ApiError => (e as { kind?: unknown } | null)?.kind === 'api';

/** Refusals about this one record: note it and go on with the next. */
export const isRecordRefusal = (e: unknown): e is ApiError => isApi(e) && [400, 404, 409, 422].includes(e.status);
/** VK Nex refuses the phone (device or rights): no record of this kind will go through. */
export const isDeviceRefusal = (e: unknown): e is ApiError => isApi(e) && e.status === 403;

export const reasonText = (e: ApiError) => (e.code ? `${e.code}: ${e.message}` : e.message);

export const CUSTOMER_NOT_SENT = 'CUSTOMER_NOT_SENT: The customer is not on VK Nex yet; the order goes after it.';

/**
 * Sends every waiting order, one request each, oldest first. Each one is marked synced as soon as
 * VK Nex has it. A resend after a lost answer is safe: VK Nex answers the order it saved before
 * (duplicate), which is marked synced the same way.
 */
export async function uploadOrders(pending: readonly PendingOrder[], deps: OrderUploadDeps): Promise<SendResult<OrderOutcome>> {
  const outcomes: OrderOutcome[] = [];
  for (const [i, o] of pending.entries()) {
    deps.onProgress?.(i, pending.length);
    const localId = o.header.soId;
    const customerName = o.header.soCustName;
    if (o.customerPending) {
      deps.markRefused(localId, CUSTOMER_NOT_SENT);
      outcomes.push({ localId, customerName, status: 'waiting', error: CUSTOMER_NOT_SENT });
      continue;
    }
    try {
      const created = await deps.create(toOrderPayload(o));
      deps.markSynced(localId, created);
      outcomes.push({
        localId,
        customerName,
        status: created.duplicate ? 'alreadySaved' : 'uploaded',
        orderRefno: created.soOrderRefno,
        orderStatus: created.soStatus,
        deletedOnServer: created.soIsDeleted,
        ...(created.confirmRefused ? { keptDraft: `${created.confirmRefused.code}: ${created.confirmRefused.message}` } : {}),
      });
    } catch (e) {
      if (isDeviceRefusal(e)) return { outcomes, refusedBy: e };
      if (!isRecordRefusal(e)) return { outcomes, stoppedBy: e };
      deps.markRefused(localId, reasonText(e));
      outcomes.push({ localId, customerName, status: 'refused', error: reasonText(e) });
    }
  }
  deps.onProgress?.(pending.length, pending.length);
  return { outcomes };
}
