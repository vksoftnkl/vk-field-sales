import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_PRIORITY, priorityNeedsRemark, SO_PRIORITIES, toPriority } from './so-priority.ts';

test('the four VK Nex priorities, NORMAL by default', () => {
  assert.deepEqual([...SO_PRIORITIES], ['LOW', 'NORMAL', 'HIGH', 'URGENT']);
  assert.equal(DEFAULT_PRIORITY, 'NORMAL');
});

test('saved priorities read back as themselves', () => {
  for (const p of SO_PRIORITIES) assert.equal(toPriority(p), p);
  assert.equal(toPriority(' high '), 'HIGH');
});

test('orders saved before the dropdown: the urgent flag is URGENT, no flag is NORMAL', () => {
  assert.equal(toPriority('URGENT'), 'URGENT');
  assert.equal(toPriority(null), 'NORMAL');
  assert.equal(toPriority(undefined), 'NORMAL');
  assert.equal(toPriority(''), 'NORMAL');
  assert.equal(toPriority('SOMETHING'), 'NORMAL');
});

test('only URGENT needs a remark', () => {
  assert.deepEqual(
    SO_PRIORITIES.filter(priorityNeedsRemark),
    ['URGENT'],
  );
});
