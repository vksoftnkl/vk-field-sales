// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { apiBaseUrl, formatServerAddress, parseServerAddress } from './server-address.ts';

test('an IP alone gets the default port 3012', () => {
  assert.deepEqual(parseServerAddress(' 192.168.1.10 '), { scheme: 'http', host: '192.168.1.10', port: '3012' });
});

test('host:port and pasted URLs are understood', () => {
  assert.deepEqual(parseServerAddress('192.168.1.10:4000'), { scheme: 'http', host: '192.168.1.10', port: '4000' });
  assert.deepEqual(parseServerAddress('http://server-pc:3012/api/v1'), { scheme: 'http', host: 'server-pc', port: '3012' });
});

test('https is kept, and gets VK Nex\'s HTTPS port 3011 when none is typed', () => {
  assert.deepEqual(parseServerAddress('https://192.168.0.106:3011/api/v1'), { scheme: 'https', host: '192.168.0.106', port: '3011' });
  assert.deepEqual(parseServerAddress(' HTTPS://192.168.0.106 '), { scheme: 'https', host: '192.168.0.106', port: '3011' });
  assert.deepEqual(parseServerAddress('https://erp.example.in:8443'), { scheme: 'https', host: 'erp.example.in', port: '8443' });
  assert.deepEqual(parseServerAddress('http://192.168.0.106'), { scheme: 'http', host: '192.168.0.106', port: '3012' });
});

test('port 3011 with no scheme typed is https (VK Nex answers only HTTPS there)', () => {
  assert.deepEqual(parseServerAddress('192.168.0.106:3011'), { scheme: 'https', host: '192.168.0.106', port: '3011' });
  // Typed explicitly, http stays http.
  assert.deepEqual(parseServerAddress('http://192.168.0.106:3011'), { scheme: 'http', host: '192.168.0.106', port: '3011' });
});

test('nothing usable gives null', () => {
  assert.equal(parseServerAddress(''), null);
  assert.equal(parseServerAddress('192.168.1.10:99999'), null);
  assert.equal(parseServerAddress('my server'), null);
  assert.equal(parseServerAddress('ftp://192.168.1.10'), null);
  assert.equal(parseServerAddress('https://'), null);
});

test('base URL and display form', () => {
  const a = { scheme: 'http', host: '192.168.1.10', port: '3012' } as const;
  assert.equal(apiBaseUrl(a), 'http://192.168.1.10:3012/api/v1');
  assert.equal(formatServerAddress(a), '192.168.1.10:3012');
  const b = { scheme: 'https', host: '192.168.0.106', port: '3011' } as const;
  assert.equal(apiBaseUrl(b), 'https://192.168.0.106:3011/api/v1');
  assert.equal(formatServerAddress(b), 'https://192.168.0.106:3011');
  // What the box shows reads back as the same address.
  assert.deepEqual(parseServerAddress(formatServerAddress(b)), b);
  assert.deepEqual(parseServerAddress(formatServerAddress(a)), a);
});
