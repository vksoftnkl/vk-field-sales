// Run with: npm test
import assert from 'node:assert/strict';
import { randomBytes, scryptSync } from 'node:crypto';
import { test } from 'node:test';

import { hashPassword, verifyPassword } from './password.ts';

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

test('a hash made on the phone is in VK Nex format and checks the same password', async () => {
  const stored = await hashPassword('Ravi@123');
  assert.match(stored, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  assert.equal(await verifyPassword('Ravi@123', stored), true);
  assert.equal(await verifyPassword('ravi@123', stored), false);
});

test('a hash made on the phone is what Node (VK Nex) makes for the same salt', async () => {
  const stored = await hashPassword('ரவி2026');
  const [, salt, hash] = stored.split('$');
  assert.equal(scryptSync('ரவி2026', salt!, 64).toString('hex'), hash);
});

test('each hash gets its own salt', async () => {
  assert.notEqual(await hashPassword('1111'), await hashPassword('1111'));
});
