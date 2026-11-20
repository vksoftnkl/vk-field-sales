// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { soLineAmounts, soTotals, type SoLineInput, type SoSchemeOutcome } from './so-math.ts';

const line = (over: Partial<SoLineInput> = {}): SoLineInput => ({
  qty: '10',
  price: '100.00',
  discMode: 'perc',
  disc: '',
  taxPerc: '5.000',
  inclTax: false,
  loadPerUnit: '0',
  freightPerUnit: '0',
  ...over,
});
const sch = (over: Partial<SoSchemeOutcome> = {}): SoSchemeOutcome => ({ schPerc: 0, schPerQty: 0, schAmt: 0, billSchPerc: 0, ...over });

test('no outcome: the line is worked exactly as before (and the scheme money is 0)', () => {
  const plain = soLineAmounts(line({ disc: '2' }));
  assert.equal(plain.schemePaise, 0);
  assert.equal(plain.billSchemePaise, 0);
  const { schemePaise: _a, billSchemePaise: _b, ...rest } = plain;
  assert.deepEqual(rest, { ...rest, grossPaise: 100000, discPaise: 2000, valuePaise: 98000, taxablePaise: 98000, taxPaise: 4900, lineTotalPaise: 102900 });
  for (const s of [undefined, null, sch()]) {
    assert.deepEqual(soLineAmounts(line({ disc: '2', scheme: s })), plain, `scheme = ${JSON.stringify(s)}`);
  }
});

test('no outcome on an inclusive line keeps what was typed, to the paise', () => {
  const l = line({ price: '105.00', inclTax: true, qty: '7' });
  const base = soLineAmounts(l);
  assert.equal(base.lineTotalPaise, base.valuePaise);
  assert.deepEqual(soLineAmounts({ ...l, scheme: sch() }), base);
});

test('a scheme % comes off the ex-tax value, then GST on the remainder (12 × ₹38, 3%)', () => {
  const a = soLineAmounts(line({ qty: '12', price: '38.00', scheme: sch({ schPerc: 3 }) }));
  assert.equal(a.grossPaise, 45600);
  assert.equal(a.schemePaise, 1368);
  assert.equal(a.taxablePaise, 44232);
  assert.equal(a.taxPaise, 2212);
  assert.equal(a.cgstPaise + a.sgstPaise, 2212);
  assert.equal(a.lineTotalPaise, 46444);
  assert.equal(a.discPaise, 0, 'the salesman\'s own discount stays its own figure');
});

test('the scheme comes off after the salesman\'s own discount', () => {
  const a = soLineAmounts(line({ disc: '10', scheme: sch({ schPerc: 5 }) }));
  assert.equal(a.discPaise, 10000);
  assert.equal(a.schemePaise, 4500, '5% of 900, not of 1000');
  assert.equal(a.taxablePaise, 85500);
  assert.equal(a.taxPaise, 4275);
});

test('the scheme as ₹ per unit, then as a ₹ amount; the % wins over both', () => {
  assert.equal(soLineAmounts(line({ scheme: sch({ schPerQty: 2.5 }) })).schemePaise, 2500);
  assert.equal(soLineAmounts(line({ scheme: sch({ schAmt: 33.33 }) })).schemePaise, 3333);
  assert.equal(soLineAmounts(line({ scheme: sch({ schPerc: 1, schPerQty: 2.5, schAmt: 33.33 }) })).schemePaise, 1000);
  assert.equal(soLineAmounts(line({ scheme: sch({ schPerQty: 2.5, schAmt: 33.33 }) })).schemePaise, 2500);
});

test('the bill-scheme % comes off what the scheme left', () => {
  const a = soLineAmounts(line({ qty: '10', price: '100.00', scheme: sch({ schAmt: 100, billSchPerc: 3 }) }));
  assert.equal(a.schemePaise, 10000);
  assert.equal(a.billSchemePaise, 2700, '3% of 900');
  assert.equal(a.taxablePaise, 87300);
  assert.equal(a.taxPaise, 4365);
  assert.equal(soLineAmounts(line({ scheme: sch({ billSchPerc: 2 }) })).billSchemePaise, 2000, 'a bill scheme alone');
});

test('an inclusive item: the scheme is worked ex-tax, and GST goes on the remainder', () => {
  // ₹105 with 5% inside: ex-tax ₹100 × 10 = ₹1,000; 10% scheme = ₹100; taxable ₹900; GST ₹45.
  const a = soLineAmounts(line({ price: '105.00', inclTax: true, scheme: sch({ schPerc: 10 }) }));
  assert.equal(a.valuePaise, 105000);
  assert.equal(a.schemePaise, 10000);
  assert.equal(a.taxablePaise, 90000);
  assert.equal(a.taxPaise, 4500);
  assert.equal(a.lineTotalPaise, 94500);
});

test('freight and cooly still go on top, untaxed, with a scheme', () => {
  const a = soLineAmounts(line({ freightPerUnit: '1.00', loadPerUnit: '0.50', scheme: sch({ schPerc: 10 }) }));
  assert.equal(a.netPaise, a.lineTotalPaise + 1000 + 500);
});

test('soTotals adds the scheme discount and the order-offer discount, in paise', () => {
  const t = soTotals([line({ scheme: sch({ schPerc: 10 }) }), line({ scheme: sch({ schAmt: 50, billSchPerc: 2 }) }), line()]);
  assert.equal(t.schemeDiscPaise, 10000 + 5000);
  assert.equal(t.billSchemeDiscPaise, Math.round((95000 * 2) / 100));
  assert.equal(t.discPaise, 0);
  assert.equal(t.taxablePaise, 90000 + (95000 - 1900) + 100000);
  const none = soTotals([line()]);
  assert.equal(none.schemeDiscPaise, 0);
  assert.equal(none.billSchemeDiscPaise, 0);
});
