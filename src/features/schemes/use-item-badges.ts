// The offer badges of the Add items rows loaded. A row shows one unit per item: `rowUnits`
// (itemId -> iucId) overrides it for an item (a row switched to another unit, on the order or not);
// without an override the item's default unit is used. An offer bound to another unit (an ITEM row
// for "PCS" while the row shows CASE) still shows, but outlined and never as applied.
import { useMemo } from 'react';

import { itemRowFor } from './scheme-rules';
import type { ItemBadge, SchemeOrder } from './scheme-order';
import { loadRowUnits } from './scheme-load';

export interface ItemBadgeView extends ItemBadge {
  /** The unit the badge speaks in (name) and whether the offer is for another unit. */
  unitName: string;
  unitMismatch: boolean;
}

export function useItemBadges(order: SchemeOrder, companyId: string, itemIds: readonly string[], rowUnits?: Readonly<Record<string, string>>): Record<string, ItemBadgeView[]> {
  const idsKey = itemIds.join(',');
  const unitsKey = rowUnits ? itemIds.map((i) => rowUnits[i] ?? '').join(',') : '';
  return useMemo(() => {
    const units = loadRowUnits(companyId, itemIds, rowUnits);
    const base = order.badgesFor(itemIds);
    const out: Record<string, ItemBadgeView[]> = {};
    for (const id of itemIds) {
      const u = units[id];
      out[id] = (base[id] ?? []).map((b) => {
        const s = order.scheme(b.schemeId);
        const probe =
          s && u
            ? itemRowFor(s, {
                row: 0,
                itemId: id,
                unitId: u.unitId,
                groupId: '',
                categoryId: '',
                brandId: '',
                sectionId: '',
                netQty: 1e9,
                rate: 0,
                gross: 0,
                netGross: 0,
                taxable: 0,
                schemeFlag: true,
                isFree: false,
                hasManualDisc: false,
              })
            : null;
        return { ...b, unitName: u?.unitName ?? '', unitMismatch: !!probe && probe.why === 'unit' };
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the ids' and units' text is their identity
  }, [order, companyId, idsKey, unitsKey]);
}
