// Pure TypeScript (no React Native imports) so `npm test` can run it in Node.

/** Rows an item list loads at a time as it is scrolled (Add items, Select items, Select return items). */
export const PAGE_SIZE = 50;

/**
 * Scrolled near the end: load the next 50 only once the last 50 have come (`loaded` reached the
 * `limit` asked for) and the list has more (`total`). Stops the end-of-list event from asking
 * twice while a read is still on its way.
 */
export const canLoadMore = (loaded: number, limit: number, total: number): boolean => loaded >= limit && limit < total;
