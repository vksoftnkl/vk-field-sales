// Run with: npm test — a fake VK Nex answers with the real response shapes.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createVkNexClient, isApiError, isNetworkError } from './vk-nex-api.ts';

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

const base = 'http://192.168.1.10:3011/api/v1';
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
