// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { normalizeSelection, parseIdList, serializeIdList } from './selection.ts';

const all = ['east', 'west', 'rasi'];

test('nothing or everything ticked means "all" (empty list)', () => {
  assert.deepEqual(normalizeSelection([], all), []);
  assert.deepEqual(normalizeSelection(['rasi', 'east', 'west'], all), []);
});

test('a partial choice keeps the option order and drops unknown ids', () => {
  assert.deepEqual(normalizeSelection(['rasi', 'east'], all), ['east', 'rasi']);
  assert.deepEqual(normalizeSelection(['gone', 'west'], all), ['west']);
  assert.deepEqual(normalizeSelection(['gone'], all), []);
});

test('id lists round-trip through device_meta', () => {
  assert.deepEqual(parseIdList(null), []);
  assert.deepEqual(parseIdList(''), []);
  assert.deepEqual(parseIdList(serializeIdList(['east', 'rasi'])), ['east', 'rasi']);
});
