// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { toCreatePayload, uploadCustomers, type PendingCustomer, type UploadDeps } from './upload-customers.ts';
import { ApiError, NetworkError } from './vk-nex-api.ts';

const shop = (name: string, over: Partial<PendingCustomer> = {}): PendingCustomer => ({
  cusId: `local-${name}`,
  cusName: name,
  cusGroupId: 'grp-1',
  cusAreaId: 'area-1',
  cusContactPerson: null,
  cusAddr1: null,
  cusAddr2: null,
  cusAddr3: null,
  cusLandmark: null,
  cusCity: 'Namakkal',
  cusDistrict: null,
  cusStateName: 'Tamil Nadu',
  cusStateCode: '33',
  cusPin: null,
  cusPhone1: '9843012345',
  cusPhone2: null,
  cusWhatsappNo: null,
  cusEmail: null,
  cusGstType: 'UNREGISTERED',
  cusGstNo: null,
  cusPanNo: null,
  cusAadharNo: null,
  cusPriceLevelId: null,
  ...over,
});

function fakeDeps(create: UploadDeps['create'], search: UploadDeps['search'] = async () => []) {
  const synced: [string, string, number][] = [];
  const refused: [string, string][] = [];
  const deps: UploadDeps = {
    create,
    search,
    markSynced: (localId, saved, pl) => synced.push([localId, saved.cusId, pl]),
    markRefused: (localId, error) => refused.push([localId, error]),
  };
  return { deps, synced, refused };
}

test('the payload is the SaveCustomerDto fields with a value, no cusId, plus the price level', () => {
  assert.deepEqual(toCreatePayload(shop('Kavin Stores'), 1), {
    cusPriceLevelId: 1,
    cusName: 'Kavin Stores',
    cusGroupId: 'grp-1',
    cusAreaId: 'area-1',
    cusCity: 'Namakkal',
    cusStateName: 'Tamil Nadu',
    cusStateCode: '33',
    cusPhone1: '9843012345',
    cusGstType: 'UNREGISTERED',
  });
  assert.equal(toCreatePayload(shop('A', { cusPriceLevelId: 3 }), 1).cusPriceLevelId, 1);
});

test('each customer is created and marked synced with the server id', async () => {
  let n = 0;
  const f = fakeDeps(async (p) => ({ cusId: `srv-${++n}`, cusCode: `C${n}`, cusName: String(p.cusName) }));
  const r = await uploadCustomers([shop('A'), shop('B', { cusPriceLevelId: 2 })], 1, f.deps);
  assert.equal(r.stoppedBy, undefined);
  assert.deepEqual(r.outcomes.map((o) => [o.status, o.serverId]), [['uploaded', 'srv-1'], ['uploaded', 'srv-2']]);
  assert.deepEqual(f.synced, [['local-A', 'srv-1', 1], ['local-B', 'srv-2', 2]]);
});

test('a refused customer keeps waiting with its reason; the next one still goes', async () => {
  const f = fakeDeps(async (p) => {
    if (p.cusName === 'A') throw new ApiError(400, 'Group not found', [{ field: 'cusGroupId', message: 'Group not found', code: 'CUSTOMER_UNKNOWN_GROUP' }]);
    return { cusId: 'srv-B', cusCode: 'C2', cusName: 'B' };
  });
  const r = await uploadCustomers([shop('A'), shop('B')], 1, f.deps);
  assert.deepEqual(r.outcomes.map((o) => o.status), ['refused', 'uploaded']);
  assert.deepEqual(f.refused, [['local-A', 'CUSTOMER_UNKNOWN_GROUP: Group not found']]);
  assert.deepEqual(f.synced, [['local-B', 'srv-B', 1]]);
});

test('a duplicate name that is really this shop (lost answer) is linked, not refused', async () => {
  const dup = new ApiError(409, 'Name already exists', [{ field: 'cusName', message: 'Name already exists', code: 'CUSTOMER_NAME_EXISTS' }]);
  const f = fakeDeps(
    async () => {
      throw dup;
    },
    async () => [
      { cusId: 'other', cusName: 'Kavin Stores', cusCode: 'C9', cusPhone1: '9000000000', cusGstNo: null },
      { cusId: 'srv-K', cusName: 'kavin stores', cusCode: 'C7', cusPhone1: '+91 98430 12345', cusGstNo: null },
    ],
  );
  const r = await uploadCustomers([shop('Kavin Stores')], 1, f.deps);
  assert.deepEqual(r.outcomes.map((o) => [o.status, o.serverId]), [['linked', 'srv-K']]);
  assert.deepEqual(f.refused, []);
});

test('a duplicate name of a different shop is refused', async () => {
  const f = fakeDeps(
    async () => {
      throw new ApiError(409, 'Name already exists', [{ field: 'cusName', message: 'Name already exists', code: 'CUSTOMER_NAME_EXISTS' }]);
    },
    async () => [{ cusId: 'other', cusName: 'Kavin Stores', cusCode: 'C9', cusPhone1: '9000000000', cusGstNo: null }],
  );
  const r = await uploadCustomers([shop('Kavin Stores')], 1, f.deps);
  assert.deepEqual(r.outcomes.map((o) => o.status), ['refused']);
  assert.match(f.refused[0]![1], /^CUSTOMER_NAME_EXISTS/);
});

test('no network, a server error or lost sign-in stops the run; the rest stay waiting', async () => {
  for (const err of [new NetworkError('timeout'), new ApiError(500, 'boom'), new ApiError(401, 'Invalid credentials'), new ApiError(403, 'No right')]) {
    let calls = 0;
    const f = fakeDeps(async () => {
      if (++calls === 2) throw err;
      return { cusId: 'srv-1', cusCode: 'C1', cusName: 'A' };
    });
    const r = await uploadCustomers([shop('A'), shop('B'), shop('C')], 1, f.deps);
    assert.equal(r.stoppedBy, err);
    assert.deepEqual(r.outcomes.map((o) => o.status), ['uploaded']);
    assert.equal(f.refused.length, 0);
  }
});

test('without any price level on VK Nex the customer is not sent', async () => {
  const f = fakeDeps(async () => {
    throw new Error('must not be called');
  });
  const r = await uploadCustomers([shop('A')], null, f.deps);
  assert.deepEqual(r.outcomes.map((o) => o.status), ['refused']);
  assert.match(f.refused[0]![1], /^NO_PRICE_LEVEL/);
});
