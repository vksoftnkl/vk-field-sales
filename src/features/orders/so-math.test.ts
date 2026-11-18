// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { creditView } from './credit.ts';
import { inFilter, isRecentOpen, nextRefSeq, phoneRef, soState, validUntil } from './order-status.ts';
import { backOrderQty, discountPaise, soLineAmounts, soLineProblem, soTotals, unitsPerDefault, type SoLineInput } from './so-math.ts';

const line = (over: Partial<SoLineInput> = {}): SoLineInput => ({
  qty: '10',
  price: '168.00',
  discMode: 'perc',
  disc: '',
  taxPerc: '5.000',
  inclTax: false,
  loadPerUnit: '0',
  freightPerUnit: '0',
  ...over,
});

test('the canvas sample line: 10 × ₹168, 2% off, GST 5% on top', () => {
  const a = soLineAmounts(line({ disc: '2' }));
  assert.equal(a.grossPaise, 168000);
  assert.equal(a.discPaise, 3360);
  assert.equal(a.taxablePaise, 164640);
  assert.equal(a.taxPaise, 8232);
  assert.equal(a.cgstPaise + a.sgstPaise, 8232);
  assert.equal(a.igstPaise, 0);
  assert.equal(a.lineTotalPaise, 172872);
});

test('the canvas sample order adds up to ₹7,485.00 with ₹0.28 round off', () => {
  const t = soTotals([
    line({ disc: '2', freightPerUnit: '1.00', loadPerUnit: '0.50' }),
    line({ qty: '3', price: '1320.00', freightPerUnit: '5.00', loadPerUnit: '1.50' }),
    line({ qty: '10', price: '148.00', freightPerUnit: '0.50', loadPerUnit: '0.45' }),
    line({ qty: '' }),
  ]);
  assert.equal(t.items, 3);
  assert.equal(t.qty, 23);
  assert.equal(t.grossPaise, 712000);
  assert.equal(t.discPaise, 3360);
  assert.equal(t.taxablePaise, 708640);
  assert.equal(t.cgstPaise, 17716);
  assert.equal(t.sgstPaise, 17716);
  assert.equal(t.freightPaise, 3000);
  assert.equal(t.loadPaise, 1400);
  assert.equal(t.roundOffPaise, 28);
  assert.equal(t.totalPaise, 748500);
});

test('discount modes: %, ₹ per unit, ₹ for the line', () => {
  assert.equal(discountPaise('perc', '2', 168000, 10), 3360);
  assert.equal(discountPaise('perUnit', '2', 168000, 10), 2000);
  assert.equal(discountPaise('total', '25.50', 168000, 10), 2550);
  assert.equal(discountPaise('total', '', 168000, 10), 0);
  assert.equal(discountPaise('perc', '-3', 168000, 10), 0);
});

test('an inclusive rate keeps exactly what was typed; GST is taken out of it', () => {
  const a = soLineAmounts(line({ qty: '1', price: '105.00', inclTax: true }));
  assert.equal(a.taxablePaise, 10000);
  assert.equal(a.taxPaise, 500);
  assert.equal(a.lineTotalPaise, 10500);
});

test('inter-state orders carry IGST only', () => {
  const a = soLineAmounts(line({ qty: '1', price: '100.00' }), true);
  assert.deepEqual([a.cgstPaise, a.sgstPaise, a.igstPaise], [0, 0, 500]);
});

test('net amount (soi_net_amt) is the whole line with its freight and cooly', () => {
  const a = soLineAmounts(line({ qty: '2', price: '100.00', freightPerUnit: '1.00', loadPerUnit: '0.50' }));
  assert.equal(a.lineTotalPaise, 21000);
  assert.equal(a.netPaise, 21300);
});

