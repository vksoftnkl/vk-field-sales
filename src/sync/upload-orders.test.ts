// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CUSTOMER_NOT_SENT,
  remarksWithVehicle,
  toOrderPayload,
  uploadOrders,
  type OrderHeader,
  type OrderLine,
  type OrderUploadDeps,
  type PendingOrder,
} from './upload-orders.ts';
import { ApiError, NetworkError, type CreatedOrder } from './vk-nex-api.ts';

const header = (id: string, over: Partial<OrderHeader> = {}): OrderHeader => ({
  soId: id,
  soCompanyId: 'comp-1',
  soPriceLevel: 1,
  soOrderDate: '2026-11-16',
  soOrderDatetime: '2026-11-16T05:12:00.000Z',
  soCustId: 'cus-1',
  soCustName: 'Kavin Stores',
  soHasLoad: false,
  soHasFreight: true,
  soUserId: 'test-karthik',
  soTotItems: 1,
  soTotBags: '2',
  soGrossAmt: '336.00',
  soItemDisc: '0.00',
  soFreightAmt: '10.00',
  soLoadAmt: '0.00',
  soOrderAmt: '346.00',
  soRemarks: null,
  soCreatedOn: '2026-11-16T05:12:00.000Z',
  soOrderRefno: null,
  soStatus: null,
  soAccYear: null,
  appVehicleNo: null,
  appPendingUpload: true,
  appSyncError: null,
  appServerSoId: null,
  appSyncedOn: null,
  soBranchId: null,
  soUsrRefno: null,
  soOrderType: null,
  soDeliveryDate: null,
  soPriority: null,
  soValidUntil: null,
  soHasPromo: null,
  soTaxableAmt: null,
  soCgstAmt: null,
  soSgstAmt: null,
  soIgstAmt: null,
  soTaxAmt: null,
  soRoundOff: null,
  soSchDisc: null,
  soBillSchDisc: null,
  appCheckinAt: null,
  appCheckinLat: null,
  appCheckinLng: null,
  appCheckinAccuracyM: null,
  ...over,
});

const line = (orderId: string, lineNo: number, over: Partial<OrderLine> = {}): OrderLine => ({
  soiId: `${orderId}-l${lineNo}`,
  soiOrderId: orderId,
  soiLineNo: lineNo,
  soiItemId: 'item-1',
  soiItemUnitId: 'iuc-1',
  soiPriceLevel: 1,
  soiIsPromo: false,
  soiOrderQty: '2',
  soiNetQty: '2',
  soiRate: '168.00',
  soiMaxPrice: '180.00',
  soiItemDiscPerc: '0',
  soiItemDiscQty: '0',
  soiItemDiscAmt: '0.00',
  soiGrossAmt: '336.00',
  soiFreightQty: '2',
  soiFreightAmt: '10.00',
  soiLoadQty: '0',
  soiLoadAmt: '0.00',
  soiNetAmt: '336.00',
  soiToBaseFactor: null,
  soiHsnCode: null,
  soiTaxId: null,
  soiIsTaxIncl: null,
  soiMinPrice: null,
  soiTaxableAmt: null,
  soiTaxPerc: null,
  soiTaxAmt: null,
  soiCgstPerc: null,
  soiCgstAmt: null,
  soiSgstPerc: null,
  soiSgstAmt: null,
  soiIgstPerc: null,
  soiIgstAmt: null,
  appItemName: null,
  appItemNameTa: null,
  appUnitName: null,
  soiIsFree: false,
  soiFreeType: null,
  soiSchemeId: null,
  soiSchemeName: null,
  soiSchDiscPerc: null,
  soiSchDiscQty: null,
  soiSchDiscAmt: null,
  soiBillSchPerc: null,
  soiBillSchAmt: null,
  appDiscMode: null,
  ...over,
});

const order = (id: string, over: Partial<PendingOrder> = {}): PendingOrder => ({
  header: header(id),
  lines: [line(id, 1)],
  customerPending: false,
  customerPriceLevelId: 2,
  ...over,
});

const created = (soId: string, over: Partial<CreatedOrder> = {}): CreatedOrder => ({
  soId,
  soOrderRefno: 'sor00042',
  soStatus: 'DRAFT',
  soAccYear: '2026-2027',
  duplicate: false,
  soIsDeleted: false,
  ...over,
});

function fakeDeps(create: OrderUploadDeps['create']) {
  const synced: [string, CreatedOrder][] = [];
  const refused: [string, string][] = [];
  const deps: OrderUploadDeps = {
    create,
    markSynced: (id, c) => synced.push([id, c]),
    markRefused: (id, e) => refused.push([id, e]),
  };
  return { deps, synced, refused };
}

