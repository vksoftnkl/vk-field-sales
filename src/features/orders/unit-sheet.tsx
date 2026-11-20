/**
 * Pick unit: the units an item can be ordered in, each with its size in the base unit
 * ("1 Box = 12 Pcs"), the shop's rate and the stock in that unit as of the last Sync. A tap picks
 * the unit and closes the sheet. Prices and stock are VK Nex's own per unit (each unit has its own
 * price row; stock is the base balance ÷ the factor), so nothing is worked out here but the text.
 */
import { useTranslation } from 'react-i18next';

import { BottomSheet, ChoiceRow } from '@/components/sheet';
import { formatAmount } from '@/lib/money';

import { qtyInBase, unitInBase, type UnitFactor } from './order-items';
import { num, qtyText, toPaise } from './order-math';

export interface SheetUnit extends UnitFactor {
  iucId: string;
  /** Stock free to sell, in this unit. */
  stockQty: string | null;
}

/** "1 Box = 12 Pcs" for a unit, '' for the base unit. */
export function useUnitEquals() {
  const { t } = useTranslation();
  return <T extends UnitFactor>(u: T, units: readonly T[]): string => {
    const conv = unitInBase(u, units);
    return conv ? t('so.unitEquals', { unit: u.unitName, n: qtyText(conv.n), base: conv.base }) : '';
  };
}

/** "4 Box (48 Pcs)": a quantity in a unit and in the base unit; "48 Pcs" in the base unit. */
export function useUnitQty() {
  const { t } = useTranslation();
  return <T extends UnitFactor>(qty: number, u: T, units: readonly T[]): string => {
    const inBase = qtyInBase(qty, u, units);
    return inBase ? t('so.unitQtyBase', { qty: qtyText(qty), unit: u.unitName, baseQty: qtyText(inBase.qty), base: inBase.base }) : t('so.unitQty', { qty: qtyText(qty), unit: u.unitName });
  };
}

/** "Stock 4 Box (48 Pcs)", or "Stock 48 Pcs" in the base unit. */
export function useUnitStock() {
  const { t } = useTranslation();
  const unitQty = useUnitQty();
  return <T extends SheetUnit>(u: T, units: readonly T[]): string => t('order.stock', { qty: unitQty(num(u.stockQty), u, units) });
}

export function UnitSheet<T extends SheetUnit>({
  visible,
  itemName,
  units,
  allUnits,
  selectedIucId,
  priceOf,
  onPick,
  onClose,
}: {
  visible: boolean;
  itemName: string;
  /** The units that may be picked (the priced ones). */
  units: readonly T[];
  /** Every unit of the item, so sizes read against its base unit even when that one has no rate. */
  allUnits: readonly T[];
  selectedIucId: string | undefined;
  /** The rate the line would take in this unit (the line's level, else the shop's). */
  priceOf: (u: T) => string | null;
  onPick: (u: T) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const equals = useUnitEquals();
  const stock = useUnitStock();
  return (
    <BottomSheet visible={visible} onClose={onClose} title={t('so.unitPick')} subtitle={itemName}>
      {units.map((u) => {
        const price = toPaise(priceOf(u));
        return (
          <ChoiceRow
            key={u.iucId}
            selected={u.iucId === selectedIucId}
            label={u.unitName}
            detail={[equals(u, allUnits), stock(u, allUnits)].filter(Boolean).join(' · ')}
            trailing={price !== null ? t('so.unitRate', { price: formatAmount(price), unit: u.unitName }) : undefined}
            onPress={() => {
              onPick(u);
              onClose();
            }}
          />
        );
      })}
    </BottomSheet>
  );
}
