// Pure TypeScript (no React Native imports) so `npm test` can run it in Node.

/**
 * Multi-select filters (beats, customer types) keep their choice as a list of ids, where an
 * empty list means "all". Ticking every box is the same as ticking none, so both become [];
 * otherwise the ids come back in the order the options are listed.
 */
export function normalizeSelection(picked: readonly string[], allIds: readonly string[]): string[] {
  const set = new Set(picked);
  const kept = allIds.filter((id) => set.has(id));
  return kept.length === 0 || kept.length === allIds.length ? [] : kept;
}

/** Ids saved in device_meta as one comma-separated string. */
export const parseIdList = (saved: string | null): string[] => (saved ? saved.split(',').filter(Boolean) : []);
export const serializeIdList = (ids: readonly string[]): string => ids.join(',');
