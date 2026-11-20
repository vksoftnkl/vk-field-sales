// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { branchRowIn, docCtx, itemRowIn, partyRowIn, promoLine, schemeRow, slabRow } from './scheme-fixtures.ts';
import {
  branchQualifies,
  compileScheme,
  covers,
  customerQualifies,
  dateOf,
  itemReach,
  itemRowFor,
  liveFail,
  payouts,
  schemeIsLive,
  slabFor,
  timeAllowed,
  timeOf,
  weekdayAllowed,
} from './scheme-rules.ts';

const compile = (over: Parameters<typeof schemeRow>[0] = {}) => compileScheme(schemeRow(over));

// --- parsing ------------------------------------------------------------------------------------

test('parsing: text money and quantities become numbers, NULL upto and fixed price stay apart from 0', () => {
  const s = compile({
    prmMinQty: '5.000',
    prmMinBillAmount: '1500.50',
    prmPriceLevelId: 2,
    slabs: [slabRow({ prsUpto: '0.000', prsFixedPrice: '0.00', prsEach: '0' }), slabRow({ prsId: 'B2' })],
    items: [itemRowIn({ priFactor: '0' })],
  });
  assert.equal(s.minQty, 5);
  assert.equal(s.minBillAmount, 1500.5);
  assert.equal(s.priceLevelId, 2);
  assert.equal(s.slabs[0]!.hasUpto, true);
  assert.equal(s.slabs[0]!.upto, 0);
  assert.equal(s.slabs[0]!.hasFixedPrice, true);
  assert.equal(s.slabs[1]!.hasUpto, false);
  assert.equal(s.slabs[1]!.hasFixedPrice, false);
  assert.equal(s.slabs[0]!.each, 1, 'each <= 0 reads as 1');
  assert.equal(s.items[0]!.factor, 1, 'factor <= 0 reads as 1');
});

test('parsing: 0/1 flags, dates and times', () => {
  const s = compile({
    prmAutoApply: 0,
    prmStartDate: '2026-11-01T00:00:00+05:30',
    prmValidFromTime: '22:00',
    prmValidToTime: '04:00:00',
  });
  assert.equal(s.autoApply, false);
  assert.equal(s.startDate, '2026-11-01');
  assert.equal(s.hasTimeWindow, true);
  assert.equal(dateOf('2026-02-30'), '');
  assert.equal(timeOf('25:00'), null);
  assert.equal(timeOf(''), null);
});

// --- weekday ------------------------------------------------------------------------------------

test('weekday: empty means every day', () => {
  assert.equal(weekdayAllowed('', '2026-11-19'), true);
  assert.equal(weekdayAllowed('  ', '2026-11-19'), true);
});

test('weekday: a list allows its days only (2026-11-19 is a Thursday, 11-16 a Monday, 11-22 a Sunday)', () => {
  assert.equal(weekdayAllowed('MON,THU', '2026-11-19'), true);
  assert.equal(weekdayAllowed('MON,THU', '2026-11-16'), true);
  assert.equal(weekdayAllowed('MON,THU', '2026-11-22'), false);
  assert.equal(weekdayAllowed('SUN', '2026-11-22'), true);
});

test('weekday: the codes are not case-sensitive, parts are not trimmed, junk dates allow', () => {
  assert.equal(weekdayAllowed('mon,thu', '2026-11-19'), true);
  assert.equal(weekdayAllowed('MON, THU', '2026-11-19'), false);
  assert.equal(weekdayAllowed('MON,THU', 'not a date'), true);
});

// --- time window --------------------------------------------------------------------------------

test('time window: inside and outside, both edges count', () => {
  const s = compile({
    prmValidFromTime: '09:00:00',
    prmValidToTime: '17:00:00',
  });
  assert.equal(timeAllowed(s, '12:00:00'), true);
  assert.equal(timeAllowed(s, '09:00:00'), true);
  assert.equal(timeAllowed(s, '17:00:00'), true);
  assert.equal(timeAllowed(s, '08:59:59'), false);
  assert.equal(timeAllowed(s, '17:00:01'), false);
});

