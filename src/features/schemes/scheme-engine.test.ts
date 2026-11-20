// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compileSchemes, evaluate } from './scheme-engine.ts';
import { docCtx, itemRowIn, promoLine, schemeRow, slabRow } from './scheme-fixtures.ts';
import type { PromoDocContext, PromoLine, SchemeInput } from './scheme-types.ts';

const run = (schemes: SchemeInput[], lines: PromoLine[], ctx: Partial<PromoDocContext> = {}) => evaluate(lines, docCtx(ctx), compileSchemes(schemes));
const near = (a: number, b: number, msg?: string) => assert.ok(Math.abs(a - b) < 1e-9, `${msg ?? ''} ${a} != ${b}`);

/** A 10% off scheme on every item, the base most tests bend. */
const pct = (over: Partial<SchemeInput> = {}, perc = '10') => schemeRow({ slabs: [slabRow({ prsDiscPerc: perc })], ...over });
const free = (over: Partial<SchemeInput> = {}) =>
  schemeRow({
    prmBenefit: 'FREE_ITEM',
    prmItemScope: 'LIST',
    items: [itemRowIn({ priKind: 'ITEM', priScopeId: 'ITEM1' })],
    slabs: [
      slabRow({
        prsExceeds: '10',
        prsIsRepeat: true,
        prsEach: '10',
        prsFreeItemId: 'FREE1',
        prsFreeUnitId: 'U-PCS',
        prsFreeItemName: 'Free item',
        prsFreeUnitName: 'PCS',
        prsFreeQty: '1',
      }),
    ],
    ...over,
  });

// --- gates and lines ----------------------------------------------------------------------------

test('the order switch off: nothing is decided', () => {
  const r = run([pct()], [promoLine()], { promotionsEnabled: false });
  assert.equal(r.lines[0]!.schPerc, 0);
  assert.equal(r.freeLines.length, 0);
  assert.equal(r.totalBenefit, 0);
  assert.equal(r.traces.length, 0);
});

test('nothing matching gives an empty answer with one outcome per line', () => {
  const r = run([pct({ prmStatus: 'DRAFT' })], [promoLine(), promoLine({ row: 1, itemId: 'ITEM2' })]);
  assert.equal(r.lines.length, 2);
  assert.equal(r.totalBenefit, 0);
  assert.equal(r.traces[0]!.status, 'notLive');
  assert.equal(r.traces[0]!.liveFail, 'status');
});

test('a free line and an opted-out line are skipped', () => {
  const r = run([pct()], [promoLine({ isFree: true }), promoLine({ row: 1, schemeFlag: false }), promoLine({ row: 2 })]);
  assert.equal(r.lines[0]!.schPerc, 0);
  assert.equal(r.lines[1]!.schPerc, 0);
  assert.equal(r.lines[2]!.schPerc, 10);
  assert.deepEqual(r.traces[0]!.skipped, [{ index: 1, why: 'flagOff' }]);
});

test('a manual discount blocks the scheme unless it allows one; the note says nothing matched', () => {
  const l = promoLine({ hasManualDisc: true });
  const blocked = run([pct()], [l]);
  assert.equal(blocked.lines[0]!.schPerc, 0);
  assert.deepEqual(blocked.notes, ['S1: matched no line on this document']);
  assert.equal(blocked.traces[0]!.status, 'noLine');
  assert.equal(blocked.traces[0]!.skipped[0]!.why, 'manualDisc');
  const allowed = run([pct({ prmAllowWithManualDisc: true })], [l]);
  assert.equal(allowed.lines[0]!.schPerc, 10);
  assert.deepEqual(allowed.notes, []);
});

test('"matched no line" when the item scope reaches nothing', () => {
  const s = pct({
    prmItemScope: 'LIST',
    items: [itemRowIn({ priScopeId: 'OTHER' })],
  });
  const r = run([s], [promoLine()]);
  assert.deepEqual(r.notes, ['S1: matched no line on this document']);
});

