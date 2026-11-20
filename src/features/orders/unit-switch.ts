import type { SoLine } from './order-draft';
import { priceForLevel, startingPrice } from './order-math';
import { soSeedLine, type OrderCustomer, type SoUnitRow } from './queries';

/**
 * The rate a line takes in a unit: that unit's price at the line's level when it has one, else the
 * shop's starting price there. Every unit has its own VK Nex price row, so nothing is multiplied
 * from the base unit's rate.
 */
export function unitStartPrice(u: SoUnitRow, c: OrderCustomer, level: number | null | undefined): { level: number; price: string } | null {
  const same = level ? priceForLevel(u, level) : null;
  return same && level ? { level, price: same } : startingPrice(u, c.cusPriceLevelId);
}

/**
 * The line again in another unit: that unit's id, factor, rate, MRP, minimum, cooly and freight,
 * keeping the quantity and discount as typed. Null when the unit has no price today.
 */
export function soLineInUnit(line: SoLine, u: SoUnitRow, c: OrderCustomer): SoLine | null {
  const start = unitStartPrice(u, c, line.priceLevel);
  if (!start) return null;
  return { ...soSeedLine(u, c, start), qty: line.qty, discMode: line.discMode, disc: line.disc };
}
