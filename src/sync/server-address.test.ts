// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { apiBaseUrl, formatServerAddress, parseServerAddress } from './server-address.ts';

test('an IP alone gets the default port 3012', () => {
  assert.deepEqual(parseServerAddress(' 192.168.1.10 '), { host: '192.168.1.10', port: '3012' });
});

test('host:port and pasted URLs are understood', () => {
  assert.deepEqual(parseServerAddress('192.168.1.10:4000'), { host: '192.168.1.10', port: '4000' });
  assert.deepEqual(parseServerAddress('http://server-pc:3012/api/v1'), { host: 'server-pc', port: '3012' });
});

test('nothing usable gives null', () => {
  assert.equal(parseServerAddress(''), null);
  assert.equal(parseServerAddress('192.168.1.10:99999'), null);
  assert.equal(parseServerAddress('my server'), null);
});

test('base URL and display form', () => {
  const a = { host: '192.168.1.10', port: '3012' };
  assert.equal(apiBaseUrl(a), 'http://192.168.1.10:3012/api/v1');
  assert.equal(formatServerAddress(a), '192.168.1.10:3012');
});
