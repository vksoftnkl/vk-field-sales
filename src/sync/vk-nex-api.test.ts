// Run with: npm test — a fake VK Nex answers with the real response shapes.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createVkNexClient, isApiError, isNetworkError, readTokenClaims } from './vk-nex-api.ts';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}

function fakeServer(handler: (c: Call) => { status: number; body: unknown }) {
  const calls: Call[] = [];
  const fetch = async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
    const call = { url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined };
    calls.push(call);
    const r = handler(call);
    return { ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => JSON.stringify(r.body) };
  };
  return { calls, fetch };
}

const base = 'http://192.168.1.10:3012/api/v1';
const creds = () => ({ loginName: 'karthik', password: '1111' });

test('signs in with the salesman, then sends the token and the mobile headers', async () => {
  const s = fakeServer((c) =>
    c.url.endsWith('/auth/login')
      ? { status: 200, body: { access_token: 'tok-1' } }
      : { status: 201, body: { success: true, data: { cusId: 'srv-1', cusCode: 'C0101', cusName: 'Kavin Stores' } } },
  );
  const api = createVkNexClient({ baseUrl: base, appVersion: '1.0.0', credentials: creds, fetch: s.fetch });
  const saved = await api.createCustomer({ cusName: 'Kavin Stores' });
  assert.deepEqual(saved, { cusId: 'srv-1', cusCode: 'C0101', cusName: 'Kavin Stores' });
  assert.equal(s.calls[0]!.url, `${base}/auth/login`);
  assert.deepEqual(s.calls[0]!.body, { usrLoginName: 'karthik', usrPassword: '1111', app_version: '1.0.0', device_type: 'Mobile' });
  assert.equal(s.calls[0]!.headers.Authorization, undefined);
  assert.equal(s.calls[1]!.url, `${base}/mobile/customers/create`);
  assert.equal(s.calls[1]!.headers.Authorization, 'Bearer tok-1');
  assert.equal(s.calls[1]!.headers['X-App-Platform'], 'mobile');
});

test('a token that ran out is renewed once and the request repeated', async () => {
  let logins = 0;
  const s = fakeServer((c) => {
    if (c.url.endsWith('/auth/login')) return { status: 200, body: { access_token: `tok-${++logins}` } };
    return c.headers.Authorization === 'Bearer tok-1'
      ? { status: 401, body: { message: 'Token expired', errors: [{ field: '', message: 'Token expired', code: 'AUTH_TOKEN_EXPIRED' }] } }
      : { status: 200, body: { success: true, data: { areas: [], groups: [], priceLevels: [{ id: 1, name: 'Retail' }], states: [], gstTypes: [] } } };
  });
  const api = createVkNexClient({ baseUrl: base, appVersion: '1.0.0', credentials: creds, fetch: s.fetch });
  const o = await api.customerOptions();
  assert.deepEqual(o.priceLevels, [{ id: 1, name: 'Retail' }]);
  assert.equal(logins, 2);
});

test('VK Nex refusals become ApiError with the first code', async () => {
  const s = fakeServer((c) =>
    c.url.endsWith('/auth/login')
      ? { status: 200, body: { access_token: 't' } }
      : {
          status: 409,
          body: { success: false, message: 'Validation failed', errors: [{ field: 'cusName', message: 'Name already exists', code: 'CUSTOMER_NAME_EXISTS' }] },
        },
  );
  const api = createVkNexClient({ baseUrl: base, appVersion: '1.0.0', credentials: creds, fetch: s.fetch });
  await assert.rejects(api.createCustomer({}), (e: unknown) => isApiError(e) && e.status === 409 && e.code === 'CUSTOMER_NAME_EXISTS' && e.message === 'Name already exists');
});

test('a wrong password is a 401 from sign-in; no server at all is a NetworkError', async () => {
  const wrong = fakeServer(() => ({ status: 401, body: { statusCode: 401, message: 'Invalid credentials' } }));
  const api = createVkNexClient({ baseUrl: base, appVersion: '1.0.0', credentials: creds, fetch: wrong.fetch });
  await assert.rejects(api.login(), (e: unknown) => isApiError(e) && e.status === 401 && e.message === 'Invalid credentials');

  const down = createVkNexClient({
    baseUrl: base,
    appVersion: '1.0.0',
    credentials: creds,
    fetch: async () => {
      throw new TypeError('Network request failed');
    },
  });
  await assert.rejects(down.health(), (e: unknown) => isNetworkError(e));
});

