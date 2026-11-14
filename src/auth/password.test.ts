// Run with: npm test
import assert from 'node:assert/strict';
import { randomBytes, scryptSync } from 'node:crypto';
import { test } from 'node:test';

import { verifyPassword } from './password.ts';

/** Exactly what VK Nex users.service.ts → hashPassword() stores. */
function vkNexHash(plain: string): string {
  const salt = randomBytes(16).toString('hex');
  return `scrypt$${salt}$${scryptSync(plain, salt, 64).toString('hex')}`;
}

test('accepts the right password for a VK Nex hash', async () => {
  assert.equal(await verifyPassword('Ravi@123', vkNexHash('Ravi@123')), true);
});

test('accepts non-ASCII (Tamil) passwords the same way Node does', async () => {
  assert.equal(await verifyPassword('ரவி2026', vkNexHash('ரவி2026')), true);
});

test('rejects a wrong password', async () => {
  const stored = vkNexHash('Ravi@123');
  assert.equal(await verifyPassword('ravi@123', stored), false);
  assert.equal(await verifyPassword('', stored), false);
});

test('rejects malformed or foreign hashes without throwing', async () => {
  for (const bad of ['', 'plain', 'bcrypt$x$abcd', 'scrypt$$abcd', 'scrypt$salt$', 'scrypt$salt$xyz', 'scrypt$salt$abc']) {
    assert.equal(await verifyPassword('x', bad), false, bad);
  }
});
