// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { daysBetween, formatRupees, todayISO } from './money.ts';

test('rupees use Indian grouping (lakh, crore)', () => {
  assert.equal(formatRupees(0), '₹0');
  assert.equal(formatRupees(215000), '₹2,150');
  assert.equal(formatRupees(3845000), '₹38,450');
  assert.equal(formatRupees(12345600), '₹1,23,456');
  assert.equal(formatRupees(1234567800), '₹1,23,45,678');
  assert.equal(formatRupees(99900), '₹999');
});

test('paise are rounded to whole rupees', () => {
  assert.equal(formatRupees(94049), '₹940');
  assert.equal(formatRupees(94050), '₹941');
  assert.equal(formatRupees(40), '₹0');
});

test('a negative balance (advance paid) keeps its sign', () => {
  assert.equal(formatRupees(-50000), '-₹500');
  assert.equal(formatRupees(-40), '₹0');
});

test('todayISO uses the local date', () => {
  assert.equal(todayISO(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
  assert.equal(todayISO(new Date(2026, 10, 16, 0, 1)), '2026-11-16');
});

test('daysBetween counts whole days, across months and years', () => {
  assert.equal(daysBetween('2026-11-16', '2026-11-16'), 0);
  assert.equal(daysBetween('2026-11-13', '2026-11-16'), 3);
  assert.equal(daysBetween('2026-09-12', '2026-11-16'), 65);
  assert.equal(daysBetween('2025-12-31', '2026-01-01'), 1);
  assert.equal(daysBetween('2026-11-20', '2026-11-16'), 0);
  assert.equal(daysBetween('not a date', '2026-11-16'), 0);
});
