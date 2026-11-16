// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { countByQuickFilter, filterCustomers, visitStatus, type CustomerRow } from './customer-list.ts';

interface Shop {
  name: string;
  place?: string;
  mobile?: string;
  code?: string;
  billed?: boolean;
  orderStatus?: 'ordered' | 'no_order';
  received?: boolean;
  outstandingPaise?: number;
}
const row = (s: Shop): CustomerRow => ({
  cusId: s.name,
  cusCode: s.code ?? null,
  cusName: s.name,
  cusShort: null,
  cusCity: s.place ?? null,
  cusPhone1: s.mobile ?? null,
  cusPhone2: null,
  appBilled: s.billed ?? false,
  appOrderStatus: s.orderStatus ?? null,
  appReceived: s.received ?? false,
  billCount: 0,
  outstandingPaise: s.outstandingPaise ?? 0,
  oldestBillDate: null,
});

test('visit status: bill > order > collection > no order > not visited', () => {
  assert.equal(visitStatus(row({ name: 'a' })), 'notVisited');
  assert.equal(visitStatus(row({ name: 'a', orderStatus: 'no_order' })), 'noOrder');
  assert.equal(visitStatus(row({ name: 'a', orderStatus: 'no_order', received: true })), 'received');
  assert.equal(visitStatus(row({ name: 'a', orderStatus: 'ordered', received: true })), 'ordered');
  assert.equal(visitStatus(row({ name: 'a', billed: true, orderStatus: 'ordered', received: true })), 'billed');
});

const shops = [
  row({ name: 'Sri Murugan Stores', place: 'Namakkal', mobile: '9843012345', code: 'C001', outstandingPaise: 3845000 }),
  row({ name: 'Annai Supermarket', place: 'Mohanur Road', orderStatus: 'no_order', outstandingPaise: 1220000 }),
  row({ name: 'Lakshmi Traders', billed: true, outstandingPaise: 942000 }),
  row({ name: 'Selvam Provisions', orderStatus: 'ordered', outstandingPaise: 684000 }),
  row({ name: 'Vel Kirana', received: true, outstandingPaise: 215000 }),
  row({ name: 'Kumaran Stores' }),
];
const names = (q: string, quick: Parameters<typeof filterCustomers>[2] = 'all') =>
  filterCustomers(shops, q, quick).map((c) => c.cusName);

test('an empty search with "all" keeps every shop in order', () => {
  assert.deepEqual(names(''), shops.map((c) => c.cusName));
  assert.deepEqual(names('   '), names(''));
});

test('search matches name, area, phone or code; every word must match', () => {
  assert.deepEqual(names('STORES'), ['Sri Murugan Stores', 'Kumaran Stores']);
  assert.deepEqual(names('mohanur'), ['Annai Supermarket']);
  assert.deepEqual(names('98430'), ['Sri Murugan Stores']);
  assert.deepEqual(names('c001'), ['Sri Murugan Stores']);
  assert.deepEqual(names('murugan namakkal'), ['Sri Murugan Stores']);
  assert.deepEqual(names('kumaran namakkal'), []);
});

test('"not billed" drops billed and ordered shops, keeps "no order" ones', () => {
  assert.deepEqual(names('', 'notBilled'), ['Sri Murugan Stores', 'Annai Supermarket', 'Vel Kirana', 'Kumaran Stores']);
});

test('"not collected" keeps shops that owe money and paid nothing on this trip', () => {
  assert.deepEqual(names('', 'notCollected'), ['Sri Murugan Stores', 'Annai Supermarket', 'Lakshmi Traders', 'Selvam Provisions']);
});

test('search and quick filter combine', () => {
  assert.deepEqual(names('stores', 'notCollected'), ['Sri Murugan Stores']);
});

test('counts per quick filter agree with what each filter shows', () => {
  assert.deepEqual(countByQuickFilter(shops), { all: 6, notBilled: 4, notCollected: 4 });
  assert.deepEqual(countByQuickFilter([]), { all: 0, notBilled: 0, notCollected: 0 });
});
