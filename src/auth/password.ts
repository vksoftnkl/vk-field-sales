// Pure TypeScript (no React Native imports) so `npm test` can run it in Node.
import { scryptAsync } from '@noble/hashes/scrypt.js';
import { hexToBytes } from '@noble/hashes/utils.js';

/**
 * Checks a password against a VK Nex hash, offline, on the phone.
 *
 * VK Nex (users.service.ts → hashPassword) stores `scrypt$<salt>$<hash-hex>` made with
 * Node's crypto.scrypt defaults (N=16384, r=8, p=1) and a 64-byte key. The salt is used
 * as its hex TEXT, not decoded to bytes — Node and noble both UTF-8-encode string input,
 * so passing the same string here gives the same key.
 */
const NODE_SCRYPT_DEFAULTS = { N: 16384, r: 8, p: 1 } as const;

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const [algorithm, salt, hashHex] = stored.split('$');
  if (algorithm !== 'scrypt' || !salt || !hashHex || !/^(?:[0-9a-f]{2})+$/i.test(hashHex)) return false;

  const expected = hexToBytes(hashHex);
  // asyncTick: yield to the UI every 10 ms so the login spinner keeps turning.
  const actual = await scryptAsync(plain, salt, { ...NODE_SCRYPT_DEFAULTS, dkLen: expected.length, asyncTick: 10 });
  return constantTimeEqual(actual, expected);
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}
