// Pure TypeScript (no React Native imports) so `npm test` can run it in Node.

import { amountPaise, TENDER_TYPE } from './receipt-math.ts';

/**
 * Where one of this phone's receipts stands (canvas 5b, My receipts and Receipt detail):
 *  - waiting: saved on the phone, goes at the next Sync (or waits for its new customer);
 *  - sentBack: VK Nex refused it; fix, send again or delete;
 *  - posted: VK Nex has it (its Rct number);
 *  - cancelled: cancelled in the office (from the status read at Sync).
 */
export type RcState = 'waiting' | 'sentBack' | 'posted' | 'cancelled';

/** Set by the upload when the receipt's customer is not on VK Nex yet: it waits, it is not refused. */
const CUSTOMER_FIRST = 'CUSTOMER_NOT_SENT';
/**
 * Set by the upload just before it sends (RECEIPT_SEND_TRIED in sync/upload-receipts.ts) and
 * cleared by VK Nex's answer: still there means the answer was lost, so VK Nex may have the
 * receipt. It waits; it can't be edited or deleted until a Sync settles it.
 */
const SEND_TRIED = 'SEND_TRIED';

export const receiptSendTried = (error: string | null | undefined): boolean => !!error && error.startsWith(SEND_TRIED);

export function rcState(r: { appPendingUpload: boolean; appSyncError: string | null; avhVoucherStatus: string | null; appCancelledOn: string | null }): RcState {
  if (r.appPendingUpload) return r.appSyncError && !r.appSyncError.startsWith(CUSTOMER_FIRST) && !receiptSendTried(r.appSyncError) ? 'sentBack' : 'waiting';
  if (r.appCancelledOn || (r.avhVoucherStatus ?? '').toUpperCase() === 'CANCELLED') return 'cancelled';
  return 'posted';
}

/** Chip colours per state (background / text), 4.5:1 or better. */
export const RC_TONES: Record<RcState, { bg: string; fg: string }> = {
  waiting: { bg: '#FEF3C7', fg: '#92400E' },
  sentBack: { bg: '#FEE2E2', fg: '#B91C1C' },
  posted: { bg: '#DCFCE7', fg: '#166534' },
  cancelled: { bg: '#F5F5F4', fg: '#57534E' },
};

/** 'ACC_COLLECTOR_REQUIRED: The company needs …' → its code and VK Nex's words. */
export function splitRefusal(error: string | null | undefined): { code: string | null; message: string } {
  const text = (error ?? '').trim();
  const m = /^([A-Z][A-Z0-9_]{2,}):\s*(.*)$/s.exec(text);
  return m ? { code: m[1]!, message: m[2]!.trim() } : { code: null, message: text };
}

/** Refusals the phone has a plain "what to do" for (receipt.hints.*); others get the general one. */
const HINTS: Record<string, string> = {
  ACC_COLLECTOR_REQUIRED: 'collector',
  MOBILE_RECEIPT_NO_EMPLOYEE: 'collector',
  MOBILE_RECEIPT_DISCOUNT_ABOVE_PPD: 'discount',
  MOBILE_RECEIPT_ROUNDOFF_TOO_BIG: 'roundoff',
  RCT_RIGHT_POST: 'right',
  MOBILE_BRANCH_NOT_OF_COMPANY: 'branch',
  VCH_CHEQUE_DETAILS: 'cheque',
  TENDER_REF_REQUIRED: 'cheque',
  // The company posts cheques on clearing, which VK Nex can't post yet (any receipt is refused).
  ACC_PDC_ALLOCATION: 'pdcClearing',
};

export function refusalHint(code: string | null): string {
  if (!code) return 'general';
  if (HINTS[code]) return HINTS[code]!;
  if (/DOC_?REF/.test(code)) return 'docRef';
  return 'general';
}

/** One change VK Nex made to the phone's plan at Sync (its adjusted[]). */
export interface Adjustment {
  billId: string;
  billAccYear: string;
  docRefno: string | null;
  plannedPaise: number;
  appliedPaise: number;
  /** BILL_SETTLED | BILL_REDUCED | CREDIT_REDUCED | PDC_ON_CLEARING (or a newer one). */
  reason: string;
}

