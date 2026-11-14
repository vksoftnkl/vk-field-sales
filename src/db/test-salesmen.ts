// Pure TypeScript (no React Native imports) so `npm test` can check the hashes in Node.

/**
 * TEMPORARY test salesmen, so the login page can be tried before Sync with VK Nex exists.
 * Remove this file (and seed.ts) when real salesmen come from Sync.
 *
 *   Karthik S  → password 1111
 *   Murugan K  → password 2222
 *   Priya R    → password 3333
 *
 * Hashes are in VK Nex's format (`scrypt$<salt>$<hash>`, Node crypto.scrypt defaults, 64 bytes).
 */
export const TEST_SALESMEN = [
  {
    id: 'test-karthik',
    loginName: 'karthik',
    displayName: 'Karthik S',
    passwordHash:
      'scrypt$663fddac74f0cce57296c4a2e85511bd$e76cf9090ae3884824f99d8912109ec431bf7c5e74374fec8bc0754a9bdf1cd19741ff049dd4403e8f93e7a6f6f222eb828d582ec3e7d8df962e263ba36d5007',
  },
  {
    id: 'test-murugan',
    loginName: 'murugan',
    displayName: 'Murugan K',
    passwordHash:
      'scrypt$21cfd54a5d8da6a92c67fa913a3edf54$fd5a2946e6af6e2ead186f92bb73c88fb3f5958077d19745d48638bc38102bcdd5de2f577f4cfb96e03e507b1042b35996d434e97e4ff252b0e2f3f2e174df39',
  },
  {
    id: 'test-priya',
    loginName: 'priya',
    displayName: 'Priya R',
    passwordHash:
      'scrypt$6feb8dc0dc8978b89e3508396291241b$69b3f726058d278bc37076ccef0bdfa84b1b97f2f0732366d75373ccea5eab1430fcbd97b83cf5865d9898085a6e3a35a7745a163c940e0959365e40ccf66c3a',
  },
] as const;
