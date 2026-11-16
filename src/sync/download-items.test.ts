// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { makeDeviceUid, isDeviceUid } from './device-uid.ts';
import { downloadItems, toLocalItem, toLocalUnits } from './download-items.ts';
import type { ItemListPage, MobileItem, MobileItemUnit } from './vk-nex-api.ts';

const unit = (iucId: string, over: Partial<MobileItemUnit> = {}): MobileItemUnit => ({
  iucId,
  unitId: `unit-${iucId}`,
  unitName: 'BAG',
  factor: 25,
  isDefaultUnit: true,
  isBaseUnit: false,
  weight: 25,
  priced: true,
  priceA: '1680.00',
  priceB: '1650.00',
  priceC: null,
  priceD: null,
  mrp: '1800.00',
  minPrice: '1600.00',
  loadingCharge: '5.00',
  freightCharge: '10.00',
  availableQty: 12.48,
  ...over,
});

const item = (itemId: string, units: MobileItemUnit[] = [unit(`${itemId}-bag`)]): MobileItem => ({
  itemId,
  itemCode: `C-${itemId}`,
  itemNameEn: `Item ${itemId}`,
  itemNameTa: null,
  itemGroupId: 'grp-1',
  itemBrandId: null,
  allowLoading: true,
  allowFreight: false,
  allowPromo: false,
  inclTax: true,
  hsnCode: '1006',
  taxId: 'tax-5',
  taxPerc: '5.000',
  units,
});

test("VK Nex's item becomes the phone's item_master row", () => {
  const row = toLocalItem(item('rice'));
  assert.equal(row.itemNameEn, 'Item rice');
  assert.equal(row.itemAllowLoading, true);
  assert.equal(row.itemInclTax, true);
  assert.equal(row.itemHsnCode, '1006');
  assert.equal(row.appTaxPerc, '5.000');
  assert.equal(row.appTaxId, 'tax-5');
});

test("units keep the company's prices and stock as exact text; an unpriced unit keeps null prices", () => {
  const [bag, kg] = toLocalUnits('comp-1', item('rice', [unit('bag'), unit('kg', { priced: false, priceA: null, priceB: null, mrp: null, minPrice: null, unitName: null })]));
  assert.equal(bag!.appCompanyId, 'comp-1');
  assert.equal(bag!.iucItemId, 'rice');
  assert.equal(bag!.iucToBaseFactor, '25');
  assert.equal(bag!.ipmSalesPriceA, '1680.00');
  assert.equal(bag!.ipmMaxPrice, '1800.00');
  assert.equal(bag!.isbAvailableQty, '12.48');
  assert.equal(bag!.appPriced, true);
  assert.equal(kg!.appPriced, false);
  assert.equal(kg!.ipmSalesPriceA, null);
  assert.equal(kg!.appUnitName, '');
});

test('every page of every company is read; a shared item is kept once, its units per company', async () => {
  const calls: [string, number][] = [];
  const pages: Record<string, ItemListPage[]> = {
    a: [
      { items: [item('rice')], total: 2, hasMore: true, branchId: null },
      { items: [item('dal')], total: 2, hasMore: false, branchId: null },
    ],
    b: [{ items: [item('rice')], total: 1, hasMore: false, branchId: 'br-1' }],
  };
  const d = await downloadItems(['a', 'b'], {
    listPage: async (companyId, page) => {
      calls.push([companyId, page]);
      return pages[companyId]![page - 1]!;
    },
  });
  assert.deepEqual(calls, [
    ['a', 1],
    ['a', 2],
    ['b', 1],
  ]);
  assert.deepEqual(d.items.map((i) => i.itemId).sort(), ['dal', 'rice']);
  assert.deepEqual(
    d.units.map((u) => `${u.appCompanyId}:${u.iucId}`),
    ['a:rice-bag', 'a:dal-bag', 'b:rice-bag'],
  );
  assert.deepEqual(d.companyIds, ['a', 'b']);
});

test('a failure while reading is thrown, so the phone keeps its old items', async () => {
  await assert.rejects(
    downloadItems(['a'], {
      listPage: async () => {
        throw new Error('boom');
      },
    }),
    /boom/,
  );
});

test("the phone's device uid is short, upper-case and stable in shape", () => {
  let n = 0;
  const uid = makeDeviceUid(() => (n++ % 16) / 16);
  assert.equal(uid, 'VKSMAN-0123456789AB');
  assert.ok(isDeviceUid(makeDeviceUid()));
  assert.equal(isDeviceUid('vksman-0123'), false);
});
