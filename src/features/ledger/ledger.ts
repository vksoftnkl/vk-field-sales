// Pure TypeScript (no React Native imports) so `npm test` can run it in Node.
import type { DateRange } from '@/lib/date-range';

/**
 * The Ledger statement, worked out on the phone from what Sync brought: per financial year,
 * VK Nex's opening balance and every voucher with VK Nex's own running balance. Nothing is
 * added up here except "which row comes last", so every figure is VK Nex's.
 */

/** One downloaded year of one customer (ledger_years + fiscal_years). Signed paise, DR +. */
export interface LedgerYear {
  accYear: string;
  /** The financial year: first and last day. */
  beginDate: string;
  endDate: string;
  /** Balance brought forward at beginDate. */
  openingPaise: number;
  /** Balance at the last day Sync read (today, for this year). */
  closingPaise: number;
}

export interface LedgerRow {
  voucherId: string;
  accYear: string;
  seq: number;
  date: string;
  voucherTypeName: string | null;
  voucherNo: string | null;
  rowKind: string;
  particulars: string | null;
  narration: string | null;
  srcModule: string | null;
  srcDocType: string | null;
  billRefs: string[];
  debitPaise: number;
  creditPaise: number;
  /** Running balance after this voucher, within its year. */
  balancePaise: number;
}

export type Statement =
  | { ok: true; openingPaise: number; rows: LedgerRow[]; closingPaise: number; to: string }
  /** noLedger: Sync has not brought this customer's ledger. notOnPhone: the dates are outside the years it brought. */
  | { ok: false; reason: 'noLedger' | 'notOnPhone'; years: string[] };

const byYear = (years: readonly LedgerYear[]) => [...years].sort((a, b) => a.beginDate.localeCompare(b.beginDate));
const yearHolding = (years: readonly LedgerYear[], date: string) => years.find((y) => y.beginDate <= date && date <= y.endDate);

/** VK Nex's order: year, then the position VK Nex gave each voucher. */
const ordered = (rows: readonly LedgerRow[], years: readonly LedgerYear[]) => {
  const rank = new Map(years.map((y, i) => [y.accYear, i]));
  return [...rows].sort((a, b) => (rank.get(a.accYear) ?? 0) - (rank.get(b.accYear) ?? 0) || a.seq - b.seq);
};

/** Balance at the end of `date`, within the year holding it. */
function balanceAt(year: LedgerYear, rows: readonly LedgerRow[], date: string): number {
  let bal = year.openingPaise;
  for (const r of rows) if (r.accYear === year.accYear && r.date <= date) bal = r.balancePaise;
  return bal;
}

/**
 * Opening at `from`, the vouchers from `from` to `to`, and the closing at `to`. A range may run
 * across two years (Last 30 days in April): each balance is read in its own year. A range past
 * the last downloaded year is cut at that year's end (its vouchers aren't on the phone yet).
 */
export function statement(yearsIn: readonly LedgerYear[], rowsIn: readonly LedgerRow[], range: DateRange): Statement {
  const years = byYear(yearsIn);
  const names = years.map((y) => y.accYear);
  if (years.length === 0) return { ok: false, reason: 'noLedger', years: names };
  const first = yearHolding(years, range.from);
  if (!first) return { ok: false, reason: 'notOnPhone', years: names };
  const lastEnd = years[years.length - 1]!.endDate;
  const to = range.to > lastEnd ? lastEnd : range.to;
  const last = yearHolding(years, to);
  // VK Nex may lack a year between the two Sync brought: the dates run through a year not on the phone.
  if (!last) return { ok: false, reason: 'notOnPhone', years: names };
  const rows = ordered(rowsIn, years);
  return {
    ok: true,
    openingPaise: balanceAt(first, rows, prevDay(range.from, first)),
    rows: rows.filter((r) => r.date >= range.from && r.date <= to),
    closingPaise: balanceAt(last, rows, to),
    to,
  };
}

/** The day before `date`, but never before the year's start (the opening is the year's then). */
function prevDay(date: string, year: LedgerYear): string {
  if (date <= year.beginDate) return '0000-00-00';
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** What the customer owes now, as of the last Sync: the latest year's closing (null = no ledger). */
export function currentBalance(years: readonly LedgerYear[]): number | null {
  const sorted = byYear(years);
  return sorted.length ? sorted[sorted.length - 1]!.closingPaise : null;
}

/** VK Nex's sales bills (SALES / SALE_BILL), newest first. */
export function recentBills(rows: readonly LedgerRow[], years: readonly LedgerYear[], limit = 5): LedgerRow[] {
  return ordered(rows, byYear(years))
    .filter((r) => r.srcDocType === 'SALE_BILL' && r.rowKind === 'NORMAL')
    .reverse()
    .slice(0, limit);
}

/** Signed movement of one voucher (+ raises what the customer owes). */
export const netPaise = (r: Pick<LedgerRow, 'debitPaise' | 'creditPaise'>): number => r.debitPaise - r.creditPaise;
