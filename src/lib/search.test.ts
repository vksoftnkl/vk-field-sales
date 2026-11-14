// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { filterOptions } from './search.ts';

const people = [
  { value: '', label: 'None' },
  { value: 'a', label: 'Karthik S' },
  { value: 'b', label: 'Murugan K' },
  { value: 'c', label: 'கார்த்திக்' },
];

const labels = (q: string) => filterOptions(people, q).map((o) => o.label);

test('an empty or blank query returns every option', () => {
  assert.deepEqual(labels(''), ['None', 'Karthik S', 'Murugan K', 'கார்த்திக்']);
  assert.deepEqual(labels('   '), labels(''));
});

test('matches anywhere in the name, ignoring case', () => {
  assert.deepEqual(labels('THIK'), ['None', 'Karthik S']);
  assert.deepEqual(labels('k'), ['None', 'Karthik S', 'Murugan K']);
});

test('every typed word must match', () => {
  assert.deepEqual(labels('kar s'), ['None', 'Karthik S']);
  assert.deepEqual(labels('kar k'), ['None', 'Karthik S']);
  assert.deepEqual(labels('kar mur'), ['None']);
});

test('Tamil names can be searched', () => {
  assert.deepEqual(labels('கார்'), ['None', 'கார்த்திக்']);
});

test('the empty-value option ("None") is never filtered out', () => {
  assert.deepEqual(labels('zzz'), ['None']);
  assert.deepEqual(filterOptions(people.slice(1), 'zzz'), []);
});