test('the payload is the desktop order without server-filled keys; the phone id is soClientUuid', () => {
  const p = toOrderPayload(order('ord-1', { lines: [line('ord-1', 2, { soiItemId: 'item-2' }), line('ord-1', 1)] }));
  assert.equal(p.soClientUuid, 'ord-1');
  assert.equal(p.soCompanyId, 'comp-1');
  assert.equal(p.soPriceLevel, 1);
  assert.equal(p.soHasFreight, true);
  assert.equal(p.soHasLoad, false);
  assert.equal(p.soOrderAmt, '346.00');
  // soBranchId goes only when the order has one (see the branch test below).
  for (const k of ['soId', 'soAccYear', 'soDeviceId', 'soStatus', 'soOrderRefno', 'soUserId', 'soCreatedOn', 'soRemarks']) {
    assert.equal(k in p, false, `${k} must not be sent`);
  }
  const items = p.items as Record<string, unknown>[];
  assert.deepEqual(
    items.map((i) => i.soiLineNo),
    [1, 2],
  );
  assert.equal(items[0]!.soiItemUnitId, 'iuc-1');
  assert.equal(items[0]!.soiIsPromo, false);
  for (const k of ['soiId', 'soiOrderId']) assert.equal(k in items[0]!, false, `${k} must not be sent`);
});

test("an order saved without a price level takes the customer's", () => {
  const p = toOrderPayload(order('ord-1', { header: header('ord-1', { soPriceLevel: null }) }));
  assert.equal(p.soPriceLevel, 2);
});

test('the vehicle number rides in the remarks after ###, as in the Qt app', () => {
  assert.equal(remarksWithVehicle('Deliver by noon', 'TN28 AB 1234'), 'Deliver by noon###TN28 AB 1234');
  assert.equal(remarksWithVehicle(null, 'TN28'), '###TN28');
  assert.equal(remarksWithVehicle('  ', null), null);
  assert.equal(remarksWithVehicle('x'.repeat(600), null)!.length, 500);
  const p = toOrderPayload(order('o', { header: header('o', { soRemarks: 'Rush', appVehicleNo: 'TN28' }) }));
  assert.equal(p.soRemarks, 'Rush###TN28');
});

test('each order VK Nex takes is marked synced; a resend answered as duplicate counts as sent', async () => {
  const f = fakeDeps(async (p) => created(`srv-${String(p.soClientUuid)}`, { duplicate: p.soClientUuid === 'b' }));
  const r = await uploadOrders([order('a'), order('b')], f.deps);
  assert.equal(r.stoppedBy, undefined);
  assert.deepEqual(
    r.outcomes.map((o) => [o.localId, o.status, o.orderRefno]),
    [
      ['a', 'uploaded', 'sor00042'],
      ['b', 'alreadySaved', 'sor00042'],
    ],
  );
  assert.deepEqual(
    f.synced.map(([id, c]) => [id, c.soId]),
    [
      ['a', 'srv-a'],
      ['b', 'srv-b'],
    ],
  );
});

test('VK Nex confirms an order as it saves it; one it could not confirm is kept as a draft, with why', async () => {
  const f = fakeDeps(async (p) =>
    p.soClientUuid === 'a'
      ? created('srv-a', { soStatus: 'CONFIRMED', confirmRefused: null, warnings: [] })
      : created('srv-b', { soStatus: 'DRAFT', confirmRefused: { code: 'SALES_DAY_CLOSED', field: 'soOrderDate', message: 'The books for 2026-11-19 are closed at this branch' } }),
  );
  const r = await uploadOrders([order('a'), order('b')], f.deps);
  assert.deepEqual(
    r.outcomes.map((o) => [o.localId, o.status, o.orderStatus, o.keptDraft]),
    [
      ['a', 'uploaded', 'CONFIRMED', undefined],
      ['b', 'uploaded', 'DRAFT', 'SALES_DAY_CLOSED: The books for 2026-11-19 are closed at this branch'],
    ],
  );
  assert.deepEqual(
    f.synced.map(([id, c]) => [id, c.soStatus]),
    [
      ['a', 'CONFIRMED'],
      ['b', 'DRAFT'],
    ],
  );
});

test('an order for a shop not yet on VK Nex waits without a request', async () => {
  let calls = 0;
  const f = fakeDeps(async () => {
    calls++;
    return created('x');
  });
  const r = await uploadOrders([order('a', { customerPending: true })], f.deps);
  assert.equal(calls, 0);
  assert.equal(r.outcomes[0]!.status, 'waiting');
  assert.deepEqual(f.refused, [['a', CUSTOMER_NOT_SENT]]);
});

