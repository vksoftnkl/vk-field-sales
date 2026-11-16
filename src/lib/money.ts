// Pure TypeScript (no React Native imports) so `npm test` can run it in Node.

/**
 * Whole rupees with Indian digit grouping, e.g. 3845000 paise → "₹38,450".
 * Done by hand rather than with Intl so it is the same on every phone's JS engine.
 */
export function formatRupees(paise: number): string {
  const rupees = Math.round(Math.abs(paise) / 100);
  return `${paise < 0 && rupees > 0 ? '-' : ''}₹${group(String(rupees))}`;
}

const group = (rupees: string) => {
  const last3 = rupees.slice(-3);
  const rest = rupees.slice(0, -3);
  return rest ? `${rest.replace(/\B(?=(\d{2})+$)/g, ',')},${last3}` : last3;
};

/** Rupees and paise with Indian grouping, as on bills and statements: 3845000 → "₹38,450.00". */
export function formatAmount(paise: number): string {
  const abs = Math.abs(Math.round(paise));
  const rupees = String(Math.floor(abs / 100));
  const p = String(abs % 100).padStart(2, '0');
  return `${paise < 0 && abs > 0 ? '-' : ''}₹${group(rupees)}.${p}`;
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
