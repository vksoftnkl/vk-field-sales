// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { canLoadMore, PAGE_SIZE } from './paging.ts';

test('50 rows at a time', () => {
  assert.equal(PAGE_SIZE, 50);
});

test('the next 50 load once the last 50 came, while the list has more', () => {
  assert.equal(canLoadMore(50, 50, 1234), true);
  assert.equal(canLoadMore(30, 50, 1234), false, 'the first 50 are still on their way');
  assert.equal(canLoadMore(100, 100, 100), false, 'everything is shown');
  assert.equal(canLoadMore(12, 50, 12), false, 'fewer than 50 in all');
  assert.equal(canLoadMore(0, 50, 0), false);
});
