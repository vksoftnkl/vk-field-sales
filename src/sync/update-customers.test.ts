// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { toUpdatePayload, updateCustomers, type PendingEdit, type UpdateDeps } from './update-customers.ts';
import { ApiError, NetworkError } from './vk-nex-api.ts';

const edit = (cusId: string, extra: Partial<PendingEdit> = {}): PendingEdit => ({
  cusId,
  cusName: `Shop ${cusId}`,
  cusPhone1: '9843012345',
  cusPhone2: null,
  cusAadharNo: null,
  cusPanNo: 'ABCDE1234F',
  editedFields: ['cusPhone1', 'cusPhone2', 'cusAadharNo', 'cusPanNo'],
  ...extra,
});

// VK Nex's copy: the office moved the shop to another area after the phone's last Sync.
const server = {
  cusId: 'c1',
  cusName: 'Shop c1',
  cusStateName: 'Tamil Nadu',
  cusStateCode: '33',
  cusAreaId: 'area-new',
  cusGroupId: 'grp',
  cusPriceLevelId: 2,
  cusPhone1: '9000000000',
  cusCreditAmtLimit: 5000,
};

test("only the fields the salesman changed are sent; VK Nex's own values fill what it requires", () => {
  // The office changed Mobile 1 on VK Nex; the salesman changed only the PAN: Mobile 1 is not sent.
  assert.deepEqual(toUpdatePayload(edit('c1', { cusPhone1: '9111111111', editedFields: ['cusPanNo'] }), server), {
    cusId: 'c1',
    cusStateName: 'Tamil Nadu',
    cusStateCode: '33',
    cusAreaId: 'area-new',
    cusGroupId: 'grp',
    cusPriceLevelId: 2,
    cusPanNo: 'ABCDE1234F',
  });
});

test('a field the salesman cleared is sent as null', () => {
  assert.deepEqual(toUpdatePayload(edit('c1', { cusPhone2: '' }), server), {
    cusId: 'c1',
    cusStateName: 'Tamil Nadu',
    cusStateCode: '33',
    cusAreaId: 'area-new',
    cusGroupId: 'grp',
    cusPriceLevelId: 2,
    cusPhone1: '9843012345',
    cusPhone2: null,
    cusAadharNo: null,
    cusPanNo: 'ABCDE1234F',
  });
});

function deps(over: Partial<UpdateDeps> = {}) {
  const log: string[] = [];
  const d: UpdateDeps = {
    get: async (id) => ({ ...server, cusId: id }),
    update: async (p) => {
      log.push(`put ${String(p.cusId)}`);
      return { cusId: String(p.cusId), cusCode: 'C1', cusName: 'x' };
    },
    markUpdated: (e) => log.push(`done ${e.cusId}`),
    markRefused: (id, e) => log.push(`refused ${id} ${e}`),
    ...over,
  };
  return { d, log };
}

test('each edit is marked done as soon as VK Nex has it', async () => {
  const { d, log } = deps();
  const r = await updateCustomers([edit('c1'), edit('c2')], d);
  assert.deepEqual(log, ['put c1', 'done c1', 'put c2', 'done c2']);
  assert.deepEqual(r.outcomes.map((o) => o.status), ['updated', 'updated']);
});

test('a refusal is kept with its reason and the next edit still goes', async () => {
  const { d, log } = deps({
    update: async (p) => {
      if (p.cusId === 'c1') throw new ApiError(400, 'Invalid PAN', [{ field: 'cusPanNo', message: 'Invalid PAN', code: 'CUSTOMER_PAN_INVALID' }]);
      return { cusId: String(p.cusId), cusCode: null, cusName: null };
    },
  });
  const r = await updateCustomers([edit('c1'), edit('c2')], d);
  assert.deepEqual(log, ['refused c1 CUSTOMER_PAN_INVALID: Invalid PAN', 'done c2']);
  assert.equal(r.outcomes[0]!.error, 'CUSTOMER_PAN_INVALID: Invalid PAN');
  assert.equal(r.stoppedBy, undefined);
});

test('deleted on VK Nex (404 on the read) is a refusal of that one customer', async () => {
  const { d } = deps({
    get: async (id) => {
      if (id === 'c1') throw new ApiError(404, 'Customer not found', [{ message: 'Customer not found', code: 'CUSTOMER_NOT_FOUND' }]);
      return { ...server, cusId: id };
    },
  });
  const r = await updateCustomers([edit('c1'), edit('c2')], d);
  assert.deepEqual(r.outcomes.map((o) => o.status), ['refused', 'updated']);
});

test('no network stops the run; the rest stay waiting', async () => {
  const { d, log } = deps({
    get: async () => {
      throw new NetworkError('Network request failed');
    },
  });
  const r = await updateCustomers([edit('c1'), edit('c2')], d);
  assert.ok(r.stoppedBy instanceof NetworkError);
  assert.deepEqual(log, []);
});
