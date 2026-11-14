import { getRandomBytes } from 'expo-crypto';

const hex = (b: number) => b.toString(16).padStart(2, '0');

/**
 * UUIDv7 (RFC 9562): 48-bit ms timestamp + random. Time-ordered, so it indexes well
 * in both SQLite and PostgreSQL, and matches VK Nex's uuidv7() primary keys.
 */
export function uuidv7(now: number = Date.now()): string {
  const bytes = getRandomBytes(16);
  // 48-bit big-endian timestamp
  let ts = now;
  for (let i = 5; i >= 0; i--) {
    bytes[i] = ts % 256;
    ts = Math.floor(ts / 256);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x70; // version 7
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant 10xx
  const h = Array.from(bytes, hex).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