/** A post-dated cheque's own voucher in VK Nex. */
export interface PdcVoucher {
  voucherId: string;
  voucherRefno: string | null;
  chequeDate: string;
  amountPaise: number;
  /** From the status read: HELD | CLEARED | BOUNCED; null right after posting. */
  status: string | null;
}

const money = (v: unknown): number => amountPaise(v === null || v === undefined ? '' : String(v));

function parseList(json: string | null | undefined): Record<string, unknown>[] {
  if (!json) return [];
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : [];
  } catch {
    return [];
  }
}

const textOr = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

export function parseAdjusted(json: string | null | undefined): Adjustment[] {
  return parseList(json).map((a) => ({
    billId: String(a.billId ?? ''),
    billAccYear: String(a.billAccYear ?? ''),
    docRefno: textOr(a.docRefno),
    plannedPaise: money(a.planned),
    appliedPaise: money(a.applied),
    reason: String(a.reason ?? ''),
  }));
}

export function parsePdc(json: string | null | undefined): PdcVoucher[] {
  return parseList(json).map((p) => ({
    voucherId: String(p.voucherId ?? ''),
    voucherRefno: textOr(p.voucherRefno),
    chequeDate: String(p.chequeDate ?? '').slice(0, 10),
    amountPaise: money(p.amount),
    status: textOr(p.status)?.toUpperCase() ?? null,
  }));
}

/** A payment line for the totals by mode. */
export interface CollectionLine {
  receiptId: string;
  typeId: number;
  /** td_amount (surcharge inside), rupees text. */
  amount: string;
  surcharge: string | null;
}

export interface CollectionTotals {
  receipts: number;
  totalPaise: number;
  cashPaise: number;
  chequePaise: number;
  upiPaise: number;
  /** Bank transfer, wallet and anything else. */
  otherPaise: number;
}

/**
 * What the salesman holds for the handover (My receipts): every payment line of the receipts
 * given, by mode, fees included (the shop paid them). Cancelled receipts are left out by the caller.
 */
export function collectionTotals(receiptIds: readonly string[], lines: readonly CollectionLine[]): CollectionTotals {
  const ids = new Set(receiptIds);
  const out: CollectionTotals = { receipts: ids.size, totalPaise: 0, cashPaise: 0, chequePaise: 0, upiPaise: 0, otherPaise: 0 };
  for (const l of lines) {
    if (!ids.has(l.receiptId)) continue;
    const p = amountPaise(l.amount);
    out.totalPaise += p;
    if (l.typeId === TENDER_TYPE.CASH) out.cashPaise += p;
    else if (l.typeId === TENDER_TYPE.CHEQUE) out.chequePaise += p;
    else if (l.typeId === TENDER_TYPE.UPI) out.upiPaise += p;
    else out.otherPaise += p;
  }
  return out;
}

const ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function below100(n: number): string {
  if (n < 20) return ONES[n]!;
  const t = TENS[Math.floor(n / 10)]!;
  return n % 10 ? `${t}-${ONES[n % 10]}` : t;
}

function below1000(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  return [h ? `${ONES[h]} hundred` : '', r ? below100(r) : ''].filter(Boolean).join(' ');
}

/** Whole rupees in words, Indian style (crore, lakh, thousand): 1917400 paise → "nineteen thousand one hundred seventy-four". */
function rupeeWords(rupees: number): string {
  if (rupees === 0) return 'zero';
  const parts: string[] = [];
  const crore = Math.floor(rupees / 10_000_000);
  const lakh = Math.floor((rupees % 10_000_000) / 100_000);
  const thousand = Math.floor((rupees % 100_000) / 1000);
  const rest = rupees % 1000;
  if (crore) parts.push(`${crore >= 1000 ? rupeeWords(crore) : below1000(crore)} crore`);
  if (lakh) parts.push(`${below100(lakh)} lakh`);
  if (thousand) parts.push(`${below100(thousand)} thousand`);
  if (rest) parts.push(below1000(rest));
  return parts.join(' ');
}

/** "Rupees nineteen thousand one hundred seventy-four only" (with "and N paise" when there are paise). */
export function amountInWords(paise: number): string {
  const abs = Math.max(0, Math.round(paise));
  const rupees = Math.floor(abs / 100);
  const p = abs % 100;
  const words = `Rupees ${rupeeWords(rupees)}${p ? ` and ${below100(p)} paise` : ''} only`;
  return words;
}
