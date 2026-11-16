// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { uuidv7 } from './uuid.ts';

test('uuidv7 has the RFC 9562 shape, version 7 and variant bits', () => {
  const id = uuidv7();
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('the first 48 bits are the timestamp, so ids sort by time', () => {
  const t = Date.UTC(2026, 10, 16, 10, 30);
  assert.equal(uuidv7(t).replace(/-/g, '').slice(0, 12), t.toString(16).padStart(12, '0'));
  assert.ok(uuidv7(t) < uuidv7(t + 1));
});

test('ids made in the same millisecond still differ', () => {
  const t = Date.now();
  const ids = new Set(Array.from({ length: 1000 }, () => uuidv7(t)));
  assert.equal(ids.size, 1000);
});
