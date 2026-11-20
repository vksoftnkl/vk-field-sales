// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { baseUnitOf, qtyInBase, stockLeft, unitInBase } from './order-items.ts';

const unit = (iucId: string, unitName: string, factor: string, isDefault = false, appPriced = true) => ({ itemId: 'i1', iucId, unitName, factor, isDefault, appPriced });

const pcs = unit('u-pcs', 'Pcs', '1.000000');
const box = unit('u-box', 'Box', '12.000000', true);
const carton = unit('u-ctn', 'Carton', '144.000000', false, false);
const units = [box, pcs, carton];

test('the base unit is the one with factor 1, else the smallest', () => {
  assert.equal(baseUnitOf(units)?.iucId, 'u-pcs');
  assert.equal(baseUnitOf([box, carton])?.iucId, 'u-box');
  assert.equal(baseUnitOf([unit('x', 'X', '0'), unit('y', 'Y', '')]), undefined);
});

test('a unit reads as so many base units, the base unit itself as nothing', () => {
  assert.deepEqual(unitInBase(box, units), { n: 12, base: 'Pcs' });
  assert.deepEqual(unitInBase(carton, units), { n: 144, base: 'Pcs' });
  assert.equal(unitInBase(pcs, units), null);
  // Only Box and Carton on the phone: a carton is 12 boxes.
  assert.deepEqual(unitInBase(carton, [box, carton]), { n: 12, base: 'Box' });
  // A unit of the same size, or no factor, says nothing.
  assert.equal(unitInBase(unit('u-ea', 'Each', '1'), units), null);
  assert.equal(unitInBase(unit('u-bad', 'Bad', '0'), units), null);
});

test('fractions of the base unit (250 g of a kg) and numeric factors', () => {
  const kg = unit('kg', 'Kg', '1');
  const g250 = unit('g250', '250 g', '0.25');
  assert.deepEqual(unitInBase(g250, [kg, g250]), { n: 0.25, base: 'Kg' });
  assert.deepEqual(unitInBase({ unitName: 'Bag', factor: 25 }, [{ unitName: 'Kg', factor: 1 }]), { n: 25, base: 'Kg' });
});

test('stock in a unit converts to the base unit', () => {
  assert.deepEqual(qtyInBase(4, box, units), { qty: 48, base: 'Pcs' });
  assert.deepEqual(qtyInBase(0.5, box, units), { qty: 6, base: 'Pcs' });
  assert.equal(qtyInBase(7, pcs, units), null);
});

test('units of one item on one order share its stock: the earlier lines draw first', () => {
  const line = (iucId: string, qty: string, factor: string, itemId = 'i1') => ({ itemId, iucId, qty, factor });
  // 48 Pcs in stock = 4 Box. The order has 2 Box, then 10 Pcs.
  const lines = [line('u-box', '2', '12'), line('u-tea', '9', '1', 'tea'), line('u-pcs', '10', '1')];
  // The Box line comes first: all 4 Box are there for it.
  assert.equal(stockLeft(lines, { itemId: 'i1', iucId: 'u-box', factor: '12' }, 4), 4);
  // The Pcs line comes after 2 Box (24 Pcs): 24 Pcs left; another item's line takes nothing.
  assert.equal(stockLeft(lines, { itemId: 'i1', iucId: 'u-pcs', factor: '1' }, 48), 24);
  // A Carton row not on the order comes after both: 48 - 24 - 10 = 14 Pcs = 0.097 Carton of 144.
  assert.equal(stockLeft(lines, { itemId: 'i1', iucId: 'u-ctn', factor: '144' }, 48 / 144), 0.097);
  // Over-ordered in Pcs first: the Box row is left with less than nothing.
  assert.equal(stockLeft([line('u-pcs', '60', '1')], { itemId: 'i1', iucId: 'u-box', factor: '12' }, 4), -1);
  // No other unit on the order, or no factor: the unit's own stock.
  assert.equal(stockLeft([line('u-box', '9', '12')], { itemId: 'i1', iucId: 'u-box', factor: '12' }, 4), 4);
  assert.equal(stockLeft(lines, { itemId: 'i1', iucId: 'u-x', factor: '0' }, 7), 7);
});