test('line checks: qty, price, minimum, MRP, discount', () => {
  const limits = { minPrice: '160.00', mrp: '185.00' };
  assert.equal(soLineProblem(line(), limits), null);
  assert.equal(soLineProblem(line({ qty: '0' }), limits), 'noQty');
  assert.equal(soLineProblem(line({ price: '' }), limits), 'noPrice');
  assert.equal(soLineProblem(line({ price: '150' }), limits), 'belowMin');
  assert.equal(soLineProblem(line({ price: '190' }), limits), 'aboveMrp');
  assert.equal(soLineProblem(line({ disc: '120' }), limits), 'discTooBig');
  assert.equal(soLineProblem(line({ discMode: 'total', disc: '1680' }), limits), 'notPositive');
  assert.equal(soLineProblem(line({ price: '190' }), { minPrice: null, mrp: '0' }), null);
});

test('stock never blocks: the part above it is a back-order', () => {
  assert.equal(backOrderQty(10, 6), 4);
  assert.equal(backOrderQty(5, 6), 0);
  assert.equal(backOrderQty(3, -2), 3);
  assert.equal(backOrderQty(0, 0), 0);
});

test('units per default unit', () => {
  assert.equal(unitsPerDefault('12', '1'), 12);
  assert.equal(unitsPerDefault('1', '1'), 1);
  assert.equal(unitsPerDefault(null, '1'), 1);
});

test('status: phone states first, then VK Nex so_status', () => {
  assert.equal(soState({ appPendingUpload: true, appSyncError: null, soStatus: null }), 'waiting');
  assert.equal(soState({ appPendingUpload: true, appSyncError: 'CUSTOMER_NOT_SENT: …', soStatus: null }), 'waiting');
  assert.equal(soState({ appPendingUpload: true, appSyncError: 'MOBILE_BRANCH_NOT_RESOLVED: no branch', soStatus: null }), 'sentBack');
  assert.equal(soState({ appPendingUpload: false, appSyncError: null, soStatus: 'DRAFT' }), 'office');
  assert.equal(soState({ appPendingUpload: false, appSyncError: null, soStatus: 'PARTIAL' }), 'part');
  assert.equal(soState({ appPendingUpload: false, appSyncError: null, soStatus: 'COMPLETED' }), 'delivered');
  assert.equal(soState({ appPendingUpload: false, appSyncError: null, soStatus: null }), 'office');
});

test('My orders filters', () => {
  assert.equal(inFilter('sentBack', 'attention'), true);
  assert.equal(inFilter('waiting', 'attention'), false);
  assert.equal(inFilter('waiting', 'waiting'), true);
  assert.equal(inFilter('part', 'open'), true);
  assert.equal(inFilter('delivered', 'open'), false);
  assert.equal(inFilter('cancelled', 'all'), true);
});

test('open orders are the last 30 days only', () => {
  assert.equal(isRecentOpen({ state: 'office', soOrderDate: '2026-11-01' }, '2026-11-18'), true);
  assert.equal(isRecentOpen({ state: 'office', soOrderDate: '2026-10-01' }, '2026-11-18'), false);
  assert.equal(isRecentOpen({ state: 'delivered', soOrderDate: '2026-11-17' }, '2026-11-18'), false);
  assert.equal(validUntil('2026-11-18'), '2026-12-18');
});

test('phone reference: series, ddmmyy, day count', () => {
  assert.equal(phoneRef('VKSMAN-0A1B2C3D3F9A', '2026-11-18', 3), '3F9A-181126-03');
  assert.equal(nextRefSeq([]), 1);
  assert.equal(nextRefSeq(['3F9A-181126-01', null, '3F9A-181126-07']), 8);
});

test('credit: used, left, over the limit after this order, overdue', () => {
  const v = creditView({ outstandingPaise: 3845000, limitPaise: 5000000, creditDays: 0, oldestBillDate: '2026-10-07', today: '2026-11-18', orderPaise: 748500 });
  assert.equal(v.usedPerc, 77);
  assert.equal(v.leftPaise, 1155000);
  assert.equal(v.afterOrderPaise, 4593500);
  assert.equal(v.overLimit, false);
  assert.equal(v.oldestDays, 42);
  assert.equal(v.overdue, true);
  assert.equal(v.warn, true);
  const none = creditView({ outstandingPaise: 0, limitPaise: 0, creditDays: 60, oldestBillDate: '2026-10-07', today: '2026-11-18' });
  assert.equal(none.hasLimit, false);
  assert.equal(none.overdue, false);
  assert.equal(none.warn, false);
});
