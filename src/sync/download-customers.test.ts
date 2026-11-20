// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { downloadCustomers, toLocalCustomer, toLocalFigures, type DownloadDeps } from './download-customers.ts';
import { ApiError, NetworkError } from './vk-nex-api.ts';

const NOW = '2026-11-16T09:30:00.000Z';

/** A real answer of GET /mobile/customers/get from VK Nex (2026-11-16). */
const annai = {
  cusId: '01a16777-a6fa-784e-b298-de64015a58c2',
  cusTitle: null,
  cusShort: null,
  cusCode: null,
  cusName: 'ANNAI AGENCIES',
  cusAddr1: '1/112/B1,sri musnam road',
  cusAddr2: 'Thillai nagar, Andimadam',
  cusAddr3: 'Ariyalur, Andimadam',
  cusCity: 'Andimadam',
  cusDistrict: 'Ariyalur',
  cusStateName: 'Tamil Nadu',
  cusCountry: 'India',
  cusStateCode: '33',
  cusPin: '621801',
  cusTel: '9865323203',
  cusPhone1: null,
  cusDistanceKm: 0,
  cusCreditAllowed: true,
  cusCreditBillLimit: 32,
  cusCreditAmtLimit: 232,
  cusCreditDays: 32,
  cusDebitBalance: 3,
  cusDiscPerc: 32,
  cusDebitGraceDays: 23,
  cusAllowDiscount: true,
  cusSortOrder: 0,
  cusBirthDate: null,
  cusGstNo: '33DJYPS0819D1ZX',
  cusPanNo: 'DJYPS0819D',
  cusGstType: 'REGULAR',
  cusItcollType: 'TCS',
  cusCollectionDays: [],
  cusPriceLevelId: 1,
  cusBilledDate: '2026-11-03T00:00:00.000Z',
  cusBilledCount: 1,
  cusCompanyId: '019c8ea6-19e9-78a8-b15f-749e1cde7292',
  cusBranchId: null,
  cusAreaId: '019f1710-505d-78f8-9f58-12d242859217',
  cusGroupId: '019f213b-aa13-745a-aee9-93c7445b407b',
  cusIsActive: true,
  cusIsDeleted: false,
  cusSyncDate: '2026-11-11T06:20:22.880Z',
  cusCreatedOn: '2026-10-23T06:34:17.193Z',
  cusModifiedOn: '2026-11-11T06:20:05.207Z',
  cusAreaName: 'MUSIRI',
  cusGroupName: 'VIP Parties',
  balance: null,
  balanceStatus: null,
};

test("a VK Nex customer becomes the phone's row: same names, SQLite types, no extra fields", () => {
  const r = toLocalCustomer(annai, NOW);
  assert.equal(r.cusId, annai.cusId);
  assert.equal(r.cusName, 'ANNAI AGENCIES');
  assert.equal(r.cusAreaId, annai.cusAreaId);
  assert.equal(r.cusGroupId, annai.cusGroupId);
  // Money stays exact text; @db.Date becomes YYYY-MM-DD.
  assert.equal(r.cusCreditAmtLimit, '232');
  assert.equal(r.cusDiscPerc, '32');
  assert.equal(r.cusBilledDate, '2026-11-03');
  assert.equal(r.cusBirthDate, null);
  assert.equal(r.cusCreditAllowed, true);
  assert.equal(r.cusPriceLevelId, 1);
  assert.deepEqual(r.cusCollectionDays, []);
  // The phone's own sync time, not VK Nex's.
  assert.equal(r.cusSyncDate, NOW);
  assert.equal(r.cusCreatedOn, annai.cusCreatedOn);
  // Names VK Nex adds for display are not columns.
  assert.equal('cusAreaName' in r, false);
  assert.equal('balance' in r, false);
  // Fields VK Nex leaves out get the table's defaults.
  assert.equal(r.cusEnableSms, false);
  assert.equal(r.cusForm60On, null);
});

function fakeVkNex(pages: string[][], get: (id: string) => Promise<Record<string, unknown>>) {
  const listed: number[] = [];
  const got: string[] = [];
  const deps: DownloadDeps = {
    listPage: async (page) => {
      listed.push(page);
      return { items: (pages[page - 1] ?? []).map((cusId) => ({ cusId })), hasMore: page < pages.length };
    },
    get: async (id) => {
      got.push(id);
      return get(id);
    },
  };
  return { deps, listed, got };
}

const customer = (id: string) => ({ ...annai, cusId: id, cusName: `Shop ${id}` });

