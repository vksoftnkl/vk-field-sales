// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';

import reducer, {
  applyOffersSet,
  contextChosen,
  lineOffersSet,
  lineRemoved,
  lineSaved,
  orderCleared,
  orderLoaded,
  orderRepeated,
  qtyTyped,
  visitStarted,
  type SoLine,
} from './order-draft.ts';

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

test('each unit of an item is its own line (Add items has a row per unit)', () => {
  const box = seed('oil', { iucId: 'oil-box', unitName: 'Box', factor: '12' });
  let s = start();
  s = reducer(s, qtyTyped({ seed: seed('oil'), qty: '12' }));
  s = reducer(s, qtyTyped({ seed: box, qty: '2' }));
  assert.deepEqual(
    s.lines.map((l) => [l.iucId, l.qty]),
    [
      ['oil-pc', '12'],
      ['oil-box', '2'],
    ],
  );
  // Typing on the Box row changes only the Box line; emptying it takes only that line off.
  s = reducer(s, qtyTyped({ seed: box, qty: '3' }));
  s = reducer(s, qtyTyped({ seed: seed('oil'), qty: '' }));
  assert.deepEqual(
    s.lines.map((l) => [l.iucId, l.qty]),
    [['oil-box', '3']],
  );
  // Save line on Order item updates the line of its own unit.
  s = reducer(s, lineSaved({ ...s.lines[0]!, qty: '4' }));
  assert.deepEqual(
    s.lines.map((l) => [l.iucId, l.qty]),
    [['oil-box', '4']],
  );
});

test('Save line after a unit switch on Order item replaces the line it opened, in place, with its switch', () => {
  let s = start();
  s = reducer(s, qtyTyped({ seed: seed('oil', { promo: true }), qty: '12' }));
  s = reducer(s, qtyTyped({ seed: seed('tea'), qty: '1' }));
  s = reducer(s, lineOffersSet({ key: 'oil-pc', on: false }));
  s = reducer(s, lineSaved(seed('oil', { iucId: 'oil-box', unitName: 'Box', factor: '12', qty: '1', promo: true }), 'oil-pc'));
  assert.deepEqual(
    s.lines.map((l) => [l.iucId, l.qty]),
    [
      ['oil-box', '1'],
      ['tea-pc', '1'],
    ],
  );
  assert.deepEqual(s.offersOn, { 'oil-box': false }, 'the switch moves with the line');
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

// --- offers: the per-line switch and the order's Apply offers switch ---------------------------------

test("a new draft has every offer on and Apply offers untouched (the shop's own flag)", () => {
  const s = start();
  assert.deepEqual(s.offersOn, {});
  assert.equal(s.applyOffers, null);
});

test('the line switch keeps only an explicit off; on again takes the key away', () => {
  let s = reducer(start(), qtyTyped({ seed: seed('oil', { promo: true }), qty: '2' }));
  s = reducer(s, lineOffersSet({ key: 'oil-pc', on: false }));
  assert.deepEqual(s.offersOn, { 'oil-pc': false });
  s = reducer(s, lineOffersSet({ key: 'oil-pc', on: true }));
  assert.deepEqual(s.offersOn, {});
});

test('Apply offers is set on or off', () => {
  let s = reducer(start(), applyOffersSet(false));
  assert.equal(s.applyOffers, false);
  s = reducer(s, applyOffersSet(true));
  assert.equal(s.applyOffers, true);
});

test('taking a line off (typing nothing, or Remove) forgets its switch', () => {
  let s = reducer(start(), qtyTyped({ seed: seed('oil'), qty: '2' }));
  s = reducer(s, qtyTyped({ seed: seed('tea'), qty: '1' }));
  s = reducer(s, lineOffersSet({ key: 'oil-pc', on: false }));
  s = reducer(s, lineOffersSet({ key: 'tea-pc', on: false }));
  s = reducer(s, qtyTyped({ seed: seed('oil'), qty: '' }));
  assert.deepEqual(s.offersOn, { 'tea-pc': false });
  s = reducer(s, lineRemoved('tea-pc'));
  assert.deepEqual(s.offersOn, {});
});

test('a new visit, a repeat, another company and a clear reset the switches', () => {
  let s = reducer(start(), applyOffersSet(false));
  s = reducer(s, lineOffersSet({ key: 'oil-pc', on: false }));
  assert.deepEqual(reducer(s, visitStarted({ customerId: 'cus-2', companyId: 'co-1', branchId: 'br-1', at: '2026-11-18T11:00:00.000Z' })).offersOn, {});
  assert.equal(reducer(s, visitStarted({ customerId: 'cus-2', companyId: 'co-1', branchId: 'br-1', at: '2026-11-18T11:00:00.000Z' })).applyOffers, null);
  const rep = reducer(s, orderRepeated({ customerId: 'cus-1', companyId: 'co-1', branchId: 'br-1', lines: [] }));
  assert.deepEqual([rep.offersOn, rep.applyOffers], [{}, null]);
  assert.deepEqual(reducer(s, contextChosen({ companyId: 'co-2', branchId: null })).offersOn, {});
  assert.deepEqual(reducer(s, contextChosen({ companyId: 'co-1', branchId: 'br-9' })).offersOn, { 'oil-pc': false }, 'the same company keeps them');
  const cleared = reducer(s, orderCleared());
  assert.deepEqual([cleared.offersOn, cleared.applyOffers], [{}, null]);
});

test('a loaded order brings its switches back', () => {
  const s = reducer(
    undefined,
    orderLoaded({
      customerId: 'cus-1',
      companyId: 'co-1',
      branchId: 'br-1',
      editingSoId: 'so-1',
      lines: [seed('oil', { qty: '2' })],
      deliveryDate: null,
      priority: 'NORMAL',
      remarks: '',
      checkIn: null,
      offersOn: { 'oil-pc': false },
      applyOffers: false,
    }),
  );
  assert.equal(s.entry, 'edit');
  assert.deepEqual([s.offersOn, s.applyOffers], [{ 'oil-pc': false }, false]);
});
