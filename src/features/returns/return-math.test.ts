import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isoOrNull, returnLineAmounts, returnLineProblems, returnRefNo, returnTotals } from './return-math.ts';

const line = (qty: string, price: string, taxPerc: string | null = '5.000', inclTax = true) => ({ qty, price, taxPerc, inclTax });

test('an inclusive line is qty × price, GST taken out of it', () => {
  const a = returnLineAmounts(line('5', '102.00'));
  assert.equal(a.netPaise, 51000);
  assert.equal(a.taxablePaise + a.taxPaise, 51000);
  assert.equal(a.taxablePaise, 48571);
  assert.equal(a.cgstPaise + a.sgstPaise, a.taxPaise);
});

test('an exclusive line puts GST on top', () => {
  const a = returnLineAmounts(line('2', '100', '12.000', false));
  assert.equal(a.taxablePaise, 20000);
  assert.equal(a.taxPaise, 2400);
  assert.equal(a.netPaise, 22400);
});

test('the credit note adds the lines and rounds to the rupee', () => {
  const t = returnTotals([line('5', '102.00'), line('2', '126.00')]);
  assert.equal(t.items, 2);
  assert.equal(t.qty, 7);
  assert.equal(t.totalPaise, 76200);
  assert.equal(t.roundOffPaise, 0);

  const odd = returnTotals([line('1', '10.30', null, false)]);
  assert.equal(odd.exactPaise, 1030);
  assert.equal(odd.totalPaise, 1000);
  assert.equal(odd.roundOffPaise, -30);
});

test('lines without a quantity are not counted', () => {
  const t = returnTotals([line('', '50'), line('1', '50', '0.000')]);
  assert.equal(t.items, 1);
  assert.equal(t.totalPaise, 5000);
});

const blank = { qty: '1', price: '10', batchDate: '', expiryDate: '' };
const today = '2026-11-17';

test('quantity and price are needed; the dates are not', () => {
  assert.deepEqual(returnLineProblems(blank, today), {});
  assert.deepEqual(returnLineProblems({ ...blank, qty: '0', price: '' }, today), { qty: 'noQty', price: 'noPrice' });
});

test('typed dates must be real, the batch not made after today, expiry not before the batch', () => {
  assert.deepEqual(returnLineProblems({ ...blank, batchDate: '31-02-2026', expiryDate: 'soon' }, today), { batchDate: 'badDate', expiryDate: 'badDate' });
  assert.deepEqual(returnLineProblems({ ...blank, batchDate: '18-11-2026' }, today), { batchDate: 'future' });
  assert.deepEqual(returnLineProblems({ ...blank, batchDate: '02-09-2026', expiryDate: '01-09-2026' }, today), { expiryDate: 'beforeBatch' });
  assert.deepEqual(returnLineProblems({ ...blank, batchDate: '02-09-2026', expiryDate: '01-03-2027' }, today), {});
  // An expired product: expiry already past is fine.
  assert.deepEqual(returnLineProblems({ ...blank, expiryDate: '10-11-2026' }, today), {});
});

test('dates go to the database as YYYY-MM-DD', () => {
  assert.equal(isoOrNull('2-9-2026'), '2026-09-02');
  assert.equal(isoOrNull(' '), null);
  assert.equal(isoOrNull('99-99-2026'), null);
});

test('return numbers are the bill series with an R in front', () => {
  assert.equal(returnRefNo('VKSMAN-0A1B2C3D3f9a', '2026-2027', 1), 'R3F9A/2627/00001');
  assert.equal(returnRefNo('VKSMAN-0A1B2C3D3F9A', '2026-2027', 419), 'R3F9A/2627/00419');
});
