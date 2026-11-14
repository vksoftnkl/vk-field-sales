// Pure TypeScript (no React Native imports) so `npm test` can run it in Node.

/**
 * Filters picker options by what the salesman typed: case-insensitive, matches anywhere in
 * the label, every word must match ("kar s" finds "Karthik S"). Options with an empty value
 * ("None") always stay, so they can still be picked while searching.
 */
export function filterOptions<T extends { value: string; label: string }>(options: readonly T[], query: string): T[] {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...options];
  return options.filter((o) => {
    if (o.value === '') return true;
    const label = o.label.toLocaleLowerCase();
    return words.every((w) => label.includes(w));
  });
}
