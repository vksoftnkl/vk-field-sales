// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { baseUnitOf, groupUnits, pickableUnits, qtyInBase, shownUnit, unitInBase } from './order-items.ts';

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

test('only priced units can be picked', () => {
  const [it] = groupUnits(units);
  assert.deepEqual(pickableUnits(it!).map((u) => u.iucId), ['u-box', 'u-pcs']);
});

test("a row shows the line's unit, else the picked unit while priced, else the default", () => {
  const [it] = groupUnits(units);
  assert.equal(shownUnit(it!, undefined, undefined).iucId, 'u-box');
  assert.equal(shownUnit(it!, undefined, 'u-pcs').iucId, 'u-pcs');
  assert.equal(shownUnit(it!, 'u-pcs', 'u-box').iucId, 'u-pcs');
  // A pick that is no longer priced (a Sync dropped its rate), or gone, falls back.
  assert.equal(shownUnit(it!, undefined, 'u-ctn').iucId, 'u-box');
  assert.equal(shownUnit(it!, undefined, 'u-gone').iucId, 'u-box');
});