test('a branch or shop the scheme does not reach never sees a line', () => {
  assert.equal(run([pct({ prmBranchScope: 'LIST' })], [promoLine()]).traces[0]!.status, 'branch');
  assert.equal(run([pct({ prmCustScope: 'LIST' })], [promoLine()]).traces[0]!.status, 'customer');
});

test('minimum quantity and minimum amount are checked on the sums of the lines', () => {
  const two = [promoLine(), promoLine({ row: 1, itemId: 'ITEM2' })]; // 10 qty, ₹1,000 each
  assert.equal(run([pct({ prmMinQty: '20.000' })], two).lines[0]!.schPerc, 10, 'two lines reach 20 together');
  assert.equal(run([pct({ prmMinQty: '20.000' })], [promoLine()]).traces[0]!.status, 'minQty');
  assert.equal(run([pct({ prmMinBillAmount: '2000.00' })], two).lines[1]!.schPerc, 10);
  assert.equal(run([pct({ prmMinBillAmount: '2000.00' })], [promoLine()]).traces[0]!.status, 'minAmount');
});

// --- DISC_PER_ITEM ------------------------------------------------------------------------------

test('DISC_PER_ITEM: each line gets its own row rate, as a rate or an amount; pri_factor is ignored', () => {
  const s = schemeRow({
    prmBenefit: 'DISC_PER_ITEM',
    prmItemScope: 'LIST',
    items: [
      itemRowIn({
        priId: 'a',
        priScopeId: 'ITEM1',
        priDiscPerc: '5',
        priFactor: '3',
      }),
      itemRowIn({ priId: 'b', priScopeId: 'ITEM2', priDiscQty: '2' }),
      itemRowIn({ priId: 'c', priScopeId: 'ITEM3', priDiscAmt: '50' }),
      itemRowIn({ priId: 'd', priScopeId: 'ITEM4' }),
    ],
  });
  const r = run(
    [s],
    ['ITEM1', 'ITEM2', 'ITEM3', 'ITEM4'].map((id, row) => promoLine({ row, itemId: id })),
  );
  assert.equal(r.lines[0]!.schPerc, 5);
  assert.equal(r.lines[1]!.schPerQty, 2);
  assert.equal(r.lines[2]!.schAmt, 50);
  assert.equal(r.lines[3]!.schemeId, '', 'a scope-only row gives nothing and labels nothing');
  near(r.totalBenefit, 50 + 20 + 50);
  assert.deepEqual(r.notes, []);
  assert.equal(r.lines[0]!.schemeId, 'S1');
});

test('DISC_PER_ITEM: no row carries a rate -> a note', () => {
  const s = schemeRow({
    prmBenefit: 'DISC_PER_ITEM',
    prmItemScope: 'LIST',
    items: [itemRowIn()],
  });
  const r = run([s], [promoLine()]);
  assert.deepEqual(r.notes, ['S1: no item row carries a rate']);
  assert.equal(r.traces[0]!.status, 'noRate');
});

// --- FREE_ITEM ----------------------------------------------------------------------------------

test('FREE_ITEM: nothing at 9, one at 10, two at 24 (repeating every 10)', () => {
  assert.equal(run([free()], [promoLine({ netQty: 9 })]).freeLines.length, 0);
  assert.equal(run([free()], [promoLine({ netQty: 10 })]).freeLines[0]!.qty, 1);
  const r = run([free()], [promoLine({ netQty: 24 })]);
  assert.equal(r.freeLines.length, 1);
  assert.deepEqual(
    {
      item: r.freeLines[0]!.itemId,
      unit: r.freeLines[0]!.unitId,
      qty: r.freeLines[0]!.qty,
      id: r.freeLines[0]!.schemeId,
      name: r.freeLines[0]!.schemeName,
    },
    { item: 'FREE1', unit: 'U-PCS', qty: 2, id: 'S1', name: 'Scheme one' },
  );
});

