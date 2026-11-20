/**
 * Unit wording for the order screens: a unit's size in the item's base unit ("1 Box = 12 Pcs") and
 * quantities in a unit and in the base unit ("Stock 4 Box (48 Pcs)"). Prices and stock are VK Nex's
 * own per unit (each unit has its own price row; stock is the base balance ÷ the factor), so
 * nothing is worked out here but the text. (Was unit-sheet.tsx with the Pick unit sheet, gone
 * since Add items lists every unit as its own row, 2026-11-20.)
 */
import { useTranslation } from 'react-i18next';

import { qtyInBase, unitInBase, type UnitFactor } from './order-items';
import { num, qtyText } from './order-math';

/** "1 Box = 12 Pcs" for a unit, '' for the base unit. `units` = every unit of the item. */
export function useUnitEquals() {
  const { t } = useTranslation();
  return (u: UnitFactor, units: readonly UnitFactor[]): string => {
    const conv = unitInBase(u, units);
    return conv ? t('so.unitEquals', { unit: u.unitName, n: qtyText(conv.n), base: conv.base }) : '';
  };
}

/** "4 Box (48 Pcs)": a quantity in a unit and in the base unit; "48 Pcs" in the base unit. */
export function useUnitQty() {
  const { t } = useTranslation();
  return (qty: number, u: UnitFactor, units: readonly UnitFactor[]): string => {
    const inBase = qtyInBase(qty, u, units);
    return inBase ? t('so.unitQtyBase', { qty: qtyText(qty), unit: u.unitName, baseQty: qtyText(inBase.qty), base: inBase.base }) : t('so.unitQty', { qty: qtyText(qty), unit: u.unitName });
  };
}

/** "Stock 4 Box (48 Pcs)", or "Stock 48 Pcs" in the base unit. */
export function useUnitStock() {
  const { t } = useTranslation();
  const unitQty = useUnitQty();
  return (u: UnitFactor & { stockQty: string | null }, units: readonly UnitFactor[]): string => t('order.stock', { qty: unitQty(num(u.stockQty), u, units) });
}
