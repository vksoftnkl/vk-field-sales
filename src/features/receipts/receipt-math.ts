// Pure TypeScript (no React Native imports) so `npm test` can run it in Node.

/**
 * Receipt amounts. VK Nex fills the customer's open bills oldest first (its /receipts/open-items
 * order: due date first) when it posts the receipt, and keeps what is left On account (an
 * advance); the phone sends only the money (the user's choice, 2026-11-17). So the Receipt screen
 * only previews that fill:
 *  - autoAdjust spreads the amount over the bills in that order, each up to what is pending.
 *  - "Pay up to this bill" sets the amount to everything pending up to and including that bill.
 *  - The phone's own receipts not yet on VK Nex are taken off the bills first, the same way.
 * Money is whole paise.
 */

/** A bill still to be paid, as the Receipt screen lists it. */
export interface PayableBill {
  /** billId + '|' + billAccYear. */
  key: string;
  /** Still to pay: VK Nex's pending amount at the last Sync, less this phone's own receipts since. */
  pendingPaise: number;
}

/** Amounts put against bills, by bill key. A bill not in it has nothing against it. */
export type Allocation = Record<string, number>;

export function autoAdjust(amountPaise: number, bills: readonly PayableBill[]): Allocation {
  let left = Math.max(0, amountPaise);
  const out: Allocation = {};
  for (const b of bills) {
    if (left <= 0) break;
    if (b.pendingPaise <= 0) continue;
    const pay = Math.min(left, b.pendingPaise);
    out[b.key] = pay;
    left -= pay;
  }
  return out;
}

export interface ReceiptSummary {
  adjustedPaise: number;
  /** Receipt amount − adjusted (never below 0: the amount follows the bills up). */
  onAccountPaise: number;
  /** The receipt amount, raised to the adjusted total when the bills take more. */
  amountPaise: number;
  /** Bills with something still pending after this receipt, and all bills. */
  stillPending: number;
  billCount: number;
}

export function receiptSummary(typedAmountPaise: number, bills: readonly PayableBill[], alloc: Allocation): ReceiptSummary {
  let adjustedPaise = 0;
  let stillPending = 0;
  for (const b of bills) {
    const a = Math.max(0, Math.min(alloc[b.key] ?? 0, b.pendingPaise));
    adjustedPaise += a;
    if (b.pendingPaise - a > 0) stillPending += 1;
  }
  const amountPaise = Math.max(Math.max(0, typedAmountPaise), adjustedPaise);
  return { adjustedPaise, onAccountPaise: amountPaise - adjustedPaise, amountPaise, stillPending, billCount: bills.length };
}

/** A bill's status line: fully paid by this receipt, part paid (with what is left), or untouched. */
export function billState(b: PayableBill, alloc: Allocation): { kind: 'completed' | 'part' | 'none'; leftPaise: number } {
  const a = Math.max(0, Math.min(alloc[b.key] ?? 0, b.pendingPaise));
  const leftPaise = b.pendingPaise - a;
  if (a <= 0) return { kind: 'none', leftPaise };
  return leftPaise === 0 ? { kind: 'completed', leftPaise: 0 } : { kind: 'part', leftPaise };
}

export type ReceiptProblem = 'noAmount' | 'overPending';

/** Why Next can't go on, or null. */
export function receiptProblem(s: ReceiptSummary, bills: readonly PayableBill[], alloc: Allocation): ReceiptProblem | null {
  if (bills.some((b) => (alloc[b.key] ?? 0) > b.pendingPaise)) return 'overPending';
  if (s.amountPaise <= 0) return 'noAmount';
  return null;
}

/** The bills as they stand after receipts already made (oldest first, each one in turn). */
export function afterReceipts<B extends PayableBill>(bills: readonly B[], receiptsPaise: readonly number[]): B[] {
  let out = bills.map((b) => ({ ...b }));
  for (const r of receiptsPaise) {
    const alloc = autoAdjust(r, out);
    out = out.map((b) => ({ ...b, pendingPaise: b.pendingPaise - (alloc[b.key] ?? 0) }));
  }
  return out;
}

/** The amount that pays every bill up to and including bills[index]. */
export function payUpTo(bills: readonly PayableBill[], index: number): number {
  return bills.slice(0, index + 1).reduce((s, b) => s + Math.max(0, b.pendingPaise), 0);
}

/** Days from one YYYY-MM-DD date to another (negative when `to` is earlier). */
export function daysFrom(fromISO: string, toISO: string): number {
  const ms = Date.parse(`${toISO}T00:00:00Z`) - Date.parse(`${fromISO}T00:00:00Z`);
  return Number.isFinite(ms) ? Math.round(ms / 86_400_000) : 0;
}

