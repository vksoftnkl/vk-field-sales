// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { SoLine } from '../orders/order-draft.ts';
import { soLineAmounts, soTotals } from '../orders/so-math.ts';
import { itemRowIn, partyRowIn, schemeRow, slabRow } from './scheme-fixtures.ts';
import { evaluateOrder, type ItemAttrs, type SchemeOrderInput } from './scheme-order.ts';
import type { SchemeInput } from './scheme-types.ts';

const soLine = (over: Partial<SoLine>): SoLine => ({
  itemId: 'X',
  iucId: 'iuc-x',
  name: 'Item',
  nameTa: null,
  unitName: 'PCS',
  factor: '1',
  qty: '1',
  price: '10.00',
  priceLevel: 1,
  discMode: 'perc',
  disc: '',
  taxPerc: '5.000',
  inclTax: false,
  taxId: null,
  hsnCode: null,
  loadPerUnit: '0',
  freightPerUnit: '0',
  mrp: null,
  minPrice: null,
  promo: true,
  ...over,
});

// --- the mockup's order (item_schemes_mobile_ui_mockup, screens 1 to 4) ---------------------------

const chilli = soLine({
  itemId: 'CHILLI',
  iucId: 'iuc-chilli',
  name: 'Chilli Powder 200 g',
  unitName: 'PKT',
  qty: '6',
  price: '62.00',
});
const biscuit = soLine({
  itemId: 'BISC',
  iucId: 'iuc-bisc',
  name: 'Glucose Biscuit 75 g',
  qty: '24',
  price: '9.00',
  taxPerc: '18.000',
});
const sambar = soLine({
  itemId: 'SAMBAR',
  iucId: 'iuc-sambar',
  name: 'Sambar Powder 100 g',
  unitName: 'PKT',
  qty: '12',
  price: '38.00',
});
const oil = soLine({
  itemId: 'OIL',
  iucId: 'iuc-oil',
  name: 'Sunflower Oil 1 L',
  qty: '30',
  price: '142.00',
});
const mockupLines = [chilli, biscuit, sambar, oil];

const attrs: Record<string, ItemAttrs> = {
  CHILLI: {
    groupId: 'SPICE',
    brandId: 'ANNAM',
    categoryId: null,
    sectionId: null,
    allowPromo: true,
  },
  SAMBAR: {
    groupId: 'SPICE',
    brandId: 'ANNAM',
    categoryId: null,
    sectionId: null,
    allowPromo: true,
  },
  BISC: {
    groupId: 'BISCUIT',
    brandId: 'ACME',
    categoryId: null,
    sectionId: null,
    allowPromo: true,
  },
  OIL: {
    groupId: 'OIL',
    brandId: 'ACME',
    categoryId: null,
    sectionId: null,
    allowPromo: true,
  },
  TEA: {
    groupId: 'TEA',
    brandId: 'ACME',
    categoryId: null,
    sectionId: null,
    allowPromo: true,
  },
};
const unitIds = {
  'iuc-chilli': 'U-PKT',
  'iuc-sambar': 'U-PKT',
  'iuc-bisc': 'U-PCS',
  'iuc-oil': 'U-PCS',
  'iuc-tea': 'U-PKT',
};