test('time window: an end before the start spans midnight', () => {
  const s = compile({
    prmValidFromTime: '22:00:00',
    prmValidToTime: '04:00:00',
  });
  assert.equal(timeAllowed(s, '23:30:00'), true);
  assert.equal(timeAllowed(s, '01:00:00'), true);
  assert.equal(timeAllowed(s, '04:00:00'), true);
  assert.equal(timeAllowed(s, '22:00:00'), true);
  assert.equal(timeAllowed(s, '12:00:00'), false);
});

test('time window: none, or one end only, allows every time', () => {
  assert.equal(timeAllowed(compile(), '03:00:00'), true);
  assert.equal(timeAllowed(compile({ prmValidFromTime: '09:00:00' }), '03:00:00'), true);
});

// --- live ---------------------------------------------------------------------------------------

test('live: an ordinary approved scheme is live today', () => {
  assert.equal(schemeIsLive(compile(), docCtx()), true);
});

test('live: status, active flag, auto-apply and coupon stop it', () => {
  assert.equal(liveFail(compile({ prmStatus: 'DRAFT' }), docCtx()), 'status');
  assert.equal(liveFail(compile({ prmStatus: 'SUSPENDED' }), docCtx()), 'status');
  const off = compile();
  off.isActive = false;
  assert.equal(liveFail(off, docCtx()), 'status');
  assert.equal(liveFail(compile({ prmAutoApply: false }), docCtx()), 'autoApply');
  assert.equal(liveFail(compile({ prmCouponBatchId: 'BATCH' }), docCtx()), 'coupon');
});

test('live: another company, and a header branch that is not the order branch', () => {
  assert.equal(liveFail(compile({ prmCompId: 'C2' }), docCtx()), 'company');
  assert.equal(liveFail(compile({ prmBranchId: 'BR2' }), docCtx()), 'headerBranch');
  assert.equal(schemeIsLive(compile({ prmBranchId: 'BR1' }), docCtx()), true);
  assert.equal(schemeIsLive(compile({ prmBranchId: 'BR2' }), docCtx({ branchId: '' })), true, 'an unknown order branch does not stop it');
  assert.equal(schemeIsLive(compile({ prmBranchId: null }), docCtx()), true, 'no header branch = every branch');
});

test('live: dates, the start and the end date themselves are inside', () => {
  const s = compile({ prmStartDate: '2026-11-19', prmEndDate: '2026-11-19' });
  assert.equal(schemeIsLive(s, docCtx({ docDate: '2026-11-19' })), true);
  assert.equal(liveFail(s, docCtx({ docDate: '2026-11-18' })), 'notStarted');
  assert.equal(liveFail(s, docCtx({ docDate: '2026-11-20' })), 'ended');
});

test('live: weekday and time window', () => {
  assert.equal(liveFail(compile({ prmValidWeekdays: 'MON' }), docCtx()), 'weekday');
  assert.equal(liveFail(compile({ prmValidFromTime: '22:00:00', prmValidToTime: '23:00:00' }), docCtx()), 'time');
});

test('live: bill type ALL or equal; price level 0 on either side or equal', () => {
  assert.equal(liveFail(compile({ prmBillType: 'CASH' }), docCtx({ billType: 'CREDIT' })), 'billType');
  assert.equal(schemeIsLive(compile({ prmBillType: 'CREDIT' }), docCtx({ billType: 'CREDIT' })), true);
  assert.equal(schemeIsLive(compile({ prmBillType: 'ALL' }), docCtx({ billType: 'CREDIT' })), true);
  assert.equal(liveFail(compile({ prmPriceLevelId: 2 }), docCtx({ priceLevelId: 1 })), 'priceLevel');
  assert.equal(schemeIsLive(compile({ prmPriceLevelId: 2 }), docCtx({ priceLevelId: 2 })), true);
  assert.equal(schemeIsLive(compile({ prmPriceLevelId: 2 }), docCtx({ priceLevelId: 0 })), true);
  assert.equal(schemeIsLive(compile({ prmPriceLevelId: null }), docCtx({ priceLevelId: 3 })), true);
});

