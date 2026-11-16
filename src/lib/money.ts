// Pure TypeScript (no React Native imports) so `npm test` can run it in Node.

/**
 * Whole rupees with Indian digit grouping, e.g. 3845000 paise → "₹38,450".
 * Done by hand rather than with Intl so it is the same on every phone's JS engine.
 */
export function formatRupees(paise: number): string {
  const rupees = Math.round(Math.abs(paise) / 100);
  const digits = String(rupees);
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+$)/g, ',')},${last3}` : last3;
  return `${paise < 0 && rupees > 0 ? '-' : ''}₹${grouped}`;
}

/** Today's date on the phone as YYYY-MM-DD (local time, not UTC). */
export function todayISO(now: Date = new Date()): string {
  const m = `${now.getMonth() + 1}`.padStart(2, '0');
  const d = `${now.getDate()}`.padStart(2, '0');
  return `${now.getFullYear()}-${m}-${d}`;
}

/** Whole days from one YYYY-MM-DD date to another (never negative). */
export function daysBetween(fromISO: string, toISO: string): number {
  const ms = Date.parse(`${toISO}T00:00:00Z`) - Date.parse(`${fromISO}T00:00:00Z`);
  return Number.isFinite(ms) ? Math.max(0, Math.round(ms / 86_400_000)) : 0;
}