/** "₹100 off orders over ₹10,000": the whole order, stackable and first, so it counts every line. */
const orderOffer = schemeRow({
  prmId: 'ORDER100',
  prmCode: 'ORDER100',
  prmName: 'Order offer',
  prmPriority: 1,
  prmStackMode: 'STACKABLE',
  prmApplyOn: 'BILL_AMOUNT',
  prmBenefit: 'DISC_AMT',
  slabs: [slabRow({ prsExceeds: '10000', prsDiscAmt: '100' })],
});
/** "Spice powders slab": Annam items count together; 6-11 PKT 2%, 12-23 3%, 24+ 5%; Retail shops only. */
const spice = schemeRow({
  prmId: 'SPICE',
  prmCode: 'SPICE',
  prmName: 'Spice powders slab',
  prmPriority: 2,
  prmApplyOn: 'ITEM_QTY',
  prmBenefit: 'DISC_PERC',
  prmItemScope: 'LIST',
  prmCustScope: 'LIST',
  prmStartDate: '2026-11-15',
  prmEndDate: '2026-12-15',
  parties: [
    partyRowIn({
      prpKind: 'CUSTOMER_GROUP',
      prpScopeId: 'RETAIL',
      prpMatchPriority: 1,
    }),
  ],
  items: [
    itemRowIn({
      priKind: 'ITEM_BRAND',
      priScopeId: 'ANNAM',
      priMatchPriority: 3,
    }),
  ],
  slabs: [
    slabRow({ prsId: 'b1', prsExceeds: '6', prsUpto: '11', prsDiscPerc: '2' }),
    slabRow({ prsId: 'b2', prsExceeds: '12', prsUpto: '23', prsDiscPerc: '3' }),
    slabRow({ prsId: 'b3', prsExceeds: '24', prsUpto: null, prsDiscPerc: '5' }),
  ],
});
/** "Buy 10 get 1": every 10 PCS of the biscuit, one free; the ITEM row is for PCS only. */
const buy10 = schemeRow({
  prmId: 'BISC10',
  prmCode: 'BISCUIT10+1',
  prmName: 'Buy 10 get 1',
  prmPriority: 3,
  prmBenefit: 'FREE_ITEM',
  prmItemScope: 'LIST',
  prmStartDate: '2026-11-01',
  prmEndDate: '2026-11-30',
  items: [itemRowIn({ priKind: 'ITEM', priScopeId: 'BISC', priUnitId: 'U-PCS' })],
  slabs: [
    slabRow({
      prsExceeds: '10',
      prsIsRepeat: true,
      prsEach: '10',
      prsFreeItemId: 'BISC',
      prsFreeItemName: 'Glucose Biscuit 75 g',
      prsFreeUnitId: 'U-PCS',
      prsFreeUnitName: 'PCS',
      prsFreeQty: '1',
    }),
  ],
});
/** "₹5 off per PKT from 12 PKT" on the tea (not on this order). */
const tea5 = schemeRow({
  prmId: 'TEA5',
  prmCode: 'TEA5',
  prmName: 'Tea ₹5 off per PKT',
  prmPriority: 4,
  prmBenefit: 'DISC_AMT',
  prmItemScope: 'LIST',
  items: [itemRowIn({ priKind: 'ITEM', priScopeId: 'TEA', priUnitId: 'U-PKT' })],
  slabs: [slabRow({ prsExceeds: '12', prsDiscQty: '5' })],
});
const catalog: SchemeInput[] = [orderOffer, spice, buy10, tea5];

const baseInput = (over: Partial<SchemeOrderInput> = {}): SchemeOrderInput => ({
  lines: mockupLines,
  schemes: catalog,
  applyOffers: true,
  context: {
    companyId: 'C1',
    branchId: 'BR1',
    customerId: 'CUST1',
    custGroupId: 'RETAIL',
    areaId: 'AREA1',
    cityId: 'CITY1',
    priceLevelId: 1,
    date: '2026-11-19',
    time: '10:21:00',
    billType: 'CREDIT',
  },
  itemAttrs: attrs,
  unitIds,
  ...over,
});

test('the mockup sample: ₹5,304.00 gross, −₹24.84 scheme, ₹5,279.16 taxable, ₹292.04 GST, ₹5,571.00 total', () => {
  const o = evaluateOrder(baseInput());
  const t = soTotals(o.priced);
  assert.equal(t.grossPaise, 530400);
  assert.equal(t.schemeDiscPaise, 2484);
  assert.equal(o.schemeDiscPaise, 2484);
  assert.equal(t.billSchemeDiscPaise, 0);
  assert.equal(t.taxablePaise, 527916);
  assert.equal(t.cgstPaise, 14602);
  assert.equal(t.sgstPaise, 14602);
  assert.equal(t.taxPaise, 29204);
  assert.equal(t.roundOffPaise, -20);
  assert.equal(t.totalPaise, 557100);
  assert.equal(t.qty, 72);
});