test('live: an unreadable order date skips the date checks; an unreadable time allows', () => {
  assert.equal(schemeIsLive(compile({ prmValidWeekdays: 'MON', prmEndDate: '2020-01-01' }), docCtx({ docDate: '' })), true);
  assert.equal(schemeIsLive(compile({ prmValidFromTime: '09:00:00', prmValidToTime: '10:00:00' }), docCtx({ docTime: '' })), true);
});

// --- branch scope -------------------------------------------------------------------------------

test('branch scope: ALL passes; LIST needs a row for the order branch', () => {
  assert.equal(branchQualifies(compile({ prmBranchScope: 'ALL' }), docCtx()), true);
  const listed = compile({
    prmBranchScope: 'LIST',
    branches: [branchRowIn({ prbBranchId: 'BR1' })],
  });
  assert.equal(branchQualifies(listed, docCtx()), true);
  assert.equal(branchQualifies(listed, docCtx({ branchId: 'BR9' })), false, 'not listed');
});

test('branch scope: an EXCLUDE row stops the branch', () => {
  const s = compile({
    prmBranchScope: 'LIST',
    branches: [branchRowIn({ prbBranchId: 'BR1', prbIsExclude: true })],
  });
  assert.equal(branchQualifies(s, docCtx()), false);
});

// --- customer scope -----------------------------------------------------------------------------

test('customer scope: ALL passes; a LIST no row reaches says no', () => {
  assert.equal(customerQualifies(compile({ prmCustScope: 'ALL' }), docCtx()), true);
  assert.equal(customerQualifies(compile({ prmCustScope: 'LIST' }), docCtx()), false);
  assert.equal(
    customerQualifies(
      compile({
        prmCustScope: 'LIST',
        parties: [partyRowIn({ prpScopeId: 'OTHER' })],
      }),
      docCtx(),
    ),
    false,
  );
});

test('customer scope: each kind reaches the shop (customer, group, area, city through the area)', () => {
  const one = (kind: string, scopeId: string) =>
    compile({
      prmCustScope: 'LIST',
      parties: [partyRowIn({ prpKind: kind, prpScopeId: scopeId })],
    });
  assert.equal(customerQualifies(one('CUSTOMER', 'CUST1'), docCtx()), true);
  assert.equal(customerQualifies(one('CUSTOMER_GROUP', 'GRP1'), docCtx()), true);
  assert.equal(customerQualifies(one('AREA', 'AREA1'), docCtx()), true);
  assert.equal(customerQualifies(one('CITY', 'CITY1'), docCtx()), true);
});

test('customer scope: no city when the shop has no area; an empty id is never probed', () => {
  const city = compile({
    prmCustScope: 'LIST',
    parties: [partyRowIn({ prpKind: 'CITY', prpScopeId: 'CITY1' })],
  });
  assert.equal(customerQualifies(city, docCtx({ cityId: '' })), false);
  const group = compile({
    prmCustScope: 'LIST',
    parties: [partyRowIn({ prpKind: 'CUSTOMER_GROUP', prpScopeId: '' })],
  });
  assert.equal(customerQualifies(group, docCtx({ custGroupId: '' })), false);
});

test('customer scope: the highest match priority wins', () => {
  const s = compile({
    prmCustScope: 'LIST',
    parties: [
      partyRowIn({
        prpId: 'a',
        prpKind: 'CUSTOMER_GROUP',
        prpScopeId: 'GRP1',
        prpIsExclude: true,
        prpMatchPriority: 1,
      }),
      partyRowIn({
        prpId: 'b',
        prpKind: 'CUSTOMER',
        prpScopeId: 'CUST1',
        prpIsExclude: false,
        prpMatchPriority: 4,
      }),
    ],
  });
  assert.equal(customerQualifies(s, docCtx()), true, 'the shop row beats the group exclusion');
  const t = compile({
    prmCustScope: 'LIST',
    parties: [
      partyRowIn({
        prpId: 'a',
        prpKind: 'CUSTOMER_GROUP',
        prpScopeId: 'GRP1',
        prpIsExclude: false,
        prpMatchPriority: 1,
      }),
      partyRowIn({
        prpId: 'b',
        prpKind: 'CUSTOMER',
        prpScopeId: 'CUST1',
        prpIsExclude: true,
        prpMatchPriority: 4,
      }),
    ],
  });
  assert.equal(customerQualifies(t, docCtx()), false, 'the shop exclusion beats the group');
});

