// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { countByQuickFilter } from '../features/customers/customer-list.ts';
import { TEST_BEATS, TEST_CUSTOMERS, TEST_CUSTOMER_TYPES } from './test-customers.ts';

test('every test shop points at a test beat and type', () => {
  const beatIds = new Set<string>(TEST_BEATS.map((b) => b.id));
  const typeIds = new Set<string>(TEST_CUSTOMER_TYPES.map((t) => t.id));
  for (const c of TEST_CUSTOMERS) {
    assert.ok(beatIds.has(c.beatId), c.name);
    assert.ok(typeIds.has(c.typeId), c.name);
  }
});

test('Namakkal East has 18 shops and the first seven match the mockup', () => {
  const east = TEST_CUSTOMERS.filter((c) => c.beatId === 'beat-nkl-east');
  assert.equal(east.length, 18);
  const summary = east.slice(0, 7).map((c) => [c.name, c.bills.length, c.bills.reduce((n, [, r]) => n + r, 0), Math.max(0, ...c.bills.map(([d]) => d))]);
  assert.deepEqual(summary, [
    ['Sri Murugan Stores', 4, 38450, 65],
    ['Annai Supermarket', 2, 12200, 21],
    ['Lakshmi Traders', 1, 9420, 3],
    ['Selvam Provisions', 3, 6840, 40],
    ['Vel Kirana', 1, 2150, 12],
    ['Kumaran Stores', 0, 0, 0],
    ['Ganesh Agencies', 2, 14780, 33],
  ]);
});

test('Namakkal East filter counts match the filter-sheet mockup (18 / 11 / 14)', () => {
  // Same mapping as seed.ts.
  const rows = TEST_CUSTOMERS.filter((c) => c.beatId === 'beat-nkl-east').map((c) => ({
    cusId: c.name,
    cusCode: null,
    cusName: c.name,
    cusShort: null,
    cusCity: c.place,
    cusPhone1: c.mobile,
    cusPhone2: null,
    appBilled: c.visit === 'B',
    appOrderStatus: c.visit === 'O' ? ('ordered' as const) : c.visit === 'N' ? ('no_order' as const) : null,
    appReceived: c.visit === 'R',
    billCount: c.bills.length,
    outstandingPaise: c.bills.reduce((n, [, r]) => n + r * 100, 0),
    oldestBillDate: null,
  }));
  assert.deepEqual(countByQuickFilter(rows), { all: 18, notBilled: 11, notCollected: 14 });
});
