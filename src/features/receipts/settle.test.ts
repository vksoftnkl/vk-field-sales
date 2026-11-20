// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { billEntryProblem, cashToClearUpTo, itemKind, parsePpd, ppdPaise, settle, type OpenItem } from './settle.ts';

// The canvas page 5b sample: Sri Murugan Stores on 19 Nov 2026.
const items: OpenItem[] = [
  { key: 'SR31', kind: 'SALES_RETURN', pendingPaise: 125_000, ppd: [] },
  { key: 'ADV', kind: 'ADVANCE', pendingPaise: 50_000, ppd: [] },
  { key: 'B1842', kind: 'BILL', pendingPaise: 845_000, ppd: [] },
  { key: 'B2107', kind: 'BILL', pendingPaise: 1_260_000, ppd: [{ tillDate: '2026-11-27', perc: 1 }] },
  {
    key: 'B2391',
    kind: 'BILL',
    pendingPaise: 988_000,
    ppd: [
      { tillDate: '2026-12-12', perc: 1 },
      { tillDate: '2026-11-27', perc: 2 },
    ],
  },
];
const date = '2026-11-19';
const bill = (s: ReturnType<typeof settle>, key: string) => s.bills.find((b) => b.key === key)!;

test('credits first, then cash oldest first; a cleared bill takes its PPD discount (the mockup figures)', () => {
  const s = settle({ amountPaise: 1_917_400, date, items });
  assert.equal(s.problem, null);
  assert.deepEqual(
    s.credits.map((c) => [c.key, c.usedPaise]),
    [
      ['SR31', 125_000],
      ['ADV', 50_000],
    ],
  );
  assert.deepEqual([bill(s, 'B1842').creditPaise, bill(s, 'B1842').receivePaise, bill(s, 'B1842').leftPaise], [175_000, 670_000, 0]);
  assert.deepEqual([bill(s, 'B2107').receivePaise, bill(s, 'B2107').discountPaise, bill(s, 'B2107').leftPaise], [1_247_400, 12_600, 0]);
  assert.deepEqual([bill(s, 'B2391').receivePaise, bill(s, 'B2391').leftPaise, bill(s, 'B2391').ppdPaise], [0, 988_000, 19_760]);
  assert.equal(s.settledPaise, 2_105_000);
  assert.equal(s.onAccountPaise, 0);
  // The desktop's balance rule: received + credits + discount + round-off = settled + on account.
  assert.equal(s.receivedPaise + s.creditsPaise + s.discountPaise + s.roundoffPaise, s.settledPaise + s.onAccountPaise);
});

test('the quick amounts: overdue bill, two bills, everything (PPD taken)', () => {
  assert.equal(cashToClearUpTo({ date, items }, 'B1842'), 670_000);
  assert.equal(cashToClearUpTo({ date, items }, 'B2107'), 1_917_400);
  assert.equal(cashToClearUpTo({ date, items }, 'B2391'), 2_885_640);
  assert.equal(cashToClearUpTo({ date, items }, 'nope'), 0);
});

test('a part-paid bill gets no discount; money left over stays on account', () => {
  const part = settle({ amountPaise: 1_000_000, date, items });
  assert.deepEqual([bill(part, 'B2107').receivePaise, bill(part, 'B2107').discountPaise, bill(part, 'B2107').leftPaise], [330_000, 0, 930_000]);
  const more = settle({ amountPaise: 3_000_000, date, items });
  assert.equal(more.onAccountPaise, 114_360);
  assert.ok(more.bills.every((b) => b.leftPaise === 0));
});

test('bills typed by hand keep their figures and take their cash first', () => {
  const s = settle({ amountPaise: 1_000_000, date, items, typedBills: { B2391: { receivePaise: 500_000, discountPaise: 0, roundoffPaise: 0 } } });
  assert.equal(s.problem, null);
  assert.deepEqual([bill(s, 'B1842').receivePaise, bill(s, 'B1842').leftPaise], [500_000, 170_000]);
  assert.equal(bill(s, 'B2107').receivePaise, 0);
  assert.deepEqual([bill(s, 'B2391').receivePaise, bill(s, 'B2391').typed], [500_000, true]);
  assert.equal(s.onAccountPaise, 0);
});

test('a credit lowered by hand spends only that much', () => {
  const s = settle({ amountPaise: 1_000_000, date, items, typedCredits: { SR31: 100_000, ADV: 999_999 } });
  assert.deepEqual(
    s.credits.map((c) => c.usedPaise),
    [100_000, 50_000],
  );
  assert.equal(bill(s, 'B1842').receivePaise, 695_000);
});

