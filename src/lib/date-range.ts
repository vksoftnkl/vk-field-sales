// Pure TypeScript (no React Native imports) so `npm test` can run it in Node.

/**
 * Date ranges of the Ledger statement's "Date range" sheet. Dates are 'YYYY-MM-DD' strings,
 * worked out in UTC so the phone's time zone never shifts a day. Weeks run Sunday to Saturday
 * (as in the Qt app); a year is the financial year, 1 April to 31 March (as VK Nex's books).
 */

export type RangeKey = 'today' | 'yesterday' | 'thisWeek' | 'lastWeek' | 'thisMonth' | 'last30' | 'thisYear' | 'lastYear';

export const RANGE_KEYS: readonly RangeKey[] = ['today', 'yesterday', 'thisWeek', 'lastWeek', 'thisMonth', 'last30', 'thisYear', 'lastYear'];

export interface DateRange {
  from: string;
  to: string;
}

/** The ledger opens on this week, as the Qt app does. */
export const DEFAULT_RANGE: RangeKey = 'thisWeek';

/** April: the first month of the financial year. */
const FY_FIRST_MONTH = 4;

const parts = (iso: string) => ({ y: Number(iso.slice(0, 4)), m: Number(iso.slice(5, 7)), d: Number(iso.slice(8, 10)) });
const toISO = (dt: Date) => dt.toISOString().slice(0, 10);
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

export function addDays(iso: string, n: number): string {
  const { y, m, d } = parts(iso);
  return toISO(utc(y, m, d + n));
}

/** 0 = Sunday … 6 = Saturday. */
export const weekday = (iso: string): number => {
  const { y, m, d } = parts(iso);
  return utc(y, m, d).getUTCDay();
};

export const daysInMonth = (y: number, m: number): number => utc(y, m + 1, 0).getUTCDate();

/** The financial year holding this date: 1 Apr … 31 Mar. */
export function financialYear(iso: string): DateRange {
  const { y, m } = parts(iso);
  const start = m >= FY_FIRST_MONTH ? y : y - 1;
  return { from: toISO(utc(start, FY_FIRST_MONTH, 1)), to: toISO(utc(start + 1, FY_FIRST_MONTH, 0)) };
}

export function rangeFor(key: RangeKey, today: string): DateRange {
  const { y, m } = parts(today);
  const sunday = addDays(today, -weekday(today));
  switch (key) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday': {
      const d = addDays(today, -1);
      return { from: d, to: d };
    }
    case 'thisWeek':
      return { from: sunday, to: addDays(sunday, 6) };
    case 'lastWeek':
      return { from: addDays(sunday, -7), to: addDays(sunday, -1) };
    case 'thisMonth':
      return { from: toISO(utc(y, m, 1)), to: toISO(utc(y, m, daysInMonth(y, m))) };
    case 'last30':
      return { from: addDays(today, -29), to: today };
    case 'thisYear':
      return financialYear(today);
    case 'lastYear':
      return financialYear(addDays(financialYear(today).from, -1));
  }
}

/** Month and weekday names, from the app's translations (English when none are given). */
export interface DateNames {
  /** 12 short month names, January first. */
  months: readonly string[];
}

export const ENGLISH_NAMES: DateNames = {
  months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};

const dayMonth = (iso: string, n: DateNames) => {
  const { m, d } = parts(iso);
  return `${d} ${n.months[m - 1]}`;
};
const monthYear = (iso: string, n: DateNames) => {
  const { y, m } = parts(iso);
  return `${n.months[m - 1]} ${y}`;
};

/** "16 Nov 2026" */
export function formatDay(iso: string, n: DateNames = ENGLISH_NAMES): string {
  return `${dayMonth(iso, n)} ${parts(iso).y}`;
}

/**
 * Short form beside each choice in the sheet: "16 Nov", "15 – 21 Nov", "18 Oct – 16 Nov",
 * "Apr 2026 – Mar 2027" (whole months), "28 Dec 2025 – 3 Jan 2026" (across a year end).
 */
export function formatRangeShort(r: DateRange, n: DateNames = ENGLISH_NAMES): string {
  const a = parts(r.from);
  const b = parts(r.to);
  if (r.from === r.to) return dayMonth(r.from, n);
  const wholeMonths = a.d === 1 && b.d === daysInMonth(b.y, b.m);
  if (wholeMonths && (a.y !== b.y || a.m !== b.m)) return `${monthYear(r.from, n)} – ${monthYear(r.to, n)}`;
  if (a.y !== b.y) return `${formatDay(r.from, n)} – ${formatDay(r.to, n)}`;
  if (a.m === b.m) return `${a.d} – ${b.d} ${n.months[b.m - 1]}`;
  return `${dayMonth(r.from, n)} – ${dayMonth(r.to, n)}`;
}

/** Long form on the ledger's range button: "15 Nov – 21 Nov 2026", "16 Nov 2026". */
export function formatRangeLong(r: DateRange, n: DateNames = ENGLISH_NAMES): string {
  if (r.from === r.to) return formatDay(r.from, n);
  if (parts(r.from).y !== parts(r.to).y) return `${formatDay(r.from, n)} – ${formatDay(r.to, n)}`;
  return `${dayMonth(r.from, n)} – ${formatDay(r.to, n)}`;
}

/** 'YYYY-MM-DD' → 'dd-mm-yyyy', as typed in Custom dates. */
export function toDMY(iso: string): string {
  const { y, m, d } = parts(iso);
  return `${String(d).padStart(2, '0')}-${String(m).padStart(2, '0')}-${y}`;
}

/**
 * A typed date (dd-mm-yyyy; '-', '/' or '.' between, one-digit day and month allowed) →
 * 'YYYY-MM-DD', or null when it is not a real date.
 */
export function parseDMY(text: string): string | null {
  const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(text.trim());
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  const y = Number(m[3]);
  if (y < 1900 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
  return toISO(utc(y, mo, d));
}

/** Days of a month laid out for a calendar: leading nulls up to the first day's weekday. */
export function monthGrid(y: number, m: number): (number | null)[] {
  const first = utc(y, m, 1).getUTCDay();
  const cells: (number | null)[] = Array.from({ length: first }, () => null);
  for (let d = 1; d <= daysInMonth(y, m); d++) cells.push(d);
  return cells;
}

export const isoOf = (y: number, m: number, d: number): string => toISO(utc(y, m, d));
export { parts as dateParts };