test('customer scope: at equal priority an EXCLUDE beats an INCLUDE', () => {
  const s = compile({
    prmCustScope: 'LIST',
    parties: [
      partyRowIn({
        prpId: 'a',
        prpKind: 'AREA',
        prpScopeId: 'AREA1',
        prpIsExclude: false,
        prpMatchPriority: 3,
      }),
      partyRowIn({
        prpId: 'b',
        prpKind: 'CITY',
        prpScopeId: 'CITY1',
        prpIsExclude: true,
        prpMatchPriority: 3,
      }),
    ],
  });
  assert.equal(customerQualifies(s, docCtx()), false);
  const flipped = compile({
    prmCustScope: 'LIST',
    parties: [
      partyRowIn({
        prpId: 'a',
        prpKind: 'AREA',
        prpScopeId: 'AREA1',
        prpIsExclude: true,
        prpMatchPriority: 3,
      }),
      partyRowIn({
        prpId: 'b',
        prpKind: 'CITY',
        prpScopeId: 'CITY1',
        prpIsExclude: false,
        prpMatchPriority: 3,
      }),
    ],
  });
  assert.equal(customerQualifies(flipped, docCtx()), false, 'whichever order the rows come in');
});

// --- item scope ---------------------------------------------------------------------------------

test('item scope: ALL qualifies every line with no row', () => {
  const m = itemRowFor(compile(), promoLine());
  assert.deepEqual([m.qualifies, m.row], [true, null]);
});

test('item scope: a LIST names the item, or its group, brand, category or section', () => {
  const list = (kind: string, scopeId: string) =>
    compile({
      prmItemScope: 'LIST',
      items: [itemRowIn({ priKind: kind, priScopeId: scopeId })],
    });
  assert.equal(itemRowFor(list('ITEM', 'ITEM1'), promoLine()).qualifies, true);
  assert.equal(itemRowFor(list('ITEM_GROUP', 'G1'), promoLine({ groupId: 'G1' })).qualifies, true);
  assert.equal(itemRowFor(list('ITEM_BRAND', 'B1'), promoLine({ brandId: 'B1' })).qualifies, true);
  assert.equal(itemRowFor(list('ITEM_CATEGORY', 'K1'), promoLine({ categoryId: 'K1' })).qualifies, true);
  assert.equal(itemRowFor(list('ITEM_SECTION', 'S1'), promoLine({ sectionId: 'S1' })).qualifies, true);
  const none = itemRowFor(list('ITEM', 'OTHER'), promoLine());
  assert.deepEqual([none.qualifies, none.why], [false, 'notListed']);
});

test('item scope: an ITEM row for another unit is skipped and the brand row takes over', () => {
  const s = compile({
    prmItemScope: 'LIST',
    items: [
      itemRowIn({
        priId: 'a',
        priKind: 'ITEM',
        priScopeId: 'ITEM1',
        priUnitId: 'U-CASE',
        priMatchPriority: 4,
      }),
      itemRowIn({
        priId: 'b',
        priKind: 'ITEM_BRAND',
        priScopeId: 'B1',
        priMatchPriority: 3,
      }),
    ],
  });
  const m = itemRowFor(s, promoLine({ brandId: 'B1', unitId: 'U-PCS' }));
  assert.equal(m.row?.id, 'b');
  assert.equal(itemRowFor(s, promoLine({ brandId: 'B1', unitId: 'U-CASE' })).row?.id, 'a');
  const alone = compile({
    prmItemScope: 'LIST',
    items: [itemRowIn({ priUnitId: 'U-CASE' })],
  });
  const miss = itemRowFor(alone, promoLine({ unitId: 'U-PCS' }));
  assert.deepEqual([miss.qualifies, miss.why], [false, 'unit']);
  assert.equal(itemRowFor(alone, promoLine({ unitId: '' })).qualifies, true, 'an unknown line unit matches');
});