test('the download asks for pages of 200 and one customer by id', async () => {
  const s = fakeServer((c) =>
    c.url.endsWith('/auth/login')
      ? { status: 200, body: { access_token: 't' } }
      : c.url.includes('/mobile/customers/list')
        ? { status: 200, body: { success: true, data: { items: [{ cusId: 'a' }], hasMore: false, total: 1, page: 2, pageSize: 200 } } }
        : { status: 200, body: { success: true, data: { cusId: 'a', cusName: 'Kavin Stores' } } },
  );
  const api = createVkNexClient({ baseUrl: base, appVersion: '1.0.0', credentials: creds, fetch: s.fetch });
  const page = await api.customerListPage(2);
  assert.deepEqual(page.items, [{ cusId: 'a' }]);
  assert.equal(page.hasMore, false);
  assert.equal(s.calls[1]!.url, `${base}/mobile/customers/list?page=2&pageSize=200`);
  const one = await api.getCustomer('a');
  assert.equal(one.cusName, 'Kavin Stores');
  assert.equal(s.calls[2]!.url, `${base}/mobile/customers/get?cusId=a`);
  assert.equal(s.calls[2]!.headers.Authorization, 'Bearer t');
});

// A VK Nex access token's shape: header.claims.signature, base64url (the phone only reads the claims).
const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (claims: unknown) => `${b64url({ alg: 'HS256' })}.${b64url(claims)}.sig`;

test("the login company is read from VK Nex's token", async () => {
  assert.deepEqual(readTokenClaims(jwt({ sub: 'u1', company_id: 'comp-1', user_name: 'வேல்' })), { sub: 'u1', company_id: 'comp-1', user_name: 'வேல்' });
  assert.deepEqual(readTokenClaims('not-a-jwt'), {});
  assert.deepEqual(readTokenClaims('a.%%%.c'), {});
  const s = fakeServer(() => ({ status: 200, body: { access_token: jwt({ sub: 'u1', company_id: 'comp-1' }) } }));
  const api = createVkNexClient({ baseUrl: base, appVersion: '1.0.0', credentials: creds, fetch: s.fetch });
  assert.equal(api.companyId(), null);
  await api.login();
  assert.equal(api.companyId(), 'comp-1');
});

test('sign-in says which VK Nex user it was: usrId and login name as VK Nex spells it', async () => {
  const s = fakeServer(() => ({ status: 200, body: { access_token: jwt({ sub: 'u-from-token' }), usrId: 'u-7', user_name: 'Karthik' } }));
  const api = createVkNexClient({ baseUrl: base, appVersion: '1.0.0', credentials: creds, fetch: s.fetch });
  assert.deepEqual(await api.login(), { usrId: 'u-7', loginName: 'Karthik' });
});

test("sign-in without usrId falls back to the token's sub, then to nothing", async () => {
  const withSub = fakeServer(() => ({ status: 200, body: { access_token: jwt({ sub: 'u-9' }) } }));
  const a = createVkNexClient({ baseUrl: base, appVersion: '1.0.0', credentials: creds, fetch: withSub.fetch });
  assert.deepEqual(await a.login(), { usrId: 'u-9', loginName: 'karthik' });
  const bare = fakeServer(() => ({ status: 200, body: { access_token: 'tok' } }));
  const b = createVkNexClient({ baseUrl: base, appVersion: '1.0.0', credentials: creds, fetch: bare.fetch });
  assert.deepEqual(await b.login(), { usrId: null, loginName: 'karthik' });
});

