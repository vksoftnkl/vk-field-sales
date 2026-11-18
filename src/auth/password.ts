// Pure TypeScript (no React Native imports) so `npm test` can run it in Node.
import { scryptAsync } from '@noble/hashes/scrypt.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

/**
 * Passwords on the phone, in VK Nex's format.
 *
 * VK Nex (users.service.ts → hashPassword) stores `scrypt$<salt>$<hash-hex>` made with
 * Node's crypto.scrypt defaults (N=16384, r=8, p=1) and a 64-byte key. The salt is used
 * as its hex TEXT, not decoded to bytes — Node and noble both UTF-8-encode string input,
 * so passing the same string here gives the same key.
 */
const NODE_SCRYPT_DEFAULTS = { N: 16384, r: 8, p: 1 } as const;
const KEY_LENGTH = 64;
const SALT_BYTES = 16;

/**
 * Random bytes for a salt: the platform's crypto RNG where there is one, else Math.random.
 * A salt only has to be different for each hash, not secret, so the fallback is enough.
 */
function saltBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  const rng = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (typeof rng?.getRandomValues === 'function') return rng.getRandomValues(out);
  for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
  return out;
}

/**
 * Hashes a password VK Nex has just accepted, so the next login on this phone can be checked
 * without the server. Same format as VK Nex's own hashes (a fresh salt, never the server's hash).
 */
export async function hashPassword(plain: string, random: (n: number) => Uint8Array = saltBytes): Promise<string> {
  const salt = bytesToHex(random(SALT_BYTES));
  const key = await scryptAsync(plain, salt, { ...NODE_SCRYPT_DEFAULTS, dkLen: KEY_LENGTH, asyncTick: 10 });
  return `scrypt$${salt}$${bytesToHex(key)}`;
}

/** Checks a password against a hash in that format, offline. False for an empty or malformed hash. */
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