test('FREE_ITEM: max repeats caps the payouts; a non-repeating band pays once', () => {
  const capped = free({
    slabs: [free().slabs[0]!, ...[]].map((b) => ({ ...b, prsMaxRepeats: 2 })),
  });
  assert.equal(run([capped], [promoLine({ netQty: 95 })]).freeLines[0]!.qty, 2);
  const once = free({ slabs: [{ ...free().slabs[0]!, prsIsRepeat: false }] });
  assert.equal(run([once], [promoLine({ netQty: 95 })]).freeLines[0]!.qty, 1);
});

test('FREE_ITEM: sits after the last line that earned it; a bill-level trigger appends', () => {
  const lines = [promoLine({ row: 0, netQty: 5 }), promoLine({ row: 3, itemId: 'ITEM2', netQty: 5 })];
  const s = free({
    prmItemScope: 'LIST',
    items: [itemRowIn({ priId: 'a', priScopeId: 'ITEM1' }), itemRowIn({ priId: 'b', priScopeId: 'ITEM2' })],
    prmApplyOn: 'ITEM_QTY',
  });
  assert.equal(run([s], lines).freeLines[0]!.afterRow, 3, 'the two lines count together (5 + 5)');
  const bill = schemeRow({
    prmApplyOn: 'BILL_QTY',
    prmBenefit: 'FREE_ITEM',
    slabs: free().slabs,
  });
  assert.equal(run([bill], lines).freeLines[0]!.afterRow, -1);
});

test('FREE_ITEM: the trigger line is not labelled with the scheme', () => {
  const r = run([free()], [promoLine({ netQty: 10 })]);
  assert.equal(r.lines[0]!.schemeId, '');
  assert.equal(r.lines[0]!.schemeName, '');
  assert.equal(r.traces[0]!.status, 'applied');
});

test('FREE_ITEM: an exclusive scheme claims its lines; a stackable one leaves them', () => {
  const later = pct({
    prmId: 'S2',
    prmCode: 'S2',
    prmName: 'Later',
    prmPriority: 2,
    prmStackMode: 'STACKABLE',
  });
  const claimed = run([free(), later], [promoLine({ netQty: 10 })]);
  assert.equal(claimed.lines[0]!.schPerc, 0);
  assert.equal(claimed.traces[1]!.status, 'noLine');
  assert.equal(claimed.traces[1]!.skipped[0]!.why, 'claimed');
  const shared = run([free({ prmStackMode: 'STACKABLE' }), later], [promoLine({ netQty: 10 })]);
  assert.equal(shared.lines[0]!.schPerc, 10);
  assert.equal(shared.freeLines.length, 1);
});

test('FREE_ITEM: a band with no free item or no quantity gives nothing', () => {
  const noItem = free({
    slabs: [{ ...free().slabs[0]!, prsFreeItemId: null }],
  });
  assert.equal(run([noItem], [promoLine()]).traces[0]!.status, 'noFreeItem');
  const noQty = free({ slabs: [{ ...free().slabs[0]!, prsFreeQty: '0' }] });
  assert.equal(run([noQty], [promoLine()]).freeLines.length, 0);
});

// --- DISC_PERC ----------------------------------------------------------------------------------

test('DISC_PERC: the rate is kept, the benefit is on the money of the counted lines', () => {
  const r = run(
    [pct()],
    [
      promoLine(),
      promoLine({
        row: 1,
        itemId: 'ITEM2',
        netGross: 3000,
        gross: 3000,
        taxable: 3000,
      }),
    ],
  );
  assert.deepEqual([r.lines[0]!.schPerc, r.lines[0]!.schAmt, r.lines[1]!.schPerc], [10, 0, 10]);
  near(r.totalBenefit, 400);
  assert.equal(r.lines[0]!.schemeId, 'S1');
  assert.equal(r.lines[0]!.schemeName, 'Scheme one');
});

