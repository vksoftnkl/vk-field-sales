import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  adjustProblem,
  defaultSettle,
  lineQtyCheck,
  nextSplitNo,
  partAmounts,
  partProblems,
  pastWindow,
  planAdjust,
  returnEstimate,
  returnRefNo,
  todayRateBase,
  type ReturnPart,
} from './return-math.ts';

const part = (o: Partial<ReturnPart>): ReturnPart => ({
  key: o.key ?? 'k',
  billItemId: 'bi1',
  billAccYear: '2026-2027',
  splitNo: 0,
  itemId: 'oil',
  iucId: 'pcs',
  unitName: 'PCS',
  factor: '1',
  name: 'Sunflower Oil 1L',
  nameTa: null,
  qty: '1',
  condition: 'RESTOCK',
  notes: '',
  batchNo: '',
  expiryDate: '',
  ratePreTaxBase: '150',
  taxPerc: '5',
  igst: false,
  rateSource: 'BILL',
  rateFrom: null,
  ...o,
});

test('a bill line gives back qty in base units × the taxable rate, GST on top split in two', () => {
  const a = partAmounts(part({ qty: '3' }));
  assert.equal(a.taxablePaise, 45000);
  assert.equal(a.taxPaise, 2250);
  assert.equal(a.cgstPaise + a.sgstPaise, 2250);
  assert.equal(a.netPaise, 47250);
  const box = partAmounts(part({ qty: '2', factor: '12', ratePreTaxBase: '10' }));
  assert.equal(box.taxablePaise, 24000);
});

test('IGST when the bill was inter-state', () => {
  const a = partAmounts(part({ qty: '1', igst: true, taxPerc: '18', ratePreTaxBase: '100' }));
  assert.equal(a.igstPaise, 1800);
  assert.equal(a.cgstPaise, 0);
});

test('the canvas sample: oil 3 good + 2 damaged, Surf 4 damaged', () => {
  const e = returnEstimate([
    part({ key: 'a', qty: '3' }),
    part({ key: 'b', qty: '2', splitNo: 1, condition: 'DAMAGED' }),
    part({ key: 'c', billItemId: 'bi2', itemId: 'surf', qty: '4', condition: 'DAMAGED', ratePreTaxBase: '200', taxPerc: '18' }),
    part({ key: 'd', billItemId: 'bi3', qty: '' }),
  ]);
  assert.equal(e.parts, 3);
  assert.equal(e.lines, 2);
  assert.equal(e.qty, 9);
  assert.equal(e.goodQty, 3);
  assert.equal(e.taxablePaise, 155000);
  assert.equal(e.taxPaise, 18150);
  assert.equal(e.exactPaise, 173150);
  assert.equal(e.totalPaise, 173200);
  assert.equal(e.roundOffPaise, 50);
});

test('all parts of one bill line together, in base units, against what is left', () => {
  const ok = lineQtyCheck([part({ qty: '3' }), part({ qty: '2' })], { qtyLeftBase: '20' });
  assert.equal(ok.over, 0);
  const over = lineQtyCheck([part({ qty: '1', factor: '12' })], { qtyLeftBase: '10' });
  assert.equal(over.askedBase, 12);
  assert.equal(over.over, 2);
});

test('a part needs a quantity; a typed expiry must be a date', () => {
  const p = partProblems([part({ key: 'x', qty: '' }), part({ key: 'y', expiryDate: '31-02-2027' }), part({ key: 'z', expiryDate: '28-02-2027' })]);
  assert.deepEqual(p.x, { qty: 'noQty' });
  assert.deepEqual(p.y, { expiryDate: 'badDate' });
  assert.equal(p.z, undefined);
});

test('splits are numbered after the line', () => {
  const parts = [part({ key: 'a' }), part({ key: 'b', splitNo: 1 }), part({ key: 'c', billItemId: 'bi2' })];
  assert.equal(nextSplitNo(parts, 'bi1|2026-2027'), 2);
  assert.equal(nextSplitNo(parts, 'bi2|2026-2027'), 1);
});

test('the return window: 0 = none', () => {
  assert.equal(pastWindow('2026-10-02', '2026-11-20', 45), true);
  assert.equal(pastWindow('2026-10-28', '2026-11-20', 45), false);
  assert.equal(pastWindow('2020-01-01', '2026-11-20', 0), false);
});

test('settle starts where VK Nex would', () => {
  assert.equal(defaultSettle(null, true, 1000), 'ADJUST');
  assert.equal(defaultSettle(null, true, 0), 'ADVANCE');
  assert.equal(defaultSettle(null, false, 1000), 'ADVANCE');
  assert.equal(defaultSettle('ADVANCE', true, 1000), 'ADVANCE');
});

const bills = [
  { billId: 'old', billAccYear: 'y', refno: 'SB/1842', pendingPaise: 845000, isThisBill: false },
  { billId: 'this', billAccYear: 'y', refno: 'SB/2107', pendingPaise: 1260000, isThisBill: true },
  { billId: 'new', billAccYear: 'y', refno: 'SB/2391', pendingPaise: 988000, isThisBill: false },
];

test('adjust: this bill first, then the others in order', () => {
  const p = planAdjust(175000, bills);
  assert.equal(p.rows[0]!.billId, 'this');
  assert.equal(p.rows[0]!.amountPaise, 175000);
  assert.equal(p.leftPaise, 0);
  const big = planAdjust(1300000, bills);
  assert.deepEqual(
    big.rows.map((r) => r.amountPaise),
    [1260000, 40000, 0],
  );
});

test('adjust: typed rows stay, the rest fills, the remainder stays as credit', () => {
  const p = planAdjust(175000, bills, new Map([['this|y', 50000]]));
  assert.deepEqual(
    p.rows.map((r) => [r.billId, r.amountPaise]),
    [
      ['this', 50000],
      ['old', 125000],
      ['new', 0],
    ],
  );
  const kept = planAdjust(175000, bills, new Map([['this|y', 50000], ['old|y', 0], ['new|y', 0]]));
  assert.equal(kept.leftPaise, 125000);
  assert.equal(adjustProblem([{ billId: 'old', billAccYear: 'y', refno: '', amountPaise: 900000 }], bills, 1000000), 'overBill');
  assert.equal(adjustProblem([{ billId: 'this', billAccYear: 'y', refno: '', amountPaise: 200000 }], bills, 175000), 'overCredit');
});

test("today's price → taxable per base unit", () => {
  assert.equal(todayRateBase('118', '1', '18', true), '100.0000');
  assert.equal(todayRateBase('1200', '12', '5', false), '100.0000');
});

test('the phone ref is the R series', () => {
  assert.equal(returnRefNo('VKSMAN-ab12cd3f9a', '2026-2027', 5), 'R3F9A/2627/00005');
});
