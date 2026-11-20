// Pure TypeScript (no React Native imports) so `npm test` can run it in Node.
//
// The draft order and its customer as the engine's input (the binder's "read the document"). The
// Review screen, the hook the order screens share and Save all build the input here, so what is
// shown is what is saved.
import type { SoLine } from '../orders/order-draft.ts';
import type { ItemAttrs, SchemeOrderInput } from './scheme-order.ts';
import type { SchemeInput } from './scheme-types.ts';

/** The draft fields offers read. */
export interface DraftForOffers {
  lines: readonly SoLine[];
  offersOn: Readonly<Record<string, boolean>>;
  applyOffers: boolean | null;
  companyId: string | null;
  branchId: string | null;
  customerId: string | null;
}

/** The customer columns offers read (cityId comes from the beat). */
export interface CustomerForOffers {
  cusGroupId: string | null;
  cusAreaId: string | null;
  cityId: string | null;
  cusPriceLevelId: number | null;
  cusAllowPromotion: boolean;
}

/** The order's Apply offers switch: its own value, else the customer's allow-promotion flag. */
export const applyOffersOf = (d: Pick<DraftForOffers, 'applyOffers'>, c: Pick<CustomerForOffers, 'cusAllowPromotion'> | undefined): boolean =>
  d.applyOffers ?? c?.cusAllowPromotion ?? false;

/** 'HH:MM:SS' on the phone's clock. */
export function clockTime(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`;
}

export function offersInput(a: {
  draft: DraftForOffers;
  customer: CustomerForOffers | undefined;
  schemes: readonly SchemeInput[];
  itemAttrs: Readonly<Record<string, ItemAttrs>>;
  /** iucId -> the unit id offers compare (the iucId itself: VK Nex's scheme units are iuc ids). */
  unitIds: Readonly<Record<string, string>>;
  /** The order's date: today, or the edited order's own date. */
  date: string;
  time: string;
}): SchemeOrderInput {
  const { draft: d, customer: c } = a;
  return {
    lines: d.lines,
    schemes: a.schemes,
    offersOn: d.offersOn,
    applyOffers: applyOffersOf(d, c),
    context: {
      companyId: d.companyId ?? '',
      branchId: d.branchId,
      customerId: d.customerId ?? '',
      custGroupId: c?.cusGroupId ?? null,
      areaId: c?.cusAreaId ?? null,
      cityId: c?.cityId ?? null,
      priceLevelId: c?.cusPriceLevelId ?? null,
      date: a.date,
      time: a.time,
      // Phone orders are always on credit (user's rule, 2026-11-18).
      billType: 'CREDIT',
    },
    itemAttrs: a.itemAttrs,
    unitIds: a.unitIds,
  };
}
