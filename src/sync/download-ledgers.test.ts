// Run with: npm test — a fake VK Nex answers with the Ledger Statement's response shapes.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { amountToPaise, downloadLedgers, isLedgerStepError, pickYears, sidedToPaise, type LedgerDeps } from './download-ledgers.ts';
import { ApiError, type FiscalYearOption, type LedgerQuery, type LedgerVouchersPage } from './vk-nex-api.ts';

const FY: FiscalYearOption[] = [
  { id: 'a', name: '2026-2027', beginDate: '2026-04-01', endDate: '2027-03-31', status: 'OPEN', isCurrent: true },
  { id: 'b', name: '2024-2025', beginDate: '2024-04-01', endDate: '2025-03-31', status: 'CLOSED', isCurrent: false },
  { id: 'c', name: '2025-2026', beginDate: '2025-04-01', endDate: '2026-03-31', status: 'CLOSED', isCurrent: false },
];
const TODAY = '2026-11-16';

test('this year and the one before it', () => {
  assert.deepEqual(pickYears(FY, TODAY), [
    { fyYearName: '2025-2026', fyBeginDate: '2025-04-01', fyEndDate: '2026-03-31' },
    { fyYearName: '2026-2027', fyBeginDate: '2026-04-01', fyEndDate: '2027-03-31' },
  ]);
  assert.deepEqual(pickYears([FY[0]!], TODAY).map((y) => y.fyYearName), ['2026-2027']);
  // VK Nex hasn't opened the new year yet: its current year (and the one before) still come.
  assert.deepEqual(pickYears(FY, '2027-04-05').map((y) => y.fyYearName), ['2025-2026', '2026-2027']);
  assert.deepEqual(pickYears(FY.map((y) => ({ ...y, isCurrent: false })), '2030-01-01'), []);
});

const amt = (paise: number) => ({ amount: (Math.abs(paise) / 100).toFixed(2), side: paise < 0 ? ('CR' as const) : ('DR' as const) });
const voucher = (n: number, date: string, debit: number, credit: number, balance: number) => ({
  voucherId: `v${n}`,
  accYear: '2026-2027',
  date,
  voucherTypeName: debit ? 'Sales' : 'Receipt',
  voucherNo: `N${n}`,
  rowKind: 'NORMAL',
  particulars: 'Sales A/c',
  narration: null,
  billRefs: ['bil00242 due 08-11'],
  debit: (debit / 100).toFixed(2),
  credit: (credit / 100).toFixed(2),
  balance: amt(balance),
  src: { module: 'SALES', docType: debit ? 'SALE_BILL' : 'RECEIPT', docId: null },
});

function fake(over: Partial<LedgerDeps> = {}, pageSizeSeen: number[] = []) {
  const calls: LedgerQuery[] = [];
  const deps: LedgerDeps = {
    companyId: () => 'comp-1',
    fiscalYears: async () => FY,
    ledgerPage: async (q): Promise<LedgerVouchersPage> => {
      calls.push(q);
      pageSizeSeen.push(q.pageSize);
      if (q.ledgerId === 'gone') throw new ApiError(400, 'No live ledger', [{ message: 'No live ledger', code: 'LEDGER_NOT_FOUND' }]);
      if (q.accYear === '2025-2026') return { broughtForward: amt(0), rows: [], carriedForward: amt(300000), page: { page: 1, pageSize: 1000, totalRows: 0 } };
      // 1001 vouchers this year: two pages.
      const all = Array.from({ length: 1001 }, (_, i) => voucher(i + 1, '2026-11-10', 100, 0, 300000 + (i + 1) * 100));
      const rows = all.slice((q.page - 1) * q.pageSize, q.page * q.pageSize);
      const before = q.page === 1 ? 300000 : 300000 + (q.page - 1) * q.pageSize * 100;
      return { broughtForward: amt(before), rows, carriedForward: rows.length ? rows[rows.length - 1]!.balance : amt(before), page: { page: q.page, pageSize: q.pageSize, totalRows: all.length } };
    },
    ...over,
  };
  return { deps, calls };
}

test('reads each year of each customer, every page, in exact paise', async () => {
  const { deps, calls } = fake();
  const r = await downloadLedgers(['c1'], TODAY, deps);
  assert.equal(r.read, 1);
  assert.equal(r.skipped, 0);
  assert.deepEqual(r.years, [
    { customerId: 'c1', accYear: '2025-2026', fromDate: '2025-04-01', toDate: '2026-03-31', openingPaise: 0, closingPaise: 300000 },
    { customerId: 'c1', accYear: '2026-2027', fromDate: '2026-04-01', toDate: TODAY, openingPaise: 300000, closingPaise: 300000 + 1001 * 100 },
  ]);
  assert.equal(r.rows.length, 1001);
  assert.deepEqual(r.rows.map((x) => x.seq).slice(-2), [1000, 1001]);
  assert.deepEqual(
    { ...r.rows[0], billRefs: r.rows[0]!.billRefs },
    {
      customerId: 'c1',
      voucherId: 'v1',
      accYear: '2026-2027',
      seq: 1,
      date: '2026-11-10',
      voucherTypeName: 'Sales',
      voucherNo: 'N1',
      rowKind: 'NORMAL',
      particulars: 'Sales A/c',
      narration: null,
      srcModule: 'SALES',
      srcDocType: 'SALE_BILL',
      billRefs: ['bil00242 due 08-11'],
      debitPaise: 100,
      creditPaise: 0,
      balancePaise: 300100,
    },
  );
  // This year is read up to today, last year to its end; both from the year's first day.
  assert.deepEqual(
    calls.map((c) => `${c.accYear} ${c.fromDate}..${c.toDate} p${c.page}`),
    ['2025-2026 2025-04-01..2026-03-31 p1', '2026-2027 2026-04-01..2026-11-16 p1', '2026-2027 2026-04-01..2026-11-16 p2'],
  );
  assert.equal(calls[0]!.companyId, 'comp-1');
});