test('DISC_PERC: pri_factor scales the line rate', () => {
  const s = pct({
    prmItemScope: 'LIST',
    items: [itemRowIn({ priFactor: '1.5' })],
  });
  assert.equal(run([s], [promoLine()]).lines[0]!.schPerc, 15);
});

test('DISC_PERC: a band cap, an order cap and a line cap each turn the rate into an amount', () => {
  const bandCap = run([pct({ slabs: [slabRow({ prsDiscPerc: '10', prsMaxBenefitAmt: '60' })] })], [promoLine()]);
  assert.deepEqual([bandCap.lines[0]!.schPerc, bandCap.lines[0]!.schAmt], [0, 60]);
  const orderCap = run([pct({ prmMaxBenefitPerBill: '30' })], [promoLine()]);
  assert.equal(orderCap.lines[0]!.schAmt, 30);
  assert.equal(orderCap.totalBenefit, 30);
  const lineCap = run(
    [
      pct({
        prmItemScope: 'LIST',
        items: [itemRowIn({ priMaxBenefit: '40' })],
      }),
    ],
    [promoLine()],
  );
  assert.deepEqual([lineCap.lines[0]!.schPerc, lineCap.lines[0]!.schAmt], [0, 40]);
});

test('DISC_PERC: a cap is shared pro-rata over the lines', () => {
  const r = run(
    [pct({ prmApplyOn: 'ITEM_AMOUNT', prmMaxBenefitPerBill: '100' })],
    [
      promoLine(),
      promoLine({
        row: 1,
        itemId: 'ITEM2',
        netGross: 3000,
        gross: 3000,
        taxable: 3000,
      }),
    ],
  );
  near(r.lines[0]!.schAmt, 25);
  near(r.lines[1]!.schAmt, 75);
});

// --- DISC_AMT -----------------------------------------------------------------------------------

test('DISC_AMT: rupees per unit keep the per-unit rate', () => {
  const s = schemeRow({
    slabs: [slabRow({ prsDiscQty: '2' })],
    prmBenefit: 'DISC_AMT',
  });
  const r = run([s], [promoLine()]);
  assert.deepEqual([r.lines[0]!.schPerQty, r.lines[0]!.schAmt], [2, 0]);
  near(r.totalBenefit, 20);
});

test('DISC_AMT: a flat amount pays once per payout and is shared pro-rata by quantity', () => {
  const s = schemeRow({
    prmBenefit: 'DISC_AMT',
    slabs: [
      slabRow({
        prsExceeds: '10',
        prsDiscAmt: '50',
        prsIsRepeat: true,
        prsEach: '10',
      }),
    ],
  });
  const r = run([s], [promoLine({ netQty: 10 }), promoLine({ row: 1, itemId: 'ITEM2', netQty: 14 })]);
  near(r.totalBenefit, 100, '24 qty = 2 payouts');
  near(r.lines[0]!.schAmt, (100 * 10) / 24);
  near(r.lines[1]!.schAmt, (100 * 14) / 24);
});

// --- FIXED_PRICE --------------------------------------------------------------------------------

test('FIXED_PRICE: the drop from the typed rate to the fixed price, only ever downwards', () => {
  const s = schemeRow({
    prmBenefit: 'FIXED_PRICE',
    slabs: [slabRow({ prsFixedPrice: '80' })],
  });
  const r = run([s], [promoLine()]);
  near(r.lines[0]!.schAmt, 200);
  assert.equal(r.lines[0]!.hasFixedPrice, true);
  assert.equal(r.lines[0]!.fixedPrice, 80);
});

test('FIXED_PRICE: a line already at or below it gives nothing, with a note', () => {
  const s = schemeRow({
    prmBenefit: 'FIXED_PRICE',
    slabs: [slabRow({ prsFixedPrice: '100' })],
  });
  const r = run([s], [promoLine()]);
  assert.equal(r.lines[0]!.schAmt, 0);
  assert.deepEqual(r.notes, ['S1: every matching line already sells at or below 100']);
  assert.equal(r.traces[0]!.status, 'noBenefit');
});