test("the mockup sample: each line's scheme, the free line, the order-offer gap", () => {
  const o = evaluateOrder(baseInput());
  const nets = o.priced.map((l) => soLineAmounts(l).lineTotalPaise);
  assert.deepEqual(nets, [37888, 25488, 46444, 447300], 'Review: ₹378.88, ₹254.88, ₹464.44, ₹4,473.00');
  assert.equal(o.lines[0]!.schemeName, 'Spice powders slab');
  assert.deepEqual(
    {
      perc: o.lines[0]!.schDiscPerc,
      amt: o.lines[0]!.schDiscAmt,
      qty: o.lines[0]!.schDiscQty,
      bill: o.lines[0]!.billSchAmt,
      id: o.lines[0]!.schemeId,
    },
    { perc: '3', amt: '11.16', qty: '0', bill: '0.00', id: 'SPICE' },
  );
  assert.equal(o.lines[2]!.schDiscAmt, '13.68');
  assert.equal(o.lines[1]!.schemeId, null, 'the biscuit line carries no scheme: the free line does');
  assert.equal(o.lines[3]!.schemeId, null);
  assert.equal(o.freeLines.length, 1);
  assert.deepEqual(
    { ...o.freeLines[0]!, stockCheck: undefined },
    {
      freeItemId: 'BISC',
      freeUnitId: 'U-PCS',
      freeItemName: 'Glucose Biscuit 75 g',
      freeUnitName: 'PCS',
      qty: 2,
      qtyText: '2',
      schemeId: 'BISC10',
      schemeName: 'Buy 10 get 1',
      stockCheck: undefined,
      afterIndex: 1,
      afterItemId: 'BISC',
    },
  );
  assert.equal(o.freeQty, 2);
  assert.deepEqual(o.appliedNames, ['Spice powders slab', 'Buy 10 get 1']);
  const [offer] = o.orderOffers();
  assert.equal(offer!.applied, false);
  assert.equal(offer!.reason, 'noBand');
  assert.equal(offer!.unit, 'money');
  assert.equal(offer!.measure, 5304);
  assert.deepEqual(offer!.nextBand, { at: 10000, more: 4696 });
});

test('badges: LIST offers reaching an item, green when they give something now', () => {
  const o = evaluateOrder(baseInput());
  const b = o.badgesFor(['CHILLI', 'BISC', 'OIL', 'TEA']);
  assert.deepEqual(
    b.CHILLI!.map((x) => [x.code, x.applied]),
    [['SPICE', true]],
  );
  assert.deepEqual(
    b.BISC!.map((x) => [x.code, x.applied]),
    [['BISCUIT10+1', true]],
  );
  assert.deepEqual(b.OIL, [], 'a whole-order offer shows in the banner, not on rows');
  assert.deepEqual(
    b.TEA!.map((x) => [x.code, x.applied]),
    [['TEA5', false]],
    'named, but not on the order',
  );
});

