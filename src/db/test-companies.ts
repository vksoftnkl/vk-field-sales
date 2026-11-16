// Pure TypeScript (no React Native imports) so `npm test` can check it in Node.

/**
 * TEMPORARY firms the salesman sells for (Choose company), until companies come from Sync.
 * Remove this file (and its part of seed.ts) then.
 */
export const TEST_COMPANIES = [
  { id: 'comp-balaji', name: 'Sri Balaji Distributors', place: 'Namakkal', position: 1 },
  { id: 'comp-sakthi', name: 'Sakthi Agencies', place: 'Namakkal', position: 2 },
  { id: 'comp-kongu', name: 'Kongu Traders', place: 'Rasipuram', position: 3 },
] as const;
