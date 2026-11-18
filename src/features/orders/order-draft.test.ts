// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';

import reducer, { contextChosen, lineSaved, orderCleared, qtyTyped, visitStarted, type SoLine } from './order-draft.ts';

const seed = (itemId: string, over: Partial<SoLine> = {}): SoLine => ({
  itemId,
  iucId: `${itemId}-pc`,
  name: itemId,
  nameTa: null,
  unitName: 'Pc',
  factor: '1',
  qty: '',
  price: '10.00',
  priceLevel: 1,
  discMode: 'perc',
  disc: '',
  taxPerc: '5.000',
  inclTax: false,
  taxId: null,
  hsnCode: null,
  loadPerUnit: '0',
  freightPerUnit: '0',
  mrp: null,
  minPrice: null,
  promo: false,
  ...over,
});

const start = (at = '2026-11-18T05:00:00.000Z') => reducer(undefined, visitStarted({ customerId: 'cus-1', companyId: 'co-1', branchId: 'br-1', at }));

test('a visit checks in; an order in progress keeps its check-in, an empty one starts again', () => {
  let s = start();
  assert.equal(s.checkIn?.at, '2026-11-18T05:00:00.000Z');
  s = reducer(s, visitStarted({ customerId: 'cus-1', companyId: 'co-1', branchId: 'br-1', at: '2026-11-18T09:00:00.000Z' }));
  assert.equal(s.checkIn?.at, '2026-11-18T09:00:00.000Z', 'no items yet: a new check-in');
  s = reducer(s, qtyTyped({ seed: seed('oil'), qty: '2' }));
  s = reducer(s, visitStarted({ customerId: 'cus-1', companyId: 'co-1', branchId: 'br-1', at: '2026-11-18T10:00:00.000Z' }));
  assert.equal(s.checkIn?.at, '2026-11-18T09:00:00.000Z', 'items: the same visit goes on');
  assert.equal(s.lines.length, 1);
  s = reducer(s, visitStarted({ customerId: 'cus-2', companyId: 'co-1', branchId: 'br-1', at: '2026-11-18T11:00:00.000Z' }));
  assert.equal(s.lines.length, 0, 'another shop starts afresh');
});

test('qty on a row adds the line once, updates it, and an empty box takes it off', () => {
  let s = start();
  s = reducer(s, qtyTyped({ seed: seed('oil'), qty: '2' }));
  s = reducer(s, qtyTyped({ seed: seed('oil'), qty: '5' }));
  assert.deepEqual(
    s.lines.map((l) => [l.itemId, l.qty]),
    [['oil', '5']],
  );
  s = reducer(s, qtyTyped({ seed: s.lines[0]!, qty: '' }));
  assert.equal(s.lines.length, 0);
});

test('Save line replaces the item in another unit instead of adding a second line', () => {
  let s = start();
  s = reducer(s, qtyTyped({ seed: seed('oil'), qty: '12' }));
  s = reducer(s, lineSaved(seed('oil', { iucId: 'oil-box', unitName: 'Box', factor: '12', qty: '1' })));
  assert.deepEqual(
    s.lines.map((l) => [l.iucId, l.qty]),
    [['oil-box', '1']],
  );
});

test('a visit takes Switch company’s company and branch, and keeps them', () => {
  let s = start();
  assert.equal(s.companyId, 'co-1');
  assert.equal(s.branchId, 'br-1');
  s = reducer(s, qtyTyped({ seed: seed('oil'), qty: '2' }));
  // Switch company to another company meanwhile: the order in progress goes on for its own.
  s = reducer(s, visitStarted({ customerId: 'cus-1', companyId: 'co-2', branchId: 'br-9', at: '2026-11-18T12:00:00.000Z' }));
  assert.deepEqual([s.companyId, s.branchId, s.lines.length], ['co-1', 'br-1', 1]);
  // None picked yet: the visit starts without them.
  const none = reducer(undefined, visitStarted({ customerId: 'cus-3', companyId: 'co-1', branchId: null, at: '2026-11-18T12:00:00.000Z' }));
  assert.equal(none.branchId, null);
});

test('another company clears the lines (their prices are the first company’s)', () => {
  let s = start();
  s = reducer(s, qtyTyped({ seed: seed('oil'), qty: '2' }));
  s = reducer(s, contextChosen({ companyId: 'co-1', branchId: 'br-2' }));
  assert.equal(s.lines.length, 1, 'same company: the lines stay');
  assert.equal(s.branchId, 'br-2');
  s = reducer(s, contextChosen({ companyId: 'co-2', branchId: 'br-9' }));
  assert.deepEqual([s.companyId, s.branchId], ['co-2', 'br-9']);
  assert.equal(s.lines.length, 0);
  assert.ok(s.checkIn, 'the check-in stays');
  assert.equal(reducer(s, orderCleared()).customerId, null);
});
