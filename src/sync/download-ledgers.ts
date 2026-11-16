// Pure TypeScript (no React Native imports) so `npm test` can run it in Node.
import type { ApiError, FiscalYearOption, LedgerQuery, LedgerVouchersPage, SidedAmount } from './vk-nex-api';

/**
 * Sync's last step: every customer's Ledger statement for this financial year and last year,
 * from VK Nex's own Ledger Statement report (GET /reports/ledger-statement/vouchers), so the
 * phone shows it with no network. Read in the company VK Nex signed the user in to.
 */

export interface LedgerDeps {
  /** The login company (the token's company_id). */
  companyId(): string | null;
  fiscalYears(companyId: string): Promise<FiscalYearOption[]>;
  ledgerPage(q: LedgerQuery): Promise<LedgerVouchersPage>;
  onProgress?(done: number, total: number): void;
}

export interface SavedFiscalYear {
  fyYearName: string;
  fyBeginDate: string;
  fyEndDate: string;
}

export interface DownloadedLedgerYear {
  customerId: string;
  accYear: string;
  fromDate: string;
  toDate: string;
  openingPaise: number;
  closingPaise: number;
}

export interface DownloadedLedgerRow {
  customerId: string;
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
  balancePaise: number;
}

export interface LedgerDownload {
  fiscalYears: SavedFiscalYear[];
  years: DownloadedLedgerYear[];
  rows: DownloadedLedgerRow[];
  /** Customers whose ledger came (at least one year): their copy on the phone is replaced. */
  readIds: string[];
  read: number;
  /** Customers VK Nex has no ledger for in this company (refused with 400 / 404). */
  skipped: number;
}

/** The step can't run at all: why, for the Sync page. */
export class LedgerStepError extends Error {
  readonly kind = 'ledger';
  readonly code: 'NO_COMPANY' | 'NO_YEAR';
  constructor(code: 'NO_COMPANY' | 'NO_YEAR') {
    super(code);
    this.name = 'LedgerStepError';
    this.code = code;
  }
}
export const isLedgerStepError = (e: unknown): e is LedgerStepError => (e as { kind?: unknown } | null)?.kind === 'ledger';

const isApi = (e: unknown): e is ApiError => (e as { kind?: unknown } | null)?.kind === 'api';

/** VK Nex's largest page. */
const PAGE_SIZE = 1000;
/** Safety stop: 1000 × 100 vouchers in one customer's year. */
const MAX_PAGES = 100;

/** The year holding today, and the one before it (if VK Nex has it). */
export function pickYears(all: readonly FiscalYearOption[], today: string): SavedFiscalYear[] {
  const dated = all
    .filter((y): y is FiscalYearOption & { beginDate: string; endDate: string } => !!y.beginDate && !!y.endDate)
    .map((y) => ({ fyYearName: y.name, fyBeginDate: y.beginDate.slice(0, 10), fyEndDate: y.endDate.slice(0, 10), isCurrent: y.isCurrent }));
  const current =
    dated.find((y) => y.fyBeginDate <= today && today <= y.fyEndDate) ?? dated.find((y) => y.isCurrent && y.fyBeginDate <= today);
  if (!current) return [];
  const previous = dated.filter((y) => y.fyEndDate < current.fyBeginDate).sort((a, b) => b.fyEndDate.localeCompare(a.fyEndDate))[0];
  return [previous, current].filter((y): y is (typeof dated)[number] => !!y).map(({ isCurrent: _c, ...y }) => y);
}

/**
 * VK Nex's two-decimal money text ('38450.00', '-0.07') → paise, exactly (no floating point on
 * the digits). Unreadable text is 0.
 */
export const amountToPaise = (s: unknown): number => {
  const m = /^([+-])?(\d+)(?:\.(\d{1,2}))?$/.exec(typeof s === 'string' ? s.trim() : '');
  if (!m) return 0;
  const v = Number(m[2]) * 100 + Number((m[3] ?? '').padEnd(2, '0'));
  return m[1] === '-' ? -v : v;
};
const paise = amountToPaise;
/** { amount, side } → signed paise: DR (the customer owes) +, CR −. */
export const sidedToPaise = (a: SidedAmount | null | undefined): number => (a?.side === 'CR' ? -paise(a.amount) : paise(a?.amount));
const signed = sidedToPaise;

