// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { currentBalance, netPaise, recentBills, statement, type LedgerRow, type LedgerYear } from './ledger.ts';

const lastYear: LedgerYear = { accYear: '2025-2026', beginDate: '2025-04-01', endDate: '2026-03-31', openingPaise: 1_000_00, closingPaise: 3_000_00 };
const thisYear: LedgerYear = { accYear: '2026-2027', beginDate: '2026-04-01', endDate: '2027-03-31', openingPaise: 3_000_00, closingPaise: 3_845_000 };

let seq = 0;
const row = (accYear: string, date: string, debit: number, credit: number, balance: number, extra: Partial<LedgerRow> = {}): LedgerRow => ({
  voucherId: `v${++seq}`,
  accYear,
  seq,
  date,
  voucherTypeName: debit ? 'Sales' : 'Receipt',
  voucherNo: `N${seq}`,
  rowKind: 'NORMAL',
  particulars: null,
  narration: null,
  srcModule: debit ? 'SALES' : 'ACCOUNTS',
  srcDocType: debit ? 'SALE_BILL' : 'RECEIPT',
  billRefs: [],
  debitPaise: debit,
  creditPaise: credit,
  balancePaise: balance,
  ...extra,
});

const rows = [
  row('2025-2026', '2026-03-20', 2_000_00, 0, 3_000_00),
  row('2026-2027', '2026-11-10', 4_680_000, 0, 4_980_000),
  row('2026-2027', '2026-11-15', 0, 1_635_000, 3_345_000),
  row('2026-2027', '2026-11-16', 851_000, 0, 4_196_000),
  row('2026-2027', '2026-11-16', 0, 351_000, 3_845_000, { voucherTypeName: 'Sales return', srcModule: 'SALES', srcDocType: 'SALE_RETURN' }),
];

test('a week: opening before it, its vouchers, closing at its end', () => {
  const s = statement([thisYear, lastYear], rows, { from: '2026-11-15', to: '2026-11-21' });
  assert.ok(s.ok);
  assert.equal(s.openingPaise, 4_980_000);
  assert.deepEqual(s.rows.map((r) => r.date), ['2026-11-15', '2026-11-16', '2026-11-16']);
  assert.equal(s.closingPaise, 3_845_000);
});

test('a range with no vouchers keeps the balance it opened with', () => {
  const s = statement([thisYear], rows, { from: '2026-05-01', to: '2026-05-31' });
  assert.ok(s.ok);
  assert.equal(s.openingPaise, 3_000_00);
  assert.equal(s.rows.length, 0);
  assert.equal(s.closingPaise, 3_000_00);
});

test("the year's first day opens with VK Nex's opening balance", () => {
  const s = statement([thisYear, lastYear], rows, { from: '2026-04-01', to: '2027-03-31' });
  assert.ok(s.ok);
  assert.equal(s.openingPaise, 3_000_00);
  assert.equal(s.rows.length, 4);
});

test('a range across 31 March reads each balance in its own year', () => {
  const s = statement([thisYear, lastYear], rows, { from: '2026-03-12', to: '2026-04-10' });
  assert.ok(s.ok);
  assert.equal(s.openingPaise, 1_000_00);
  assert.deepEqual(s.rows.map((r) => r.date), ['2026-03-20']);
  assert.equal(s.closingPaise, 3_000_00);
});

test('dates the phone has no ledger for are refused; dates past the last year are cut', () => {
  assert.deepEqual(statement([], rows, { from: '2026-11-15', to: '2026-11-21' }), { ok: false, reason: 'noLedger', years: [] });
  const old = statement([thisYear, lastYear], rows, { from: '2024-04-01', to: '2025-03-31' });
  assert.deepEqual(old, { ok: false, reason: 'notOnPhone', years: ['2025-2026', '2026-2027'] });
  const past = statement([thisYear], rows, { from: '2027-03-28', to: '2027-04-03' });
  assert.ok(past.ok);
  assert.equal(past.to, '2027-03-31');
  assert.equal(past.closingPaise, 3_845_000);
});

test('balance now, recent sales bills, net movement', () => {
  assert.equal(currentBalance([lastYear, thisYear]), 3_845_000);
  assert.equal(currentBalance([]), null);
  assert.deepEqual(recentBills(rows, [thisYear, lastYear], 2).map((r) => r.date), ['2026-11-16', '2026-11-10']);
  assert.equal(netPaise(rows[2]!), -1_635_000);
});

test('a range running into a year the phone does not have is refused, not a crash', () => {
  const older: LedgerYear = { accYear: '2024-2025', beginDate: '2024-04-01', endDate: '2025-03-31', openingPaise: 0, closingPaise: 0 };
  // VK Nex had no 2025-2026, so Sync brought 2024-2025 and 2026-2027.
  const s = statement([older, thisYear], rows, { from: '2024-12-01', to: '2025-06-01' });
  assert.deepEqual(s, { ok: false, reason: 'notOnPhone', years: ['2024-2025', '2026-2027'] });
});
