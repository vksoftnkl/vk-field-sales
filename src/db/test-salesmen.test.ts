// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { verifyPassword } from '../auth/password.ts';
import { TEST_SALESMEN } from './test-salesmen.ts';

const PASSWORDS: Record<string, string> = { 'test-karthik': '1111', 'test-murugan': '2222', 'test-priya': '3333' };

test('each test salesman logs in with the password listed in test-salesmen.ts', async () => {
  for (const u of TEST_SALESMEN) {
    assert.equal(await verifyPassword(PASSWORDS[u.id]!, u.passwordHash), true, u.displayName);
  }
});

test("a test salesman's password does not open another salesman", async () => {
  const [karthik, murugan] = TEST_SALESMEN;
  assert.equal(await verifyPassword('1111', murugan.passwordHash), false);
  assert.equal(await verifyPassword('2222', karthik.passwordHash), false);
});