/**
 * One customer's year, every page. VK Nex's running balance spans the whole range, so each
 * row's balance and the last page's carriedForward are exact.
 */
async function readYear(deps: LedgerDeps, companyId: string, customerId: string, fy: SavedFiscalYear, today: string) {
  const toDate = today < fy.fyEndDate ? today : fy.fyEndDate;
  const rows: DownloadedLedgerRow[] = [];
  let opening = 0;
  let closing = 0;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const p = await deps.ledgerPage({ companyId, accYear: fy.fyYearName, ledgerId: customerId, fromDate: fy.fyBeginDate, toDate, page, pageSize: PAGE_SIZE });
    if (page === 1) opening = signed(p.broughtForward);
    closing = signed(p.carriedForward);
    for (const r of p.rows) {
      rows.push({
        customerId,
        voucherId: r.voucherId,
        accYear: fy.fyYearName,
        seq: rows.length + 1,
        date: r.date.slice(0, 10),
        voucherTypeName: r.voucherTypeName,
        voucherNo: r.voucherNo,
        rowKind: r.rowKind,
        particulars: r.particulars,
        narration: r.narration,
        srcModule: r.src?.module ?? null,
        srcDocType: r.src?.docType ?? null,
        billRefs: Array.isArray(r.billRefs) ? r.billRefs.filter((b): b is string => typeof b === 'string') : [],
        debitPaise: paise(r.debit),
        creditPaise: paise(r.credit),
        balancePaise: signed(r.balance),
      });
    }
    // Done when VK Nex's count is reached (whatever page size it really used), or, without a
    // count, on a short page.
    const total = Number(p.page?.totalRows);
    if (p.rows.length === 0 || (Number.isFinite(total) ? rows.length >= total : p.rows.length < PAGE_SIZE)) break;
  }
  const year: DownloadedLedgerYear = { customerId, accYear: fy.fyYearName, fromDate: fy.fyBeginDate, toDate, openingPaise: opening, closingPaise: closing };
  return { year, rows };
}

/**
 * Reads every customer's two years, a few at a time. Nothing is saved here: the caller replaces
 * the copies of the customers read, in one go. A year VK Nex refuses for one customer (400 /
 * 404: no ledger, another company's) is left out, and a customer with no year read is skipped.
 * Any other failure (no right to the Ledger Statement, server gone …) throws — and so does a
 * refusal of every customer, which is VK Nex refusing the request itself, not a customer.
 */
export async function downloadLedgers(customerIds: readonly string[], today: string, deps: LedgerDeps, concurrency = 4): Promise<LedgerDownload> {
  const companyId = deps.companyId();
  if (!companyId) throw new LedgerStepError('NO_COMPANY');
  const fiscalYears = pickYears(await deps.fiscalYears(companyId), today);
  if (fiscalYears.length === 0) throw new LedgerStepError('NO_YEAR');

  const years: DownloadedLedgerYear[] = [];
  const rows: DownloadedLedgerRow[] = [];
  let next = 0;
  let done = 0;
  const readIds: string[] = [];
  let skipped = 0;
  let firstRefusal: unknown = null;
  let failure: { error: unknown } | null = null;
  deps.onProgress?.(0, customerIds.length);
  const worker = async () => {
    while (!failure && next < customerIds.length) {
      const id = customerIds[next++]!;
      const got = [];
      for (const fy of fiscalYears) {
        try {
          got.push(await readYear(deps, companyId, id, fy, today));
        } catch (e) {
          if (!isApi(e) || (e.status !== 400 && e.status !== 404)) {
            failure ??= { error: e };
            return;
          }
          firstRefusal ??= e;
        }
      }
      if (got.length) {
        for (const g of got) {
          years.push(g.year);
          rows.push(...g.rows);
        }
        readIds.push(id);
      } else {
        skipped++;
      }
      deps.onProgress?.(++done, customerIds.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, customerIds.length) }, worker));
  if (failure) throw (failure as { error: unknown }).error;
  if (readIds.length === 0 && skipped > 0) throw firstRefusal;
  return { fiscalYears, years, rows, readIds, read: readIds.length, skipped };
}