test("FIXED_PRICE (quirk kept): the benefit is shared by the measure, not by each line's own drop", () => {
  const s = schemeRow({
    prmBenefit: 'FIXED_PRICE',
    slabs: [slabRow({ prsFixedPrice: '80' })],
  });
  const r = run([s], [promoLine(), promoLine({ row: 1, itemId: 'ITEM2', rate: 70 })]);
  near(r.totalBenefit, 200);
  near(r.lines[0]!.schAmt, 100);
  near(r.lines[1]!.schAmt, 100, 'the line already below the fixed price still takes half');
});

// --- bill-level ---------------------------------------------------------------------------------

test('a bill-level amount becomes one % of the qualifying base on every line', () => {
  const s = schemeRow({
    prmApplyOn: 'BILL_AMOUNT',
    prmBenefit: 'DISC_AMT',
    slabs: [slabRow({ prsExceeds: '1000', prsDiscAmt: '100' })],
  });
  const r = run(
    [s],
    [
      promoLine(),
      promoLine({
        row: 1,
        itemId: 'ITEM2',
        netGross: 3000,
        gross: 3000,
        taxable: 3000,
      }),
    ],
  );
  near(r.lines[0]!.billSchPerc, 2.5);
  near(r.lines[1]!.billSchPerc, 2.5);
  assert.equal(r.lines[0]!.schAmt, 0);
  assert.equal(r.lines[0]!.schemeId, 'S1');
});

test('two bill-level schemes add their percentages', () => {
  const a = schemeRow({
    prmApplyOn: 'BILL_AMOUNT',
    prmBenefit: 'DISC_AMT',
    prmStackMode: 'STACKABLE',
    slabs: [slabRow({ prsDiscAmt: '100' })],
  });
  const b = schemeRow({
    prmId: 'S2',
    prmCode: 'S2',
    prmName: 'Two',
    prmPriority: 2,
    prmApplyOn: 'BILL_AMOUNT',
    prmStackMode: 'STACKABLE',
    slabs: [slabRow({ prsDiscPerc: '1' })],
  });
  const r = run([a, b], [promoLine({ netGross: 4000, gross: 4000, taxable: 4000 })]);
  near(r.lines[0]!.billSchPerc, 2.5 + 1);
  assert.equal(r.lines[0]!.schemeName, 'Scheme one + Two');
});

// --- priority, claims, stacking -----------------------------------------------------------------

test('priority: the lowest number runs first whatever the order in the list; ties keep arrival order', () => {
  const late = pct({
    prmId: 'L',
    prmCode: 'L',
    prmName: 'Late',
    prmPriority: 5,
  });
  const early = pct({
    prmId: 'E',
    prmCode: 'E',
    prmName: 'Early',
    prmPriority: 2,
  });
  assert.deepEqual(
    compileSchemes([late, early]).map((s) => s.id),
    ['E', 'L'],
  );
  const t1 = pct({ prmId: 'T1', prmCode: 'T1', prmPriority: 3 });
  const t2 = pct({ prmId: 'T2', prmCode: 'T2', prmPriority: 3 });
  const t0 = pct({ prmId: 'T0', prmCode: 'T0', prmPriority: 3 });
  assert.deepEqual(
    compileSchemes([t1, t2, t0]).map((s) => s.id),
    ['T1', 'T2', 'T0'],
  );
  const r = run([late, early], [promoLine()]);
  assert.equal(r.lines[0]!.schemeId, 'E', 'the exclusive early scheme wins the line');
  assert.equal(r.lines[0]!.schemeName, 'Early');
});

test('an EXCLUSIVE scheme claims its lines, so a later one skips them', () => {
  const a = pct({ prmPriority: 1 });
  const b = pct({ prmId: 'S2', prmCode: 'S2', prmName: 'Two', prmPriority: 2 }, '20');
  const r = run([b, a], [promoLine(), promoLine({ row: 1, itemId: 'ITEM2' })]);
  assert.deepEqual([r.lines[0]!.schPerc, r.lines[1]!.schPerc], [10, 10]);
  assert.equal(r.traces[1]!.status, 'noLine');
});