/** VK Nex's tender type ids (accounts.acc_tender_types) the phone takes. */
export const TENDER_TYPE = { CASH: 1, CARD: 2, UPI: 3, WALLET: 4, CHEQUE: 5, BANK: 6 } as const;

/** One way of paying on the receipt, as typed. */
export interface TenderInput {
  amount: string;
}

/** A payment line with what VK Nex checks on it. */
export interface TenderLineInput extends TenderInput {
  typeId: number;
  /** The office marked this tender as needing a reference (UTR, card last 4 …). */
  needsRef: boolean;
  refNo: string;
  bankName: string;
  /** YYYY-MM-DD; cheques only. */
  instrumentDate: string | null;
}

export type TenderProblem = 'noAmount' | 'chequeNo' | 'bankName' | 'chequeDate' | 'cardLast4' | 'refNo';

/**
 * Why VK Nex would refuse this line, or null: an amount on every line; a cheque needs its number,
 * the customer's bank and its date (VCH_CHEQUE_DETAILS); a card its last 4 digits
 * (TENDER_REF_REQUIRED); any other tender the office marked as needing a reference, that reference.
 */
export function tenderProblem(t: TenderLineInput): TenderProblem | null {
  if (amountPaise(t.amount) <= 0) return 'noAmount';
  if (t.typeId === TENDER_TYPE.CHEQUE) {
    if (!t.refNo.trim()) return 'chequeNo';
    if (!t.bankName.trim()) return 'bankName';
    if (!t.instrumentDate) return 'chequeDate';
    return null;
  }
  if (t.typeId === TENDER_TYPE.CARD) return t.needsRef && !/^\d{4}$/.test(t.refNo.trim()) ? 'cardLast4' : null;
  return t.needsRef && !t.refNo.trim() ? 'refNo' : null;
}

/** '6,350.00' or '6350' → 635000; junk → 0. */
export function amountPaise(s: string): number {
  const n = Number(s.replace(/,/g, '').trim());
  return Number.isFinite(n) && s.trim() !== '' ? Math.round(n * 100) : 0;
}

/** A surcharge % as exact thousandths ('1.000' → 1000), so the sums below stay in whole numbers. */
const milliPerc = (perc: string): number => Math.max(0, Math.round((Number(perc) || 0) * 1000));

/**
 * The surcharge VK Nex finds inside a tender amount (ERP server receipt-lines.ts, which
 * back-calculates it and never checks tdAmount): with a % it is amount × % / (100 + %), rounded
 * half-up to the paisa, and the flat amount is NOT used; with no % it is the flat amount, once per
 * line. What is left fills the bills or goes on account.
 */
export function surchargeInside(tdAmountPaise: number, perc: string, flat: string): number {
  if (tdAmountPaise <= 0) return 0;
  const p = milliPerc(perc);
  if (p > 0) {
    const d = 100_000 + p;
    return Math.floor((2 * tdAmountPaise * p + d) / (2 * d));
  }
  return Math.max(0, amountPaise(flat));
}

/**
 * The tender amount to send so that VK Nex's back-calculation leaves exactly `principalPaise`
 * towards the receipt: e.g. 200.00 by UPI at 1% goes as 202.00. Taking one paisa off the amount
 * takes 0 or 1 off what is left, so the search always lands on it; the smallest such amount wins.
 */
export function tenderAmountFor(principalPaise: number, perc: string, flat: string): number {
  if (principalPaise <= 0) return 0;
  const p = milliPerc(perc);
  if (p === 0) return principalPaise + Math.max(0, amountPaise(flat));
  const left = (t: number) => t - surchargeInside(t, perc, flat);
  let t = principalPaise + Math.floor((2 * principalPaise * p + 100_000) / 200_000);
  while (left(t) < principalPaise) t += 1;
  while (left(t) > principalPaise) t -= 1;
  while (t > principalPaise && left(t - 1) === principalPaise) t -= 1;
  return t;
}

/** What the customer pays on top of a line's amount for its tender's surcharge. */
export const surchargePaise = (principalPaise: number, perc: string, flat: string): number =>
  tenderAmountFor(principalPaise, perc, flat) - Math.max(0, principalPaise);

/** What the payment lines come to, and what is left to account for (+ short, − over). */
export function tenderBalance(receiptPaise: number, tenders: readonly TenderInput[]): { tenderPaise: number; balancePaise: number } {
  const tenderPaise = tenders.reduce((s, t) => s + amountPaise(t.amount), 0);
  return { tenderPaise, balancePaise: receiptPaise - tenderPaise };
}
