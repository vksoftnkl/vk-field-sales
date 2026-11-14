// Run with: npm test   (uses Node's built-in test runner, no Jest needed)
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { computeBill, computeLine, isInterState } from './index.ts';

test('exclusive 18% intra-state splits CGST/SGST equally', () => {
  const r = computeLine({ qty: 2, ratePaise: 10_000, gstRateBp: 1800 }, false);
  assert.equal(r.taxablePaise, 20_000);
  assert.equal(r.cgstPaise, 1_800);
  assert.equal(r.sgstPaise, 1_800);
  assert.equal(r.igstPaise, 0);
  assert.equal(r.totalPaise, 23_600);
});

test('exclusive 12% inter-state goes to IGST', () => {
  const r = computeLine({ qty: 1, ratePaise: 10_000, gstRateBp: 1200 }, true);
  assert.equal(r.igstPaise, 1_200);
  assert.equal(r.cgstPaise + r.sgstPaise, 0);
});

test('line discount applies before tax', () => {
  const r = computeLine({ qty: 10, ratePaise: 5_000, discBp: 1000, gstRateBp: 500 }, false);
  assert.equal(r.grossPaise, 50_000);
  assert.equal(r.discPaise, 5_000);
  assert.equal(r.taxablePaise, 45_000);
  assert.equal(r.cgstPaise + r.sgstPaise, 2_250);
});

test('inclusive rate: total equals net exactly', () => {
  const r = computeLine({ qty: 3, ratePaise: 11_800, gstRateBp: 1800, taxInclusive: true }, false);
  assert.equal(r.totalPaise, 35_400);
  assert.equal(r.taxablePaise, 30_000);
  assert.equal(r.cgstPaise + r.sgstPaise, 5_400);
});

test('cess is added on taxable value', () => {
  const r = computeLine({ qty: 1, ratePaise: 10_000, gstRateBp: 2800, cessRateBp: 1200 }, false);
  assert.equal(r.cessPaise, 1_200);
  assert.equal(r.totalPaise, 10_000 + 2_800 + 1_200);
});

test('fractional qty (kg) rounds to paise', () => {
  const r = computeLine({ qty: 1.255, ratePaise: 4_999, gstRateBp: 500 }, false);
  assert.equal(r.taxablePaise, 6_274);
});

test('bill rounds to nearest rupee with signed round-off', () => {
  const b = computeBill(
    [
      { qty: 1, ratePaise: 10_050, gstRateBp: 0 },
      { qty: 1, ratePaise: 1_000, gstRateBp: 500 },
    ],
    false,
  );
  assert.equal(b.taxablePaise, 11_050);
  assert.equal(b.taxPaise, 50);
  assert.equal(b.totalPaise, 11_100);
  assert.equal(b.roundOffPaise, 0);

  const b2 = computeBill([{ qty: 1, ratePaise: 10_070, gstRateBp: 0 }], false);
  assert.equal(b2.totalPaise, 10_100);
  assert.equal(b2.roundOffPaise, 30);
});

test('rejects zero qty', () => {
  assert.throws(() => computeLine({ qty: 0, ratePaise: 100, gstRateBp: 0 }, false));
});

test('isInterState compares GST state codes', () => {
  assert.equal(isInterState('33', '33'), false);
  assert.equal(isInterState('33', '29'), true);
  assert.equal(isInterState('33', null), false);
});