test('a refusal of one order is noted and the next one is sent', async () => {
  const f = fakeDeps(async (p) => {
    if (p.soClientUuid === 'a') {
      throw new ApiError(422, 'No financial year', [{ field: 'soOrderDate', message: 'No financial year', code: 'MOBILE_NO_FISCAL_YEAR' }]);
    }
    return created('srv-b');
  });
  const r = await uploadOrders([order('a'), order('b')], f.deps);
  assert.deepEqual(
    r.outcomes.map((o) => o.status),
    ['refused', 'uploaded'],
  );
  assert.deepEqual(f.refused, [['a', 'MOBILE_NO_FISCAL_YEAR: No financial year']]);
});

test('a 403 (phone not registered) stops the orders but is not a stop of the whole Sync', async () => {
  const f = fakeDeps(async () => {
    throw new ApiError(403, 'Phone not registered', [{ field: 'deviceUid', message: 'Add the phone', code: 'MOBILE_DEVICE_NOT_REGISTERED' }]);
  });
  const r = await uploadOrders([order('a'), order('b')], f.deps);
  assert.equal(r.refusedBy?.code, 'MOBILE_DEVICE_NOT_REGISTERED');
  assert.equal(r.stoppedBy, undefined);
  assert.equal(r.outcomes.length, 0);
  assert.equal(f.refused.length, 0, 'orders are not marked: they are fine, the phone is not');
});

test('no answer stops the run; the rest stay waiting', async () => {
  const f = fakeDeps(async () => {
    throw new NetworkError('timeout');
  });
  const r = await uploadOrders([order('a'), order('b')], f.deps);
  assert.ok(r.stoppedBy instanceof NetworkError);
  assert.equal(f.synced.length + f.refused.length, 0);
});

test('3b orders send delivery, priority, phone ref and the GST split; phone-only columns stay', () => {
  const o: PendingOrder = {
    header: header('so-3b', {
      soUsrRefno: '3F9A-181126-03',
      soOrderType: 'CREDIT',
      soDeliveryDate: '2026-11-19',
      soPriority: 'URGENT',
      soValidUntil: '2026-12-18',
      soHasPromo: false,
      soTaxableAmt: '320.00',
      soCgstAmt: '8.00',
      soSgstAmt: '8.00',
      soIgstAmt: '0.00',
      soTaxAmt: '16.00',
      soRoundOff: '0.00',
      appCheckinAt: '2026-11-18T05:12:00.000Z',
      appCheckinLat: 11.2,
    }),
    lines: [
      line('so-3b', 1, {
        soiTaxPerc: '5',
        soiTaxableAmt: '320.00',
        soiCgstPerc: '2.5',
        soiCgstAmt: '8.00',
        soiIsTaxIncl: false,
        soiToBaseFactor: '1',
        appItemName: 'Sunflower Oil',
        appDiscMode: 'perc',
      }),
    ],
    customerPending: false,
    customerPriceLevelId: 1,
  };
  const p = toOrderPayload(o);
  assert.equal(p.soUsrRefno, '3F9A-181126-03');
  assert.equal(p.soPriority, 'URGENT');
  assert.equal(p.soDeliveryDate, '2026-11-19');
  assert.equal(p.soOrderType, 'CREDIT');
  assert.equal(p.soHasPromo, false);
  assert.equal(p.soTaxAmt, '16.00');
  assert.equal('appCheckinAt' in p, false);
  const l = (p.items as Record<string, unknown>[])[0]!;
  assert.equal(l.soiTaxPerc, '5');
  assert.equal(l.soiCgstAmt, '8.00');
  assert.equal(l.soiIsTaxIncl, false);
  assert.equal('appItemName' in l, false);
  assert.equal('appDiscMode' in l, false);
  // Older orders: the new keys stay out, except priority (no flag = NORMAL) and the term (CREDIT).
  const old = toOrderPayload({ ...o, header: header('so-old'), lines: [line('so-old', 1)] });
  assert.equal(old.soPriority, 'NORMAL');
  assert.equal(old.soOrderType, 'CREDIT');
  assert.equal('soDeliveryDate' in old, false);
  assert.equal('soiTaxPerc' in (old.items as Record<string, unknown>[])[0]!, false);
});