test('problems: typed more than received, above pending, nothing at all', () => {
  assert.equal(settle({ amountPaise: 800_000, date, items, typedBills: { B2391: { receivePaise: 900_000, discountPaise: 0, roundoffPaise: 0 } } }).problem, 'typedOverAmount');
  assert.equal(settle({ amountPaise: 2_000_000, date, items, typedBills: { B2107: { receivePaise: 1_260_000, discountPaise: 1, roundoffPaise: 0 } } }).problem, 'overPending');
  assert.equal(settle({ amountPaise: 0, date, items: items.filter((i) => i.kind === 'BILL') }).problem, 'nothing');
  // Credits alone are not a receipt on the phone: VK Nex refuses one with no payment line.
  assert.equal(settle({ amountPaise: 0, date, items }).problem, 'nothing');
});

test('the receipt date picks the PPD slab; it rounds down to the paisa', () => {
  const b3 = items[4]!;
  assert.equal(ppdPaise(b3, '2026-11-19'), 19_760);
  assert.equal(ppdPaise(b3, '2026-11-28'), 9_880);
  assert.equal(ppdPaise(b3, '2026-12-13'), 0);
  assert.equal(ppdPaise({ pendingPaise: 33_333, ppd: [{ tillDate: '2026-12-01', perc: 1.5 }] }, date), 499);
});

test('Bill adjustment checks: PPD cap, round-off up to 99 paise, never above pending', () => {
  const b2 = items[3]!;
  assert.equal(billEntryProblem({ receivePaise: 1_247_400, discountPaise: 12_600, roundoffPaise: 0 }, b2, date), null);
  assert.equal(billEntryProblem({ receivePaise: 1_200_000, discountPaise: 12_601, roundoffPaise: 0 }, b2, date), 'discountAbovePpd');
  assert.equal(billEntryProblem({ receivePaise: 1_259_900, discountPaise: 0, roundoffPaise: 100 }, b2, date), 'roundoffTooBig');
  assert.equal(billEntryProblem({ receivePaise: 1_259_950, discountPaise: 0, roundoffPaise: 99 }, b2, date), 'overPending');
  assert.equal(billEntryProblem({ receivePaise: -1, discountPaise: 0, roundoffPaise: 0 }, b2, date), 'negative');
});

test('kinds and PPD JSON from VK Nex', () => {
  assert.equal(itemKind('SALES_RETURN'), 'SALES_RETURN');
  assert.equal(itemKind(null), 'BILL');
  assert.equal(itemKind('PURCHASE_RETURN'), 'BILL');
  assert.deepEqual(parsePpd('[{"tillDate":"2026-11-27T00:00:00Z","perc":"2"},{"tillDate":"x","perc":1}]'), [{ tillDate: '2026-11-27', perc: 2 }]);
  assert.deepEqual(parsePpd('not json'), []);
  assert.deepEqual(parsePpd(null), []);
});

test('a typed discount above today\'s slab, or round-off above 0.99, is cut back', () => {
  const items: OpenItem[] = [{ key: 'B1', kind: 'BILL', pendingPaise: 1_000_000, ppd: [{ tillDate: '2026-11-20', perc: 1 }] }];
  const typedBills = { B1: { receivePaise: 990_000, discountPaise: 10_000, roundoffPaise: 150 } };
  const before = settle({ amountPaise: 990_000, date: '2026-11-19', items, typedBills });
  assert.deepEqual([before.bills[0]!.discountPaise, before.bills[0]!.roundoffPaise], [10_000, 99]);
  const after = settle({ amountPaise: 990_000, date: '2026-11-22', items, typedBills });
  assert.deepEqual([after.bills[0]!.discountPaise, after.bills[0]!.leftPaise], [0, 9_901]);
});

test('credits alone are not a receipt: money is needed', () => {
  const items: OpenItem[] = [
    { key: 'A1', kind: 'ADVANCE', pendingPaise: 50_000, ppd: [] },
    { key: 'B1', kind: 'BILL', pendingPaise: 100_000, ppd: [] },
  ];
  assert.equal(settle({ amountPaise: 0, date: '2026-11-19', items }).problem, 'nothing');
  assert.equal(settle({ amountPaise: 100, date: '2026-11-19', items }).problem, null);
});

test('the cash to clear up to a bill keeps what later bills typed by hand take', () => {
  const items: OpenItem[] = [
    { key: 'B1', kind: 'BILL', pendingPaise: 100_000, ppd: [] },
    { key: 'B2', kind: 'BILL', pendingPaise: 200_000, ppd: [] },
  ];
  const typedBills = { B2: { receivePaise: 50_000, discountPaise: 0, roundoffPaise: 0 } };
  const cash = cashToClearUpTo({ date: '2026-11-19', items, typedBills }, 'B1');
  assert.equal(cash, 150_000);
  assert.equal(settle({ amountPaise: cash, date: '2026-11-19', items, typedBills }).bills[0]!.leftPaise, 0);
});