test('two STACKABLE schemes fold into one amount; the line keeps the first id and joins the names', () => {
  const a = pct({ prmStackMode: 'STACKABLE' });
  const b = pct(
    {
      prmId: 'S2',
      prmCode: 'S2',
      prmName: 'Two',
      prmPriority: 2,
      prmStackMode: 'STACKABLE',
    },
    '5',
  );
  const r = run([a, b], [promoLine()]);
  const o = r.lines[0]!;
  assert.deepEqual([o.schPerc, o.schPerQty], [0, 0]);
  near(o.schAmt, 100 + 50);
  assert.equal(o.schemeId, 'S1');
  assert.equal(o.schemeName, 'Scheme one + Two');
  near(r.totalBenefit, 150);
});

// --- which figure a *_AMOUNT trigger measures ---------------------------------------------------

test('GROSS, NET and TAXABLE measure different figures', () => {
  const l = promoLine({ gross: 1000, netGross: 900, taxable: 950 });
  const band = (calc: string) =>
    schemeRow({
      prmApplyOn: 'ITEM_AMOUNT',
      prmCalcOnAmountType: calc,
      slabs: [slabRow({ prsExceeds: '920', prsDiscPerc: '10' })],
    });
  const gross = run([band('GROSS_AMOUNT')], [l]);
  near(gross.totalBenefit, 100);
  assert.equal(run([band('NET_AMOUNT')], [l]).traces[0]!.status, 'noBand');
  near(run([band('TAXABLE_AMOUNT')], [l]).totalBenefit, 95);
});

// --- the order cap across schemes ---------------------------------------------------------------

test('what is left of the order cap after an earlier scheme limits a later one', () => {
  const a = schemeRow({
    prmBenefit: 'DISC_AMT',
    prmStackMode: 'STACKABLE',
    slabs: [slabRow({ prsDiscAmt: '80' })],
  });
  const b = schemeRow({
    prmId: 'S2',
    prmCode: 'S2',
    prmName: 'Two',
    prmPriority: 2,
    prmBenefit: 'DISC_AMT',
    prmStackMode: 'STACKABLE',
    prmMaxBenefitPerBill: '100',
    slabs: [slabRow({ prsDiscAmt: '60' })],
  });
  const r = run([a, b], [promoLine()]);
  near(r.traces[1]!.benefit, 20);
  near(r.totalBenefit, 100);
});

test('order cap (quirk kept): a remainder of exactly 0 caps nothing', () => {
  const a = schemeRow({
    prmBenefit: 'DISC_AMT',
    prmStackMode: 'STACKABLE',
    slabs: [slabRow({ prsDiscAmt: '100' })],
  });
  const b = schemeRow({
    prmId: 'S2',
    prmCode: 'S2',
    prmName: 'Two',
    prmPriority: 2,
    prmBenefit: 'DISC_AMT',
    prmStackMode: 'STACKABLE',
    prmMaxBenefitPerBill: '100',
    slabs: [slabRow({ prsDiscAmt: '60' })],
  });
  near(run([a, b], [promoLine()]).traces[1]!.benefit, 60);
});

// --- traces -------------------------------------------------------------------------------------

test('a trace records the counted lines, the measure and the band', () => {
  const r = run([pct({ prmItemScope: 'LIST', items: [itemRowIn()] })], [promoLine({ itemId: 'X' }), promoLine({ row: 1 })]);
  const t = r.traces[0]!;
  assert.deepEqual(t.counted, [1]);
  assert.equal(t.measure, 10);
  assert.equal(t.band?.id, 'B1');
  assert.equal(t.status, 'applied');
  assert.deepEqual(t.skipped, [{ index: 0, why: 'notListed' }]);
});