test('unit rows: an offer for PKT shows on the PKT row only, applied when the PKT line earns it', () => {
  const rows = [
    { itemId: 'TEA', iucId: 'iuc-tea-case' },
    { itemId: 'TEA', iucId: 'iuc-tea' },
  ];
  // Not on the order: the PKT row shows the offer outlined; the CASE row (another unit) shows none.
  const none = evaluateOrder(baseInput()).unitBadges(rows);
  assert.deepEqual(none['iuc-tea-case'], []);
  assert.deepEqual(
    none['iuc-tea']!.map((x) => [x.code, x.applied]),
    [['TEA5', false]],
  );
  // Tea in two units on one order: 1 CASE and 13 PKT. Only the PKT line counts for TEA5.
  const inCase = soLine({ itemId: 'TEA', iucId: 'iuc-tea-case', unitName: 'CASE', qty: '1', price: '1200.00' });
  const inPkt = soLine({ itemId: 'TEA', iucId: 'iuc-tea', unitName: 'PKT', qty: '13', price: '100.00' });
  const o = evaluateOrder(baseInput({ lines: [inCase, inPkt], unitIds: { ...unitIds, 'iuc-tea-case': 'U-CASE' } }));
  const b = o.unitBadges(rows);
  assert.deepEqual(b['iuc-tea-case'], []);
  assert.deepEqual(
    b['iuc-tea']!.map((x) => [x.code, x.applied]),
    [['TEA5', true]],
  );
  // Explained from each line: the CASE line is another unit, the PKT line has it.
  assert.equal(o.explain('TEA', 'iuc-tea-case')[0]!.reason, 'unit');
  assert.equal(o.explain('TEA', 'iuc-tea')[0]!.reason, 'applied');
  assert.equal(o.lines[0]!.schemeId, null);
  assert.equal(o.lines[1]!.schDiscQty, '5');
});

test('explain: applied, the current band and the next one (18 PKT counted together)', () => {
  const [e] = evaluateOrder(baseInput()).explain('SAMBAR');
  assert.equal(e!.applied, true);
  assert.equal(e!.reason, 'applied');
  assert.equal(e!.measure, 18);
  assert.equal(e!.unit, 'qty');
  assert.deepEqual(e!.countedItemIds, ['CHILLI', 'SAMBAR']);
  assert.deepEqual(e!.nextBand, { at: 24, more: 6 });
  assert.deepEqual(
    e!.bands.map((x) => [x.exceeds, x.upto, x.current]),
    [
      [6, 11, false],
      [12, 23, true],
      [24, null, false],
    ],
  );
});

test('explain: a repeating free-item offer says how much more gives the next one free', () => {
  const [e] = evaluateOrder(baseInput()).explain('BISC');
  assert.equal(e!.payouts, 2);
  assert.deepEqual(e!.nextRepeat, { at: 30, more: 6 });
});

test('explain: not reached yet says the first band and how much more', () => {
  const o = evaluateOrder(baseInput({ lines: [{ ...chilli, qty: '4' }] }));
  const [e] = o.explain('CHILLI');
  assert.equal(e!.applied, false);
  assert.equal(e!.reason, 'noBand');
  assert.deepEqual(e!.nextBand, { at: 6, more: 2 });
  assert.equal(o.lines[0]!.schemeId, null);
});

test('explain: an item not on the order, a line in another unit, a salesman discount', () => {
  const o = evaluateOrder(baseInput());
  assert.equal(o.explain('TEA')[0]!.reason, 'notOnOrder');
  assert.deepEqual(o.explain('TEA')[0]!.nextBand, { at: 12, more: 12 });
  // The tea sold in CASE: the offer names PKT, so the line does not count.
  const tea = soLine({
    itemId: 'TEA',
    iucId: 'iuc-tea-case',
    unitName: 'CASE',
    qty: '13',
    price: '100.00',
  });
  const inCase = evaluateOrder(
    baseInput({
      lines: [tea],
      unitIds: { ...unitIds, 'iuc-tea-case': 'U-CASE' },
    }),
  );
  assert.equal(inCase.explain('TEA')[0]!.reason, 'unit');
  const inPkt = evaluateOrder(baseInput({ lines: [{ ...tea, iucId: 'iuc-tea' }] }));
  assert.equal(inPkt.explain('TEA')[0]!.reason, 'applied');
  assert.equal(inPkt.lines[0]!.schDiscQty, '5');
  assert.equal(inPkt.lines[0]!.schDiscAmt, '65.00');
  // Own discount stops the spice offer on that line.
  const own = evaluateOrder(baseInput({ lines: [chilli, { ...sambar, disc: '1' }] }));
  assert.equal(own.explain('SAMBAR')[0]!.reason, 'ownDiscount');
  assert.equal(own.lines[1]!.schemeId, null);
  assert.equal(own.lines[0]!.schDiscPerc, '2', 'the other Annam line alone: 6 PKT is the 2% band');
});

