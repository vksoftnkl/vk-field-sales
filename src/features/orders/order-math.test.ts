// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  decimalInput,
  lineAmounts,
  lineProblem,
  orderTotals,
  paiseText,
  priceForLevel,
  pricedLevels,
  qtyText,
  startingPrice,
  toPaise,
  type LineInput,
  type UnitPrices,
} from './order-math.ts';

const unit: UnitPrices = {
  ipmSalesPriceA: '172.00',
  ipmSalesPriceB: '168.00',
  ipmSalesPriceC: null,
  ipmSalesPriceD: '0.00',
  ipmMaxPrice: '185.00',
  ipmMinPrice: '160.00',
};

const line = (over: Partial<LineInput> = {}): LineInput => ({
  qty: '10',
  price: '168.00',
  discPerc: '',
  discPerUnit: '',
  loadPerUnit: '0',
  freightPerUnit: '0',
  ...over,
});

test('money is exact paise both ways', () => {
  assert.equal(toPaise('168.00'), 16800);
  assert.equal(toPaise('0.29'), 29);
  assert.equal(toPaise(''), null);
  assert.equal(toPaise('abc'), null);
  assert.equal(paiseText(164640), '1646.40');
  assert.equal(qtyText(12.48), '12.48');
  assert.equal(qtyText(3), '3');
});

test('number boxes keep digits and one dot', () => {
  assert.equal(decimalInput('1,5'), '1.5');
  assert.equal(decimalInput('12.345'), '12.34');
  assert.equal(decimalInput('1.2.3', 3), '1.23');
  assert.equal(decimalInput('-7a'), '7');
  assert.equal(decimalInput('12.5', 0), '125');
});

test('price levels: 1-4 are A-D; a level with no price (or 0) is not offered', () => {
  assert.equal(priceForLevel(unit, 2), '168.00');
  assert.equal(priceForLevel(unit, 3), null);
  assert.equal(priceForLevel(unit, 4), null);
  assert.equal(priceForLevel(unit, 5), '185.00');
  assert.deepEqual(pricedLevels(unit), [1, 2]);
});

test("a new line starts at the customer's level, else the first priced one", () => {
  assert.deepEqual(startingPrice(unit, 2), { level: 2, price: '168.00' });
  assert.deepEqual(startingPrice(unit, 3), { level: 1, price: '172.00' });
  assert.deepEqual(startingPrice(unit, null), { level: 1, price: '172.00' });
  assert.equal(startingPrice({ ...unit, ipmSalesPriceA: null, ipmSalesPriceB: null }, 1), null);
});

test('discount is qty × price × % plus qty × ₹ per unit (the Qt formula)', () => {
  // The mockup's line: 10 × ₹168, 2 % → ₹33.60 off, ₹1,646.40.
  const a = lineAmounts(line({ discPerc: '2' }));
  assert.equal(a.grossPaise, 168000);
  assert.equal(a.discPaise, 3360);
  assert.equal(a.netPaise, 164640);
  const b = lineAmounts(line({ discPerUnit: '1' }));
  assert.equal(b.discPaise, 1000);
});

test('the order total adds cooly and freight to the lines, as OrderCheckout.qml', () => {
  const t = orderTotals([
    line({ discPerc: '2', loadPerUnit: '0.50', freightPerUnit: '1.00' }),
    line({ qty: '3', price: '1320.00', loadPerUnit: '3.00', freightPerUnit: '5.00' }),
    line({ price: '148.00', freightPerUnit: '0.50' }),
    line({ qty: '' }),
  ]);
  assert.equal(t.items, 3);
  assert.equal(t.qty, 23);
  assert.equal(t.loadPaise, 1400);
  assert.equal(t.freightPaise, 3000);
  assert.equal(t.grossPaise - t.discPaise, 708640);
  assert.equal(t.totalPaise, 708640 + 1400 + 3000);
});

test('Save refuses a line with no qty, no price, below the minimum, over 100 % or not above zero', () => {
  assert.equal(lineProblem(line(), '160.00'), null);
  assert.equal(lineProblem(line({ qty: '0' }), null), 'noQty');
  assert.equal(lineProblem(line({ price: '' }), null), 'noPrice');
  assert.equal(lineProblem(line({ price: '150.00' }), '160.00'), 'belowMin');
  assert.equal(lineProblem(line({ price: '150.00' }), '0.00'), null);
  assert.equal(lineProblem(line({ discPerc: '120' }), null), 'discTooBig');
  assert.equal(lineProblem(line({ discPerUnit: '168' }), null), 'notPositive');
});
