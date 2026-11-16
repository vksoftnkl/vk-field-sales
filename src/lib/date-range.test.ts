// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  addDays,
  financialYear,
  formatRangeLong,
  formatRangeShort,
  monthGrid,
  parseDMY,
  rangeFor,
  RANGE_KEYS,
  toDMY,
  weekday,
} from './date-range.ts';

// Monday 16 Nov 2026, as in the mockup.
const TODAY = '2026-11-16';

test('ranges match the mockup for Monday 16 Nov 2026', () => {
  const short = Object.fromEntries(RANGE_KEYS.map((k) => [k, formatRangeShort(rangeFor(k, TODAY))]));
  assert.deepEqual(short, {
    today: '16 Nov',
    yesterday: '15 Nov',
    thisWeek: '15 – 21 Nov',
    lastWeek: '8 – 14 Nov',
    thisMonth: '1 – 30 Nov',
    last30: '18 Oct – 16 Nov',
    thisYear: 'Apr 2026 – Mar 2027',
    lastYear: 'Apr 2025 – Mar 2026',
  });
});

test('weeks run Sunday to Saturday, whichever day it is', () => {
  assert.equal(weekday(TODAY), 1);
  assert.deepEqual(rangeFor('thisWeek', '2026-11-15'), { from: '2026-11-15', to: '2026-11-21' }); // a Sunday
  assert.deepEqual(rangeFor('thisWeek', '2026-11-21'), { from: '2026-11-15', to: '2026-11-21' }); // a Saturday
  assert.deepEqual(rangeFor('lastWeek', '2027-01-02'), { from: '2026-12-20', to: '2026-12-26' });
});

test('the financial year runs 1 April to 31 March', () => {
  assert.deepEqual(financialYear('2026-04-01'), { from: '2026-04-01', to: '2027-03-31' });
  assert.deepEqual(financialYear('2027-03-31'), { from: '2026-04-01', to: '2027-03-31' });
  assert.deepEqual(rangeFor('thisYear', '2027-02-10'), { from: '2026-04-01', to: '2027-03-31' });
  assert.deepEqual(rangeFor('lastYear', '2026-04-01'), { from: '2025-04-01', to: '2026-03-31' });
});

test('months, leap years and year ends', () => {
  assert.deepEqual(rangeFor('thisMonth', '2028-02-10'), { from: '2028-02-01', to: '2028-02-29' });
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.deepEqual(rangeFor('last30', '2026-04-10'), { from: '2026-03-12', to: '2026-04-10' });
});

test('long labels on the range button', () => {
  assert.equal(formatRangeLong(rangeFor('thisWeek', TODAY)), '15 Nov – 21 Nov 2026');
  assert.equal(formatRangeLong(rangeFor('today', TODAY)), '16 Nov 2026');
  assert.equal(formatRangeLong({ from: '2026-12-27', to: '2027-01-02' }), '27 Dec 2026 – 2 Jan 2027');
  assert.equal(formatRangeShort({ from: '2026-12-27', to: '2027-01-02' }), '27 Dec 2026 – 2 Jan 2027');
});

test('typed dates: dd-mm-yyyy, real dates only', () => {
  assert.equal(parseDMY('01-11-2026'), '2026-11-01');
  assert.equal(parseDMY(' 1/11/2026 '), '2026-11-01');
  assert.equal(parseDMY('29.02.2028'), '2028-02-29');
  assert.equal(parseDMY('29-02-2026'), null);
  assert.equal(parseDMY('31-04-2026'), null);
  assert.equal(parseDMY('2026-11-01'), null);
  assert.equal(parseDMY(''), null);
  assert.equal(toDMY('2026-11-01'), '01-11-2026');
});

test('calendar grid starts on the first day’s weekday', () => {
  const nov = monthGrid(2026, 11); // 1 Nov 2026 is a Sunday
  assert.equal(nov[0], 1);
  assert.equal(nov.length, 30);
  const dec = monthGrid(2026, 12); // 1 Dec 2026 is a Tuesday
  assert.deepEqual(dec.slice(0, 3), [null, null, 1]);
});