test('explain: the offer does not suit this shop', () => {
  const o = evaluateOrder(
    baseInput({
      context: { ...baseInput().context, custGroupId: 'WHOLESALE' },
    }),
  );
  assert.equal(o.explain('CHILLI')[0]!.reason, 'customer');
  assert.deepEqual(o.badgesFor(['CHILLI']).CHILLI, [], 'no badge for an offer this shop cannot have');
  assert.equal(o.lines[0]!.schemeId, null);
});

test('an inclusive item is measured ex-tax', () => {
  const incl = soLine({
    itemId: 'CHILLI',
    iucId: 'iuc-chilli',
    qty: '10',
    price: '105.00',
    inclTax: true,
  });
  const amount = schemeRow({
    prmId: 'AMT',
    prmCode: 'AMT',
    prmApplyOn: 'ITEM_AMOUNT',
    prmItemScope: 'LIST',
    items: [itemRowIn({ priKind: 'ITEM', priScopeId: 'CHILLI' })],
    slabs: [slabRow({ prsExceeds: '1000', prsDiscPerc: '10' })],
  });
  const o = evaluateOrder(baseInput({ lines: [incl], schemes: [amount] }));
  const [e] = o.explain('CHILLI');
  assert.equal(e!.measure, 1000, 'not 1,050');
  assert.equal(e!.applied, true);
  assert.equal(o.lines[0]!.schDiscAmt, '100.00');
  const a = soLineAmounts(o.priced[0]!);
  assert.deepEqual([a.taxablePaise, a.taxPaise], [90000, 4500]);
  // The typed rate (tax-inclusive) is what FIXED_PRICE compares with: 105 vs a fixed price of 100 is a drop.
  const fixed = schemeRow({
    prmId: 'FIX',
    prmCode: 'FIX',
    prmBenefit: 'FIXED_PRICE',
    slabs: [slabRow({ prsFixedPrice: '100' })],
  });
  assert.equal(evaluateOrder(baseInput({ lines: [incl], schemes: [fixed] })).lines[0]!.schDiscAmt, '50.00');
});

test('a free line of the same item is kept apart from its paid line', () => {
  const o = evaluateOrder(baseInput());
  assert.equal(o.freeLines[0]!.freeItemId, o.priced[1]!.itemId);
  assert.equal(o.priced.length, 4, "the order's lines stay four; the free line is not one of them");
  assert.equal(o.priced[1]!.qty, '24', 'the paid line is not touched');
  assert.equal(soTotals(o.priced).qty, 72);
});

test('the same draft gives the same result', () => {
  const strip = (o: ReturnType<typeof evaluateOrder>) => JSON.stringify([o.lines, o.freeLines, o.appliedNames, o.orderOffers(), o.explain('SAMBAR'), o.badgesFor(['CHILLI'])]);
  assert.equal(strip(evaluateOrder(baseInput())), strip(evaluateOrder(baseInput())));
});

test('a quantity down below a band takes the free line away', () => {
  const o = evaluateOrder(baseInput({ lines: [chilli, { ...biscuit, qty: '9' }, sambar, oil] }));
  assert.equal(o.freeLines.length, 0);
  assert.equal(evaluateOrder(baseInput({ lines: [chilli, { ...biscuit, qty: '10' }, sambar, oil] })).freeLines[0]!.qty, 1);
  assert.equal(evaluateOrder(baseInput({ lines: [chilli, { ...biscuit, qty: '30' }, sambar, oil] })).freeLines[0]!.qty, 3);
});