test('item scope: any EXCLUDE row kills the line, even beside a better include', () => {
  const s = compile({
    prmItemScope: 'LIST',
    items: [
      itemRowIn({
        priId: 'a',
        priKind: 'ITEM',
        priScopeId: 'ITEM1',
        priMatchPriority: 4,
      }),
      itemRowIn({
        priId: 'b',
        priKind: 'ITEM_GROUP',
        priScopeId: 'G1',
        priIsExclude: true,
        priMatchPriority: 0,
      }),
    ],
  });
  const m = itemRowFor(s, promoLine({ groupId: 'G1' }));
  assert.deepEqual([m.qualifies, m.why], [false, 'excluded']);
  assert.equal(
    itemReach(s, {
      itemId: 'ITEM1',
      groupId: 'G1',
      categoryId: '',
      brandId: '',
      sectionId: '',
    }).excluded,
    true,
  );
});

test('item scope: the higher match priority wins; equal priority keeps the first probed', () => {
  const s = compile({
    prmItemScope: 'LIST',
    items: [
      itemRowIn({
        priId: 'grp',
        priKind: 'ITEM_GROUP',
        priScopeId: 'G1',
        priMatchPriority: 0,
      }),
      itemRowIn({
        priId: 'brand',
        priKind: 'ITEM_BRAND',
        priScopeId: 'B1',
        priMatchPriority: 3,
      }),
      itemRowIn({
        priId: 'sec',
        priKind: 'ITEM_SECTION',
        priScopeId: 'S1',
        priMatchPriority: 3,
      }),
    ],
  });
  assert.equal(itemRowFor(s, promoLine({ itemId: 'X', groupId: 'G1', brandId: 'B1', sectionId: 'S1' })).row?.id, 'brand');
});

test('item scope: pri_min_qty is a floor on the line quantity', () => {
  const s = compile({
    prmItemScope: 'LIST',
    items: [itemRowIn({ priMinQty: '12.000' })],
  });
  const low = itemRowFor(s, promoLine({ netQty: 11.999 }));
  assert.deepEqual([low.qualifies, low.why], [false, 'lineMinQty']);
  assert.equal(itemRowFor(s, promoLine({ netQty: 12 })).qualifies, true);
});

// --- bands --------------------------------------------------------------------------------------

test('bands: the highest exceeds that covers the measure wins, in any row order', () => {
  const s = compile({
    slabs: [
      slabRow({ prsId: 'hi', prsExceeds: '24', prsUpto: null }),
      slabRow({ prsId: 'lo', prsExceeds: '6', prsUpto: '11' }),
      slabRow({ prsId: 'mid', prsExceeds: '12', prsUpto: '23' }),
    ],
  });
  assert.equal(slabFor(s, 18)?.id, 'mid');
  assert.equal(slabFor(s, 6)?.id, 'lo', 'exceeds is inclusive');
  assert.equal(slabFor(s, 11)?.id, 'lo', 'upto is inclusive');
  assert.equal(slabFor(s, 500)?.id, 'hi', 'open upto');
  assert.equal(slabFor(s, 5.999), null, 'below every band');
});

test('bands: upto 0 is a real ceiling, not open-ended', () => {
  const s = compile({ slabs: [slabRow({ prsExceeds: '0', prsUpto: '0' })] });
  assert.equal(slabFor(s, 0)?.id, 'B1');
  assert.equal(slabFor(s, 1), null);
  assert.equal(covers(s.slabs[0]!, 0), true);
});

test('payouts: once unless repeating; per whole each; capped by max repeats; zero below one each', () => {
  const once = compile({ slabs: [slabRow()] }).slabs[0]!;
  assert.equal(payouts(once, 99), 1);
  const rep = compile({
    slabs: [slabRow({ prsIsRepeat: true, prsEach: '10' })],
  }).slabs[0]!;
  assert.equal(payouts(rep, 9), 0);
  assert.equal(payouts(rep, 10), 1);
  assert.equal(payouts(rep, 24), 2);
  assert.equal(payouts(rep, 30), 3);
  const capped = compile({
    slabs: [slabRow({ prsIsRepeat: true, prsEach: '10', prsMaxRepeats: 2 })],
  }).slabs[0]!;
  assert.equal(payouts(capped, 95), 2);
  assert.equal(payouts(capped, 15), 1);
});
