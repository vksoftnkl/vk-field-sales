// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { itemRowIn, schemeRow, slabRow } from '../schemes/scheme-fixtures.ts';
import { evaluateOrder, type ItemAttrs, type OrderFreeLine, type SchemeOrderInput } from '../schemes/scheme-order.ts';
import type { SoLine } from './order-draft.ts';
import { buildOrderRows, offersOnFromSaved, paidRows } from './order-rows.ts';

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
  taxId: 'tax5',
  hsnCode: '1234',
  loadPerUnit: '0',
  freightPerUnit: '0',
  mrp: null,
  minPrice: null,
  promo: true,
  ...over,
});

const chilli = soLine({ itemId: 'CHILLI', iucId: 'iuc-chilli', name: 'Chilli', unitName: 'PKT', qty: '6', price: '62.00' });
const biscuit = soLine({ itemId: 'BISC', iucId: 'iuc-bisc', name: 'Biscuit', qty: '24', price: '9.00', taxPerc: '18.000' });
const sambar = soLine({ itemId: 'SAMBAR', iucId: 'iuc-sambar', name: 'Sambar', unitName: 'PKT', qty: '12', price: '38.00' });
const oil = soLine({ itemId: 'OIL', iucId: 'iuc-oil', name: 'Oil', qty: '30', price: '142.00' });

const attrs: Record<string, ItemAttrs> = {
  CHILLI: { groupId: 'G', brandId: 'ANNAM', categoryId: null, sectionId: null, allowPromo: true },
  SAMBAR: { groupId: 'G', brandId: 'ANNAM', categoryId: null, sectionId: null, allowPromo: true },
  BISC: { groupId: 'G', brandId: 'ACME', categoryId: null, sectionId: null, allowPromo: true },
  OIL: { groupId: 'G', brandId: 'ACME', categoryId: null, sectionId: null, allowPromo: true },
};
const spice = schemeRow({
  prmId: 'SPICE',
  prmName: 'Spice slab',
  prmItemScope: 'LIST',
  items: [itemRowIn({ priKind: 'ITEM_BRAND', priScopeId: 'ANNAM', priMatchPriority: 3 })],
  slabs: [slabRow({ prsExceeds: '12', prsUpto: '23', prsDiscPerc: '3' }), slabRow({ prsId: 'b2', prsExceeds: '6', prsUpto: '11', prsDiscPerc: '2' })],
});
const buy10 = schemeRow({
  prmId: 'BISC10',
  prmName: 'Buy 10 get 1',
  prmPriority: 2,
  prmBenefit: 'FREE_ITEM',
  prmItemScope: 'LIST',
  items: [itemRowIn({ priKind: 'ITEM', priScopeId: 'BISC' })],
  slabs: [
    slabRow({
      prsExceeds: '10',
      prsIsRepeat: true,
      prsEach: '10',
      prsFreeItemId: 'BISC',
      prsFreeItemName: 'Biscuit',
      prsFreeUnitId: 'U-PCS',
      prsFreeUnitName: 'PCS',
      prsFreeQty: '1',
    }),
  ],
});

const input = (over: Partial<SchemeOrderInput> = {}): SchemeOrderInput => ({
  lines: [chilli, biscuit, sambar, oil],
  schemes: [spice, buy10],
  applyOffers: true,
  context: {
    companyId: 'C1',
    branchId: 'BR1',
    customerId: 'CUST1',
    custGroupId: null,
    areaId: null,
    cityId: null,
    priceLevelId: 1,
    date: '2026-11-19',
    time: '10:00:00',
    billType: 'CREDIT',
  },
  itemAttrs: attrs,
  unitIds: {},
  ...over,
});

let n = 0;
const newId = () => `id-${++n}`;
const found = (f: OrderFreeLine) => (f.freeItemId === 'BISC' ? { iucId: 'iuc-bisc', unitName: 'PCS', factor: '1' } : null);

const build = (over: Partial<SchemeOrderInput> = {}, resolveFree: Parameters<typeof buildOrderRows>[0]['resolveFree'] = found) => {
  const inp = input(over);
  const order = evaluateOrder(inp);
  return buildOrderRows({ soId: 'so-1', lines: inp.lines as SoLine[], order, itemAttrs: attrs, offersOn: inp.offersOn ?? {}, applyOffers: inp.applyOffers, resolveFree, newId });
};

test('Apply offers off: every paid line goes with soiIsPromo false, so the office bill gives no offer either', () => {
  const on = build();
  assert.ok(on.rows.some((r) => !r.soiIsFree && r.soiIsPromo), 'with offers on, lines that take offers say so');
  const off = build({ applyOffers: false });
  assert.ok(off.rows.every((r) => r.soiIsPromo === false));
  assert.equal(off.rows.filter((r) => r.soiIsFree).length, 0);
});