test('reads every page, then every customer in full, in the list order', async () => {
  const v = fakeVkNex([['a', 'b'], ['c']], async (id) => customer(id));
  const r = await downloadCustomers(v.deps, NOW, 2);
  assert.deepEqual(v.listed, [1, 2]);
  assert.deepEqual(
    r.rows.map((x) => x.cusId),
    ['a', 'b', 'c'],
  );
  assert.deepEqual(r.listedIds, ['a', 'b', 'c']);
  assert.equal(r.skipped, 0);
});

test('a customer pushed onto the next page while paging is read once', async () => {
  const v = fakeVkNex([['a', 'b'], ['b', 'c']], async (id) => customer(id));
  const r = await downloadCustomers(v.deps, NOW);
  assert.deepEqual(r.listedIds, ['a', 'b', 'c']);
  assert.equal(v.got.filter((id) => id === 'b').length, 1);
});

test('a customer VK Nex cannot give (404, 400) is skipped but still counts as listed', async () => {
  const v = fakeVkNex([['a', 'gone', 'c']], async (id) => {
    if (id === 'gone') throw new ApiError(404, 'Customer not found');
    return customer(id);
  });
  const r = await downloadCustomers(v.deps, NOW);
  assert.deepEqual(
    r.rows.map((x) => x.cusId),
    ['a', 'c'],
  );
  assert.deepEqual(r.listedIds, ['a', 'gone', 'c']);
  assert.equal(r.skipped, 1);
});

test('losing the server stops the whole download, and the other workers stop asking', async () => {
  const ids = Array.from({ length: 20 }, (_, i) => `c${i}`);
  const v = fakeVkNex([ids], async (id) => {
    if (id === 'c1') throw new NetworkError('Network request failed');
    await new Promise((r) => setTimeout(r, 1));
    return customer(id);
  });
  await assert.rejects(downloadCustomers(v.deps, NOW, 4), (e: unknown) => e instanceof NetworkError);
  assert.ok(v.got.length < ids.length, `asked for ${v.got.length} of ${ids.length}`);
});

test('no customers on VK Nex: nothing to read', async () => {
  const v = fakeVkNex([[]], async (id) => customer(id));
  const r = await downloadCustomers(v.deps, NOW);
  // No balanceAsOn on the page: VK Nex read no figures.
  assert.deepEqual(r, { rows: [], listedIds: [], skipped: 0, figures: null });
  assert.deepEqual(v.got, []);
});

test('balance and outstanding ride on the list pages: signed paise, once per customer, as of the read', async () => {
  const pages = [
    {
      items: [
        // As /mobile/customers/list answered on :3011 (2026-11-20).
        { cusId: 'a', balance: { amount: '8450.00', side: 'DR' as const }, outstanding: '12350.00', outstandingBills: 3, oldestBillDate: '2026-09-08' },
        { cusId: 'b', balance: { amount: '2000.00', side: 'CR' as const }, outstanding: '0.00', outstandingBills: 0, oldestBillDate: null },
      ],
      hasMore: true,
      balanceAsOn: '2026-11-20',
      companyId: 'co1',
    },
    // 'a' again (pushed onto the next page while paging), and an older VK Nex row with no outstanding.
    { items: [{ cusId: 'a', balance: { amount: '1.00', side: 'DR' as const } }, { cusId: 'c', balance: { amount: '0.00', side: 'DR' as const } }], hasMore: false, balanceAsOn: '2026-11-20', companyId: 'co1' },
  ];
  const deps: DownloadDeps = { listPage: async (page) => pages[page - 1]!, get: async (id) => customer(id) };
  const r = await downloadCustomers(deps, NOW);
  assert.deepEqual(r.figures, [
    { customerId: 'a', companyId: 'co1', balancePaise: 845000, outstandingPaise: 1235000, billCount: 3, oldestBillDate: '2026-09-08', asOn: '2026-11-20', syncedOn: NOW },
    { customerId: 'b', companyId: 'co1', balancePaise: -200000, outstandingPaise: 0, billCount: 0, oldestBillDate: null, asOn: '2026-11-20', syncedOn: NOW },
    { customerId: 'c', companyId: 'co1', balancePaise: 0, outstandingPaise: null, billCount: null, oldestBillDate: null, asOn: '2026-11-20', syncedOn: NOW },
  ]);
});

test('a list row without a balance (no company on the login) has no figures', () => {
  const read = { asOn: '2026-11-20', companyId: null, syncedOn: NOW };
  assert.equal(toLocalFigures({ cusId: 'a', balance: null, outstanding: null }, read), null);
  assert.equal(toLocalFigures({ cusId: 'a' }, read), null);
});
