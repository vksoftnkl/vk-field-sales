// Pure TypeScript (no React Native imports) so `npm test` can run it in Node.

const hex = (b: number) => b.toString(16).padStart(2, '0');

/**
 * UUIDv7 (RFC 9562): 48-bit millisecond timestamp + random bits. Time-ordered, so it indexes
 * well, and it has the same shape as VK Nex's uuidv7() keys. Used for rows made on the phone.
 * Math.random is enough here: the id only has to be unique, not secret, and this needs no
 * native crypto module.
 */
export function uuidv7(now: number = Date.now(), random: () => number = Math.random): string {
  const bytes = Array.from({ length: 16 }, () => Math.floor(random() * 256));
  let ts = now;
  for (let i = 5; i >= 0; i--) {
    bytes[i] = ts % 256;
    ts = Math.floor(ts / 256);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x70; // version 7
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant 10xx
  const h = bytes.map(hex).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