test('save: the free line is its own row right after the line that earned it, numbered in sequence', () => {
  const r = build();
  assert.deepEqual(
    r.rows.map((x) => [x.soiLineNo, x.soiItemId, x.soiIsFree]),
    [
      [1, 'CHILLI', false],
      [2, 'BISC', false],
      [3, 'BISC', true],
      [4, 'SAMBAR', false],
      [5, 'OIL', false],
    ],
  );
  const free = r.rows[2]!;
  assert.deepEqual(
    {
      rate: free.soiRate,
      qty: free.soiOrderQty,
      net: free.soiNetAmt,
      type: free.soiFreeType,
      id: free.soiSchemeId,
      name: free.soiSchemeName,
      promo: free.soiIsPromo,
      unit: free.soiItemUnitId,
      tax: free.soiTaxAmt,
      gross: free.soiGrossAmt,
    },
    { rate: '0.00', qty: '2', net: '0.00', type: 'SCHEME', id: 'BISC10', name: 'Buy 10 get 1', promo: false, unit: 'iuc-bisc', tax: '0.00', gross: '0.00' },
  );
  assert.equal(r.missingFree.length, 0);
});

test('save: a paid line carries the scheme fields and amounts that include the scheme', () => {
  const r = build();
  const c = r.rows[0]!;
  assert.deepEqual(
    {
      id: c.soiSchemeId,
      name: c.soiSchemeName,
      perc: c.soiSchDiscPerc,
      qty: c.soiSchDiscQty,
      amt: c.soiSchDiscAmt,
      bill: c.soiBillSchAmt,
      taxable: c.soiTaxableAmt,
      tax: c.soiTaxAmt,
      net: c.soiNetAmt,
      gross: c.soiGrossAmt,
      promo: c.soiIsPromo,
    },
    { id: 'SPICE', name: 'Spice slab', perc: '3', qty: '0', amt: '11.16', bill: '0.00', taxable: '360.84', tax: '18.04', net: '378.88', gross: '372.00', promo: true },
  );
  const biscuitRow = r.rows[1]!;
  assert.equal(biscuitRow.soiSchemeId, null, 'the biscuit line has no scheme of its own');
  assert.equal(biscuitRow.soiSchDiscAmt, null);
  assert.equal(biscuitRow.soiIsFree, false);
});

test('save: header sums come from the priced lines and count paid lines only', () => {
  const r = build();
  assert.equal(r.schDisc, '24.84');
  assert.equal(r.billSchDisc, '0.00');
  assert.equal(r.totals.items, 4);
  assert.equal(r.totals.qty, 72);
  assert.equal(r.totals.totalPaise, 557100);
  assert.equal(r.totals.taxablePaise, 527916);
});

test("save: the offers off writes plain lines, no scheme, no free line, today's totals", () => {
  const r = build({ applyOffers: false });
  assert.equal(r.rows.length, 4);
  assert.ok(r.rows.every((x) => x.soiSchemeId === null && !x.soiIsFree));
  assert.equal(r.schDisc, '0.00');
  assert.equal(r.totals.taxablePaise, 530400 - 0);
});

test('save: a line switched off writes soi_is_promo false and takes no offer', () => {
  const r = build({ offersOn: { SAMBAR: false } });
  const s = r.rows.find((x) => x.soiItemId === 'SAMBAR')!;
  assert.equal(s.soiIsPromo, false);
  assert.equal(s.soiSchemeId, null);
  assert.equal(r.rows[0]!.soiSchDiscPerc, '2', 'chilli alone: 6 PKT');
  assert.equal(r.rows.find((x) => x.soiItemId === 'CHILLI')!.soiIsPromo, true);
  const noShop = build({ lines: [{ ...chilli, promo: false }] });
  assert.equal(noShop.rows[0]!.soiIsPromo, false, 'the shop or the item does not allow offers');
});

test('save: a free line whose unit the company does not have is left out and reported; numbering has no gap', () => {
  const r = build({}, () => null);
  assert.deepEqual(
    r.rows.map((x) => x.soiLineNo),
    [1, 2, 3, 4],
  );
  assert.equal(r.missingFree.length, 1);
  assert.equal(r.missingFree[0]!.freeItemName, 'Biscuit');
});

test('save: a free line with no trigger line goes last', () => {
  const bill = schemeRow({
    prmId: 'BILLFREE',
    prmApplyOn: 'BILL_AMOUNT',
    prmBenefit: 'FREE_ITEM',
    slabs: [slabRow({ prsExceeds: '100', prsFreeItemId: 'BISC', prsFreeUnitId: 'U-PCS', prsFreeUnitName: 'PCS', prsFreeQty: '3' })],
  });
  const r = build({ schemes: [bill], lines: [chilli, oil] });
  assert.deepEqual(
    r.rows.map((x) => [x.soiItemId, x.soiIsFree]),
    [
      ['CHILLI', false],
      ['OIL', false],
      ['BISC', true],
    ],
  );
});

test('edit and repeat: only the paid lines of a saved order are taken', () => {
  const saved = [{ line: { soiId: 'a', soiIsFree: false } }, { line: { soiId: 'b', soiIsFree: true } }, { line: { soiId: 'c', soiIsFree: false } }];
  assert.deepEqual(
    paidRows(saved).map((r) => r.line.soiId),
    ['a', 'c'],
  );
});

test('edit: a paid line saved with offers off, where the shop and item allow them, comes back switched off', () => {
  assert.deepEqual(
    offersOnFromSaved([
      { itemId: 'a', savedPromo: false, allowed: true },
      { itemId: 'b', savedPromo: true, allowed: true },
      { itemId: 'c', savedPromo: false, allowed: false },
    ]),
    { a: false },
  );
});
