// The offers on the order being taken, for the three order screens (Add items, Order item, Review).
// Derived every time from the draft (never stored): memoised on the lines, the switches, the
// shop and the offers; the offers are read again when Sync replaces them (live query on the table).
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useMemo } from 'react';

import { metaQuery } from '@/db/meta';
import { orderCustomerQuery, orderQuery, type OrderCustomer } from '@/features/orders/queries';
import type { SoLine } from '@/features/orders/order-draft';
import { todayISO } from '@/lib/money';
import { useAppSelector } from '@/store';

import { applyOffersOf, clockTime, offersInput } from './scheme-draft';
import { companySchemesQuery, loadItemAttrs, loadSchemeInputs, loadUnitIds, resolveFreeUnit } from './scheme-load';
import { evaluateOrder, type OrderFreeLine, type SchemeOrder } from './scheme-order';

export interface OrderSchemes {
  order: SchemeOrder;
  /** The order's Apply offers switch as it stands (its own value, else the shop's flag). */
  applyOffers: boolean;
  customer: OrderCustomer | undefined;
  /** Free lines this company has no unit for on the phone: Save leaves them out. */
  unresolvedFree: OrderFreeLine[];
  /** How many offers the phone holds for the company. */
  schemeCount: number;
}

/**
 * `lines` / `offersOn` replace the draft's (Order item works out the line being typed before it
 * is saved); `extraItemIds` are items on screen that are not on the order (their badges).
 */
export function useOrderSchemes(opts: { lines?: readonly SoLine[]; offersOn?: Readonly<Record<string, boolean>>; extraItemIds?: readonly string[] } = {}): OrderSchemes {
  const draft = useAppSelector((st) => st.orderDraft);
  const customerId = draft.customerId ?? '';
  const companyId = draft.companyId ?? '';
  const { data: found } = useLiveQuery(orderCustomerQuery(customerId), [customerId]);
  const { data: headers } = useLiveQuery(companySchemesQuery(companyId), [companyId]);
  const { data: itemsSynced } = useLiveQuery(metaQuery('itemsSyncedAt'));
  const customer = found[0];
  const itemsAt = itemsSynced[0]?.value ?? '';

  const lines = opts.lines ?? draft.lines;
  const offersOn = opts.offersOn ?? draft.offersOn;
  const extra = opts.extraItemIds;
  const itemKey = [...lines.map((l) => l.itemId), ...(extra ?? [])].join(',');
  const iucKey = lines.map((l) => l.iucId).join(',');

  const date = useMemo(() => (draft.editingSoId ? orderQuery(draft.editingSoId).get()?.soOrderDate : undefined) ?? todayISO(), [draft.editingSoId]);
  const schemes = useMemo(() => loadSchemeInputs(headers), [headers]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- re-read when the ids or the items change
  const itemAttrs = useMemo(() => loadItemAttrs(itemKey === '' ? [] : itemKey.split(',')), [itemKey, itemsAt]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- re-read when the units or the items change
  const unitIds = useMemo(() => loadUnitIds(companyId, iucKey === '' ? [] : iucKey.split(',')), [companyId, iucKey, itemsAt]);

  const order = useMemo(
    () =>
      evaluateOrder(
        offersInput({
          draft: { lines, offersOn, applyOffers: draft.applyOffers, companyId: draft.companyId, branchId: draft.branchId, customerId: draft.customerId },
          customer,
          schemes,
          itemAttrs,
          unitIds,
          date,
          time: clockTime(),
        }),
      ),
    [lines, offersOn, draft.applyOffers, draft.companyId, draft.branchId, draft.customerId, customer, schemes, itemAttrs, unitIds, date],
  );
  const unresolvedFree = useMemo(() => order.freeLines.filter((f) => !resolveFreeUnit(companyId, f)), [order, companyId]);

  return { order, applyOffers: applyOffersOf(draft, customer), customer, unresolvedFree, schemeCount: schemes.length };
}