test('ledger pages, fiscal years and customer updates go to their VK Nex routes', async () => {
  const s = fakeServer((c) => {
    if (c.url.endsWith('/auth/login')) return { status: 200, body: { access_token: 'tok' } };
    if (c.url.includes('/fiscal-years/')) return { status: 200, body: { success: true, data: [{ id: 'fy', name: '2026-2027', beginDate: '2026-04-01', endDate: '2027-03-31', status: 'OPEN', isCurrent: true }] } };
    if (c.url.includes('/ledger-statement/')) return { status: 200, body: { success: true, data: { broughtForward: { amount: '0.00', side: 'DR' }, rows: [], carriedForward: { amount: '0.00', side: 'DR' }, page: { page: 1, pageSize: 1000, totalRows: 0 } } } };
    return { status: 200, body: { success: true, data: { cusId: 'c1', cusCode: 'C1', cusName: 'A' } } };
  });
  const api = createVkNexClient({ baseUrl: base, appVersion: '1.0.0', credentials: creds, fetch: s.fetch });
  const years = await api.fiscalYears('comp-1');
  assert.equal(years[0]!.name, '2026-2027');
  await api.ledgerPage({ companyId: 'comp-1', accYear: '2026-2027', ledgerId: 'c1', fromDate: '2026-04-01', toDate: '2026-11-16', page: 1, pageSize: 1000 });
  await api.updateCustomer({ cusId: 'c1', cusPhone1: '9843012345' });
  assert.equal(s.calls[1]!.url, `${base}/master-lookups/fiscal-years/by-company/comp-1`);
  assert.equal(
    s.calls[2]!.url,
    `${base}/reports/ledger-statement/vouchers?companyId=comp-1&accYear=2026-2027&ledgerId=c1&fromDate=2026-04-01&toDate=2026-11-16&page=1&pageSize=1000`,
  );
  assert.equal(s.calls[3]!.method, 'PUT');
  assert.equal(s.calls[3]!.url, `${base}/mobile/customers/update`);
  assert.deepEqual(s.calls[3]!.body, { cusId: 'c1', cusPhone1: '9843012345' });
});

test('the device uid goes to sign-in; VK Nex saying which device it matched marks the phone registered', async () => {
  const s = fakeServer((c) =>
    c.url.endsWith('/auth/login')
      ? { status: 200, body: { access_token: 't', device_id: 'dev-9' } }
      : { status: 200, body: { success: true, data: { items: [], total: 0, hasMore: false, branchId: 'br-1' } } },
  );
  const api = createVkNexClient({ baseUrl: base, appVersion: '1.0.0', credentials: creds, fetch: s.fetch, deviceUid: 'VKSMAN-0123456789AB' });
  assert.equal(api.deviceRegistered(), false);
  await api.login();
  assert.equal((s.calls[0]!.body as Record<string, unknown>).device_id, 'VKSMAN-0123456789AB');
  assert.equal(api.deviceRegistered(), true);
  await api.itemListPage('comp-1', 2);
  assert.equal(s.calls[1]!.url, `${base}/mobile/items/list?companyId=comp-1&page=2&pageSize=500&deviceUid=VKSMAN-0123456789AB`);
});

test('a phone VK Nex does not know lists items without its uid (an unknown uid is a 403)', async () => {
  const s = fakeServer((c) =>
    c.url.endsWith('/auth/login')
      ? { status: 200, body: { access_token: 't', device_id: null } }
      : { status: 200, body: { success: true, data: { items: [], total: 0, hasMore: false, branchId: null } } },
  );
  const api = createVkNexClient({ baseUrl: base, appVersion: '1.0.0', credentials: creds, fetch: s.fetch, deviceUid: 'VKSMAN-0123456789AB' });
  await api.itemListPage('comp-1', 1);
  assert.equal(api.deviceRegistered(), false);
  assert.equal(s.calls[1]!.url, `${base}/mobile/items/list?companyId=comp-1&page=1&pageSize=500`);
});

test('orders and visits carry the device uid in the body', async () => {
  const s = fakeServer((c) => {
    if (c.url.endsWith('/auth/login')) return { status: 200, body: { access_token: 't', device_id: 'dev-9' } };
    if (c.url.endsWith('/mobile/orders/create')) {
      return {
        status: 201,
        body: { success: true, data: { soId: 'so-1', soOrderRefno: 'sor00042', soStatus: 'DRAFT', soAccYear: '2026-2027', duplicate: false, soIsDeleted: false } },
      };
    }
    return { status: 201, body: { success: true, data: { cvId: 'cv-1', cvClientUuid: 'v-1', cvVisitAt: '2026-11-16T05:10:02.000Z', duplicate: true } } };
  });
  const api = createVkNexClient({ baseUrl: base, appVersion: '1.0.0', credentials: creds, fetch: s.fetch, deviceUid: 'VKSMAN-0123456789AB' });
  const o = await api.createOrder({ soClientUuid: 'o-1' });
  assert.equal(o.soOrderRefno, 'sor00042');
  assert.deepEqual(s.calls[1]!.body, { soClientUuid: 'o-1', deviceUid: 'VKSMAN-0123456789AB' });
  const v = await api.createVisit({ cvClientUuid: 'v-1' });
  assert.equal(v.duplicate, true);
  assert.deepEqual(s.calls[2]!.body, { cvClientUuid: 'v-1', deviceUid: 'VKSMAN-0123456789AB' });
});
