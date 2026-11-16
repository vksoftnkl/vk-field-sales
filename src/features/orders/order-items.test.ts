// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { filterOrderItems, itemName } from './order-items.ts';

const rows = [
  { itemCode: 'R25', itemNameEn: 'Ponni Raw Rice 25 kg', itemNameTa: 'பொன்னி அரிசி', itemGroupId: 'g-rice', itemBrandId: 'b-1' },
  { itemCode: 'OIL1', itemNameEn: 'Sunflower Oil 1 L pouch', itemNameTa: null, itemGroupId: 'g-oil', itemBrandId: null },
  { itemCode: 'DAL1', itemNameEn: 'Toor Dal 1 kg', itemNameTa: 'துவரம் பருப்பு', itemGroupId: 'g-dal', itemBrandId: 'b-2' },
];

test('every word must match the code, English name or Tamil name', () => {
  assert.deepEqual(filterOrderItems(rows, 'rice 25', [], []).map((r) => r.itemCode), ['R25']);
  assert.deepEqual(filterOrderItems(rows, 'oil1', [], []).map((r) => r.itemCode), ['OIL1']);
  assert.deepEqual(filterOrderItems(rows, 'அரிசி', [], []).map((r) => r.itemCode), ['R25']);
  assert.deepEqual(filterOrderItems(rows, '1 kg', [], []).map((r) => r.itemCode), ['DAL1']);
  assert.equal(filterOrderItems(rows, '  ', [], []).length, 3);
});

test('groups and brands narrow the list; [] means all', () => {
  assert.deepEqual(filterOrderItems(rows, '', ['g-oil', 'g-dal'], []).map((r) => r.itemCode), ['OIL1', 'DAL1']);
  assert.deepEqual(filterOrderItems(rows, '', [], ['b-2']).map((r) => r.itemCode), ['DAL1']);
});

test('the Tamil name is shown only in Tamil, and only when there is one', () => {
  assert.equal(itemName(rows[0]!, 'ta'), 'பொன்னி அரிசி');
  assert.equal(itemName(rows[0]!, 'en'), 'Ponni Raw Rice 25 kg');
  assert.equal(itemName(rows[1]!, 'ta'), 'Sunflower Oil 1 L pouch');
});
