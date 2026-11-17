// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { accYearOf, billRefNo, seriesCode } from './bill-number.ts';
import {
  billProblem,
  billTotals,
  overStock,
  roundToRupee,
  saleLineAmounts,
  saleLineProblem,
  shareOut,
  stockLeft,
  type SaleLineInput,
  type StockLine,
} from './sale-math.ts';

const line = (qty: string, price: string, more: Partial<SaleLineInput> = {}): SaleLineInput => ({
  qty,
  price,
  discPerc: '',
  discPerUnit: '',
  loadPerUnit: '0',
  freightPerUnit: '0',
  taxPerc: '5.000',
  inclTax: false,
  ...more,
});

test('the mockup bill: 1% off before tax, 5% GST split, rounded to the rupee', () => {
  const t = billTotals([line('10', '168.00'), line('3', '1320.00'), line('10', '148.00')], { perc: '1', amount: '' });
  assert.equal(t.items, 3);
  assert.equal(t.qty, 23);
  assert.equal(t.subtotalPaise, 712000);
  assert.equal(t.billDiscPaise, 7120);
  assert.equal(t.taxablePaise, 704880);
  assert.equal(t.taxPaise, 35244);
  assert.equal(t.cgstPaise + t.sgstPaise, 35244);
  assert.equal(t.exactPaise, 740124);
  assert.equal(t.roundOffPaise, -24);
  assert.equal(t.totalPaise, 740100);
});

test('Bill item: GST on top of an exclusive price', () => {
  const a = saleLineAmounts(line('10', '168.00'));
  assert.equal(a.taxablePaise, 168000);
  assert.equal(a.taxPaise, 8400);
  assert.equal(a.netPaise, 176400);
});

test('an inclusive price keeps its total; GST is taken out of it', () => {
  const a = saleLineAmounts(line('10', '168.00', { inclTax: true }));
  assert.equal(a.preTaxPaise, 160000);
  assert.equal(a.taxPaise, 8000);
  assert.equal(a.netPaise, 168000);
  const odd = saleLineAmounts(line('1', '1.00', { inclTax: true, taxPerc: '18.000' }));
  assert.equal(odd.netPaise, 100);
});

test('no GST when the company is not GST applicable', () => {
  const t = billTotals([line('2', '50.00', { taxPerc: '0.000' })], { perc: '', amount: '' });
  assert.equal(t.taxPaise, 0);
  assert.equal(t.totalPaise, 10000);
});

test('item discounts come off before the bill discount', () => {
  const a = saleLineAmounts(line('10', '100.00', { discPerc: '10' }));
  assert.equal(a.itemDiscPaise, 10000);
  assert.equal(a.valuePaise, 90000);
  const b = saleLineAmounts(line('10', '100.00', { discPerUnit: '2.50' }));
  assert.equal(b.valuePaise, 97500);
});

test('a bill discount in rupees is shared over the lines and adds up', () => {
  const t = billTotals([line('1', '100.00'), line('1', '200.00'), line('1', '0.03')], { perc: '', amount: '10' });
  assert.equal(t.billDiscPaise, 1000);
  assert.equal(
    t.lines.reduce((s, a) => s + a.billDiscPaise, 0),
    1000,
  );
  assert.equal(t.taxablePaise, 30003 - 1000);
});

test('lines without a quantity are left out', () => {
  const t = billTotals([line('', '100.00'), line('0', '5.00'), line('1', '10.00')], { perc: '', amount: '' });
  assert.equal(t.items, 1);
  assert.equal(t.subtotalPaise, 1000);
  assert.equal(t.lines[0]!.netPaise, 0);
});

test('bill discount problems', () => {
  const lines = [line('1', '100.00')];
  assert.equal(billProblem({ perc: '101', amount: '' }, billTotals(lines, { perc: '101', amount: '' })), 'discTooBig');
  assert.equal(billProblem({ perc: '', amount: '100' }, billTotals(lines, { perc: '', amount: '100' })), 'notPositive');
  assert.equal(billProblem({ perc: '5', amount: '' }, billTotals(lines, { perc: '5', amount: '' })), null);
});

test('shareOut always adds up', () => {
  assert.deepEqual(shareOut(100, [1, 1, 1]), [34, 33, 33]);
  assert.equal(shareOut(7, [3, 3, 1]).reduce((s, x) => s + x, 0), 7);
  assert.deepEqual(shareOut(0, [5, 5]), [0, 0]);
  assert.deepEqual(shareOut(10, [0, 0]), [0, 0]);
});

test('roundToRupee rounds halves up', () => {
  assert.equal(roundToRupee(740124), 740100);
  assert.equal(roundToRupee(740150), 740200);
  assert.equal(roundToRupee(740149), 740100);
});

test('stock left after this phone’s bills, in the unit', () => {
  // 12 bags of 25 kg = 300 base; 50 base already billed = 2 bags.
  assert.equal(stockLeft('12', '25', 50), 10);
  assert.equal(stockLeft('48', '1', 0), 48);
  assert.equal(stockLeft(null, null, 0), 0);
});

test('units of one item share its stock', () => {
  const bag: StockLine = { iucId: 'bag', itemId: 'rice', qty: '2', factor: '25', stockLeft: 2.4 };
  // 60 kg in stock: 2 bags (50 kg) + 15 kg is too much, 2 bags + 10 kg is not.
  const kg: StockLine = { iucId: 'kg', itemId: 'rice', qty: '15', factor: '1', stockLeft: 60 };
  assert.deepEqual([...overStock([bag])], []);
  assert.deepEqual([...overStock([bag, { ...kg, qty: '10' }])], []);
  assert.deepEqual([...overStock([bag, kg])].sort(), ['bag', 'kg']);
  const out: StockLine = { iucId: 'oil', itemId: 'oil', qty: '1', factor: '1', stockLeft: 0 };
  assert.deepEqual([...overStock([out])], ['oil']);
  assert.deepEqual([...overStock([{ ...out, qty: '' }])], []);
});

test('Bill item: order rules first, then stock', () => {
  const l = { ...line('3', '10.00'), iucId: 'a', itemId: 'x', factor: '1', stockLeft: 2 };
  assert.equal(saleLineProblem(l, null, []), 'noStock');
  assert.equal(saleLineProblem({ ...l, qty: '2' }, null, []), null);
  assert.equal(saleLineProblem({ ...l, qty: '' }, null, []), 'noQty');
  assert.equal(saleLineProblem({ ...l, qty: '2', price: '5' }, '8', []), 'belowMin');
});

test('bill numbers: one series per phone and financial year', () => {
  assert.equal(accYearOf('2026-11-17'), '2026-2027');
  assert.equal(accYearOf('2027-03-31'), '2026-2027');
  assert.equal(accYearOf('2027-04-01'), '2027-2028');
  assert.equal(seriesCode('VKSMAN-0A1B2C3D3F9A'), '3F9A');
  assert.equal(billRefNo('3F9A', '2026-2027', 419), '3F9A/2627/00419');
});