test("each line sends its unit and factor; a line saved without a factor takes the unit's from Sync", () => {
  const box = (id: string) => line(id, 1, { soiItemUnitId: 'iuc-box', soiOrderQty: '5', soiNetQty: '5' });
  const now = toOrderPayload(order('so-u1', { lines: [{ ...box('so-u1'), soiToBaseFactor: '12' }], unitFactors: { 'iuc-box': '24' } }));
  const item = (p: Record<string, unknown>) => (p.items as Record<string, unknown>[])[0]!;
  // The factor saved with the line wins: it is the one the quantity was typed against.
  assert.deepEqual([item(now).soiItemUnitId, item(now).soiOrderQty, item(now).soiToBaseFactor], ['iuc-box', '5', '12']);
  const old = toOrderPayload(order('so-u2', { lines: [box('so-u2')], unitFactors: { 'iuc-box': '12.000000' } }));
  assert.equal(item(old).soiToBaseFactor, '12.000000');
  // A unit Sync no longer has: the key stays out, as before.
  const gone = toOrderPayload(order('so-u3', { lines: [box('so-u3')], unitFactors: {} }));
  assert.equal('soiToBaseFactor' in item(gone), false);
});

test('priority: each dropdown value goes as it is; the old urgent flag is URGENT', () => {
  for (const p of ['LOW', 'NORMAL', 'HIGH', 'URGENT']) {
    const body = toOrderPayload({ header: header(`so-${p}`, { soPriority: p }), lines: [line(`so-${p}`, 1)], customerPending: false, customerPriceLevelId: 1 });
    assert.equal(body.soPriority, p);
  }
  // Saved before the dropdown: the Urgent delivery switch wrote 'URGENT', off wrote 'NORMAL'.
  const urgent = toOrderPayload({ header: header('so-u', { soPriority: 'URGENT' }), lines: [line('so-u', 1)], customerPending: false, customerPriceLevelId: 1 });
  assert.equal(urgent.soPriority, 'URGENT');
});

test('the branch saved with the order is sent; older orders leave it out', () => {
  const withBranch = toOrderPayload({ header: header('so-br', { soBranchId: 'br-7' }), lines: [line('so-br', 1)], customerPending: false, customerPriceLevelId: 1 });
  assert.equal(withBranch.soBranchId, 'br-7');
  const old = toOrderPayload({ header: header('so-nobr'), lines: [line('so-nobr', 1)], customerPending: false, customerPriceLevelId: 1 });
  assert.equal('soBranchId' in old, false);
});

test('offers: a free line and a paid line send their scheme keys; lines without one leave them out', () => {
  const o: PendingOrder = {
    header: header('so-of', { soSchDisc: '24.84', soBillSchDisc: '0.00', soHasPromo: true }),
    lines: [
      line('so-of', 1, { soiSchemeId: 'prm-1', soiSchemeName: 'Spice slab', soiSchDiscPerc: '3', soiSchDiscAmt: '11.16' }),
      line('so-of', 2, { soiIsFree: true, soiFreeType: 'SCHEME', soiSchemeId: 'prm-2', soiSchemeName: 'Buy 10 get 1', soiRate: '0.00', soiIsPromo: false }),
      line('so-of', 3),
    ],
    customerPending: false,
    customerPriceLevelId: 1,
  };
  const p = toOrderPayload(o);
  assert.equal(p.soSchDisc, '24.84');
  const [paid, free, plain] = p.items as Record<string, unknown>[];
  assert.deepEqual([paid!.soiSchemeId, paid!.soiSchemeName, paid!.soiSchDiscPerc, paid!.soiSchDiscAmt], ['prm-1', 'Spice slab', '3', '11.16']);
  assert.equal('soiIsFree' in paid!, false);
  assert.deepEqual([free!.soiIsFree, free!.soiFreeType, free!.soiSchemeId, free!.soiRate, free!.soiIsPromo], [true, 'SCHEME', 'prm-2', '0.00', false]);
  for (const k of ['soiIsFree', 'soiFreeType', 'soiSchemeId', 'soiSchemeName', 'soiSchDiscPerc', 'soiBillSchPerc']) assert.equal(k in plain!, false, k);
  const old = toOrderPayload({ ...o, header: header('so-old2'), lines: [line('so-old2', 1)] });
  assert.equal('soSchDisc' in old, false);
});

test('a term saved on the order is sent as it is', () => {
  const cash = toOrderPayload({ header: header('so-cash', { soOrderType: 'CASH' }), lines: [line('so-cash', 1)], customerPending: false, customerPriceLevelId: 1 });
  assert.equal(cash.soOrderType, 'CASH');
});
