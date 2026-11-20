// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { itemsNow, plannedRows, typedEntries, type OpenItemRow } from './receipt-plan.ts';
import { settle } from './settle.ts';

const row = (billId: string, kind: string, pendingPaise: number, more: Partial<OpenItemRow> = {}): OpenItemRow => ({
  billId,
  billAccYear: '2026-2027',
  companyId: 'co1',
  kind,
  docRefno: billId,
  docDate: '2026-10-02',
  dueDate: null,
  billAmountPaise: pendingPaise,
  pendingPaise,
  paidPaise: 0,
  pdcHeldPaise: 0,
  ppdSchedule: null,
  ...more,
});

const rows = [
  row('SB1', 'BILL', 845_000),
  row('SR31', 'SALES_RETURN', 125_000),
  row('SB2', 'BILL', 1_260_000, { ppdSchedule: '[{"tillDate":"2026-11-27","perc":1}]' }),
  row('SBX', 'BILL', 50_000, { companyId: 'co2' }),
];

test('credits first, then bills; another company is left out; PPD parsed', () => {
  const items = itemsNow(rows, [], [], 'co1');
  assert.deepEqual(
    items.map((i) => [i.key, i.kind, i.pendingPaise]),
    [
      ['SR31|2026-2027', 'SALES_RETURN', 125_000],
      ['SB1|2026-2027', 'BILL', 845_000],
      ['SB2|2026-2027', 'BILL', 1_260_000],
    ],
  );
  assert.deepEqual(items[2]!.ppd, [{ tillDate: '2026-11-27', perc: 1 }]);
});

test("this phone's unsent receipts come off: plans exactly, older ones oldest first", () => {
  const items = itemsNow(
    rows,
    [
      { companyId: 'co1', kind: 'BILL', billId: 'SB1', billAccYear: '2026-2027', amount: '6700.00', credit: '1250.00', discount: '0', roundoff: '0' },
      { companyId: 'co1', kind: 'CREDIT', billId: 'SR31', billAccYear: '2026-2027', amount: '1250.00', credit: '0', discount: '0', roundoff: '0' },
    ],
    [{ companyId: 'co1', amount: '500.00' }],
    'co1',
  );
  // The plan leaves ₹500 on SB1 (8,450 − 1,250 − 6,700) and spends the credit; the older ₹500
  // receipt then clears SB1 (oldest first), so only SB2 is left, untouched.
  assert.deepEqual(
    items.map((i) => [i.key, i.pendingPaise]),
    [['SB2|2026-2027', 1_260_000]],
  );
});

test('a settlement becomes the rows Save keeps', () => {
  const items = itemsNow(rows, [], [], 'co1');
  const s = settle({ amountPaise: 1_967_400, date: '2026-11-19', items, typedBills: typedEntries({}) });
  assert.deepEqual(plannedRows(s, items), [
    { kind: 'CREDIT', billId: 'SR31', billAccYear: '2026-2027', docRefno: 'SR31', amount: '1250.00', credit: '0.00', discount: '0.00', roundoff: '0.00' },
    { kind: 'BILL', billId: 'SB1', billAccYear: '2026-2027', docRefno: 'SB1', amount: '7200.00', credit: '1250.00', discount: '0.00', roundoff: '0.00' },
    { kind: 'BILL', billId: 'SB2', billAccYear: '2026-2027', docRefno: 'SB2', amount: '12474.00', credit: '0.00', discount: '126.00', roundoff: '0.00' },
  ]);
});

test('typed text becomes paise; junk is 0', () => {
  assert.deepEqual(typedEntries({ k: { receive: '1,200.50', discount: '', roundoff: 'x' } }), { k: { receivePaise: 120_050, discountPaise: 0, roundoffPaise: 0 } });
});
