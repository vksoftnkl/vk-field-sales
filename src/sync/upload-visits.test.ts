// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  toVisitPayload,
  uploadVisits,
  VISIT_CUSTOMER_NOT_SENT,
  VISIT_NO_COMPANY,
  VISIT_NO_SALESMAN,
  salesmanFromMe,
  type PendingVisit,
  type Visit,
  type VisitUploadDeps,
} from './upload-visits.ts';
import { ApiError, type CreatedVisit } from './vk-nex-api.ts';

const visit = (id: string, over: Partial<Visit> = {}): Visit => ({
  id,
  companyId: 'comp-1',
  customerId: 'cus-1',
  userId: 'test-karthik',
  reason: 'shopClosed',
  remarks: null,
  latitude: 11.2189,
  longitude: 78.1674,
  accuracyM: 12.5,
  locatedAt: '2026-11-16T05:10:00.000Z',
  visitedAt: '2026-11-16T05:10:02.000Z',
  appPendingUpload: true,
  appSyncError: null,
  appServerId: null,
  appSyncedOn: null,
  ...over,
});

const pending = (v: Visit, over: Partial<PendingVisit> = {}): PendingVisit => ({ visit: v, customerName: 'Kavin Stores', customerPending: false, ...over });

function fakeDeps(create: VisitUploadDeps['create'], over: Partial<VisitUploadDeps> = {}) {
  const synced: [string, CreatedVisit][] = [];
  const refused: [string, string][] = [];
  const deps: VisitUploadDeps = {
    create,
    currentCompanyId: 'comp-now',
    salesmanOf: () => 'emp-1',
    markSynced: (id, c) => synced.push([id, c]),
    markRefused: (id, e) => refused.push([id, e]),
    ...over,
  };
  return { deps, synced, refused };
}

const ok = (id: string, duplicate = false): CreatedVisit => ({ cvId: `cv-${id}`, cvClientUuid: id, cvVisitAt: '2026-11-16T05:10:02.000Z', duplicate });

test('the payload is the sales.customer_visit row VK Nex takes', () => {
  assert.deepEqual(toVisitPayload(visit('v1', { remarks: '  back at 4  ' }), 'comp-1', 'emp-1'), {
    cvClientUuid: 'v1',
    cvCompanyId: 'comp-1',
    cvCustId: 'cus-1',
    cvSalesmanId: 'emp-1',
    cvVisitAt: '2026-11-16T05:10:02.000Z',
    cvReasonCode: 'shopClosed',
    cvRemarks: 'back at 4',
    cvLatitude: 11.2189,
    cvLongitude: 78.1674,
    cvGpsAccuracy: 12.5,
  });
});

test('half a position is not sent (VK Nex wants both or neither)', () => {
  const p = toVisitPayload(visit('v1', { longitude: null }), 'comp-1', 'emp-1');
  assert.equal('cvLatitude' in p, false);
  assert.equal('cvLongitude' in p, false);
  assert.equal('cvGpsAccuracy' in p, false);
});

test('visits are sent and marked; one saved before counts as sent', async () => {
  const f = fakeDeps(async (p) => ok(String(p.cvClientUuid), p.cvClientUuid === 'b'));
  const r = await uploadVisits([pending(visit('a')), pending(visit('b'))], f.deps);
  assert.deepEqual(
    r.outcomes.map((o) => o.status),
    ['uploaded', 'alreadySaved'],
  );
  assert.deepEqual(
    f.synced.map(([id, c]) => [id, c.cvId]),
    [
      ['a', 'cv-a'],
      ['b', 'cv-b'],
    ],
  );
});

test('a visit saved without a company takes the one chosen now', async () => {
  let sent: Record<string, unknown> = {};
  const f = fakeDeps(async (p) => {
    sent = p;
    return ok('a');
  });
  await uploadVisits([pending(visit('a', { companyId: null }))], f.deps);
  assert.equal(sent.cvCompanyId, 'comp-now');
});

test('visits wait, with the reason, when the customer, company or salesman is not known to VK Nex', async () => {
  let calls = 0;
  const create = async () => {
    calls++;
    return ok('x');
  };
  const a = fakeDeps(create);
  await uploadVisits([pending(visit('a'), { customerPending: true })], a.deps);
  const b = fakeDeps(create, { currentCompanyId: null });
  await uploadVisits([pending(visit('b', { companyId: null }))], b.deps);
  const c = fakeDeps(create, { salesmanOf: () => null });
  const r = await uploadVisits([pending(visit('c'))], c.deps);
  assert.equal(calls, 0);
  assert.deepEqual(a.refused, [['a', VISIT_CUSTOMER_NOT_SENT]]);
  assert.deepEqual(b.refused, [['b', VISIT_NO_COMPANY]]);
  assert.deepEqual(c.refused, [['c', VISIT_NO_SALESMAN]]);
  assert.equal(r.outcomes[0]!.status, 'waiting');
});

test('a refused visit is noted and the next is sent; a 403 stops the visits', async () => {
  const f = fakeDeps(async (p) => {
    if (p.cvClientUuid === 'a') throw new ApiError(404, 'Salesman not found', [{ message: 'No employee', code: 'MOBILE_VISIT_SALESMAN_NOT_FOUND' }]);
    return ok(String(p.cvClientUuid));
  });
  const r = await uploadVisits([pending(visit('a')), pending(visit('b'))], f.deps);
  assert.deepEqual(
    r.outcomes.map((o) => o.status),
    ['refused', 'uploaded'],
  );
  assert.deepEqual(f.refused, [['a', 'MOBILE_VISIT_SALESMAN_NOT_FOUND: Salesman not found']]);

  const blocked = fakeDeps(async () => {
    throw new ApiError(403, 'Phone blocked', [{ message: 'This phone is blocked.', code: 'MOBILE_DEVICE_BLOCKED' }]);
  });
  const r2 = await uploadVisits([pending(visit('a'))], blocked.deps);
  assert.equal(r2.refusedBy?.code, 'MOBILE_DEVICE_BLOCKED');
  assert.equal(blocked.refused.length, 0);
});

test("a visit's salesman is the employee VK Nex links to the login that saved it (/mobile/me)", () => {
  const me = JSON.stringify({ userId: 'usr-1', loginName: 'VIJAYM', employeeId: 'emp-9', employeeName: 'Vijay' });
  assert.equal(salesmanFromMe(me, 'usr-1'), 'emp-9');
  // Another login's visit (saved before a switch): not known for it.
  assert.equal(salesmanFromMe(me, 'usr-2'), null);
  // A login VK Nex links to no employee, no /mobile/me yet, or junk.
  assert.equal(salesmanFromMe(JSON.stringify({ userId: 'usr-1', employeeId: null }), 'usr-1'), null);
  assert.equal(salesmanFromMe(null, 'usr-1'), null);
  assert.equal(salesmanFromMe('{bad', 'usr-1'), null);
});