test("Apply offers off, and a line's own switch off", () => {
  const off = evaluateOrder(baseInput({ applyOffers: false }));
  assert.deepEqual(off.freeLines, []);
  assert.equal(off.schemeDiscPaise, 0);
  assert.ok(off.lines.every((l) => l.scheme === null && l.schemeId === null));
  assert.equal(soTotals(off.priced).totalPaise, soTotals(mockupLines).totalPaise, "today's math");
  assert.equal(off.explain('CHILLI')[0]!.reason, 'offersOff');
  assert.equal(off.orderOffers()[0]!.reason, 'offersOff');
  const lineOff = evaluateOrder(baseInput({ offersOn: { 'iuc-sambar': false } }));
  assert.equal(lineOff.lines[2]!.schemeId, null);
  assert.equal(lineOff.lines[0]!.schDiscPerc, '2', 'chilli alone is 6 PKT');
  assert.equal(lineOff.explain('SAMBAR')[0]!.reason, 'lineOff');
  const noPromo = evaluateOrder(baseInput({ lines: [chilli, { ...sambar, promo: false }] }));
  assert.equal(noPromo.lines[1]!.schemeId, null, 'the shop or the item does not take offers');
});

test('save fields: a free line, the header sums, and a line that carries no scheme', () => {
  const o = evaluateOrder(baseInput());
  assert.equal(o.schemeDiscPaise + o.billSchemeDiscPaise, 2484);
  assert.deepEqual(o.lines[3], {
    scheme: null,
    schemeId: null,
    schemeName: null,
    schDiscPerc: '0',
    schDiscQty: '0',
    schDiscAmt: '0.00',
    billSchPerc: '0',
    billSchAmt: '0.00',
    schemePaise: 0,
    billSchemePaise: 0,
  });
});

test('an ended or not-yet-started scheme does nothing', () => {
  for (const [date, why] of [
    ['2026-12-16', 'ended'],
    ['2026-10-31', 'notStarted'],
  ] as const) {
    const o = evaluateOrder(baseInput({ context: { ...baseInput().context, date } }));
    assert.equal(o.lines[0]!.schemeId, null);
    assert.equal(o.explain('CHILLI')[0]!.reason, why);
    assert.deepEqual(o.badgesFor(['CHILLI']).CHILLI, []);
  }
  assert.equal(evaluateOrder(baseInput({ context: { ...baseInput().context, date: '2026-12-15' } })).lines[0]!.schDiscPerc, '3', 'the end date itself still counts');
});

test('the order offer works with the item offers: the bill % is on the base before the item schemes, so it gives a little less than ₹100', () => {
  const big = { ...oil, qty: '80' }; // 11,360
  const o = evaluateOrder(baseInput({ lines: [chilli, biscuit, sambar, big] }));
  const [offer] = o.orderOffers();
  assert.equal(offer!.applied, true);
  assert.equal(o.schemeDiscPaise, 2484, 'the spice offer is unchanged');
  assert.ok(o.billSchemeDiscPaise > 9900 && o.billSchemeDiscPaise < 10000, `got ${o.billSchemeDiscPaise}`);
  assert.equal(soTotals(o.priced).billSchemeDiscPaise, o.billSchemeDiscPaise);
  assert.ok(o.lines[0]!.billSchPerc !== '0');
  assert.equal(o.lines[0]!.schemeName, 'Order offer + Spice powders slab');
  assert.equal(o.lines[0]!.schemeId, 'ORDER100');
});

test('lines without a quantity are not offered anything, and keep their place', () => {
  const o = evaluateOrder(baseInput({ lines: [{ ...chilli, qty: '' }, sambar] }));
  assert.equal(o.lines.length, 2);
  assert.equal(o.lines[0]!.schemeId, null);
  assert.equal(o.lines[1]!.schDiscPerc, '3', 'sambar alone (12 PKT) is the 3% band');
});