test('a customer VK Nex has no ledger for is skipped; the rest still come', async () => {
  const { deps } = fake();
  const r = await downloadLedgers(['gone', 'c1'], TODAY, deps, 1);
  assert.equal(r.read, 1);
  assert.equal(r.skipped, 1);
  assert.deepEqual(r.readIds, ['c1']);
  assert.ok(r.years.every((y) => y.customerId === 'c1'));
});

test('one refused year leaves that year out; the other year still comes', async () => {
  const base = fake().deps;
  const deps: LedgerDeps = {
    ...base,
    ledgerPage: async (q) => {
      if (q.accYear === '2025-2026') throw new ApiError(400, 'No year', [{ message: 'No year', code: 'YEAR_UNKNOWN' }]);
      return base.ledgerPage(q);
    },
  };
  const r = await downloadLedgers(['c1'], TODAY, deps);
  assert.equal(r.read, 1);
  assert.deepEqual(r.years.map((y) => y.accYear), ['2026-2027']);
});

test('every customer refused: VK Nex refused the request itself, so the step stops (the old copy stays)', async () => {
  const { deps } = fake();
  await assert.rejects(downloadLedgers(['gone', 'gone'], TODAY, deps), (e: unknown) => (e as ApiError).code === 'LEDGER_NOT_FOUND');
});

test('paging follows VK Nex\'s count even if it sends smaller pages than asked', async () => {
  const all = Array.from({ length: 5 }, (_, i) => voucher(i + 1, '2026-11-10', 100, 0, (i + 1) * 100));
  const seenPages: number[] = [];
  const deps: LedgerDeps = {
    companyId: () => 'comp-1',
    fiscalYears: async () => [FY[0]!],
    ledgerPage: async (q) => {
      seenPages.push(q.page);
      const rows = all.slice((q.page - 1) * 2, q.page * 2); // VK Nex clamps to 2 a page
      return { broughtForward: amt(0), rows, carriedForward: rows.length ? rows[rows.length - 1]!.balance : amt(0), page: { page: q.page, pageSize: 2, totalRows: 5 } };
    },
  };
  const r = await downloadLedgers(['c1'], TODAY, deps);
  assert.equal(r.rows.length, 5);
  assert.deepEqual(seenPages, [1, 2, 3]);
  assert.equal(r.years[0]!.closingPaise, 500);
});

test('no right to the Ledger Statement stops the step', async () => {
  const { deps } = fake({
    ledgerPage: async () => {
      throw new ApiError(403, 'No access to the Ledger Statement', [{ field: 'menu', message: 'No access', code: 'NO_MENU_RIGHT' }]);
    },
  });
  await assert.rejects(downloadLedgers(['c1', 'c2'], TODAY, deps), (e: unknown) => (e as ApiError).status === 403);
});

test('no company in the token, or no year holding today: the step cannot run', async () => {
  await assert.rejects(downloadLedgers(['c1'], TODAY, fake({ companyId: () => null }).deps), (e: unknown) => isLedgerStepError(e) && e.code === 'NO_COMPANY');
  const noCurrent = fake({ fiscalYears: async () => FY.map((y) => ({ ...y, isCurrent: false })) }).deps;
  await assert.rejects(downloadLedgers(['c1'], '2030-01-01', noCurrent), (e: unknown) => isLedgerStepError(e) && e.code === 'NO_YEAR');
});

test('no customers: nothing to read, the years are still kept', async () => {
  const r = await downloadLedgers([], TODAY, fake().deps);
  assert.deepEqual([r.read, r.skipped, r.rows.length, r.fiscalYears.length], [0, 0, 0, 2]);
});

test("VK Nex's money text becomes exact paise; DR is +, CR is −", () => {
  assert.equal(amountToPaise('38450.00'), 3845000);
  assert.equal(amountToPaise('12.5'), 1250);
  assert.equal(amountToPaise('-0.07'), -7);
  assert.equal(amountToPaise('100'), 10000);
  assert.equal(amountToPaise('0.10') + amountToPaise('0.20'), 30);
  assert.equal(amountToPaise(''), 0);
  assert.equal(amountToPaise('12.345'), 0);
  assert.equal(amountToPaise(null), 0);
  assert.equal(sidedToPaise({ amount: '46800.00', side: 'DR' }), 4680000);
  assert.equal(sidedToPaise({ amount: '510.00', side: 'CR' }), -51000);
  assert.equal(sidedToPaise(null), 0);
});
