// Pure TypeScript (no React Native imports) so `npm test` can run it in Node.

/**
 * How a receipt settles a customer's open items, by the desktop Receipt's rules (VK Nex menu 99,
 * NexERP receipt_allocation_engine; canvas page 5b, decisions D2–D5):
 *  - Held credits (advance, sales return, opening or journal credit) are spent first, in bill
 *    order, as the desktop's Auto-allocate does (step 1). The salesman may lower a credit, never
 *    raise it above what it holds.
 *  - Bills the salesman adjusted by hand keep what was typed (receive, discount, round-off).
 *  - The rest of the cash fills the other bills oldest first (VK Nex's order), and what is left
 *    stays on account.
 *  - A bill filled in full gets its early-payment (PPD) discount for the receipt date; a bill only
 *    part paid gets none (the phone's choice: VK Nex allows a discount up to the slab).
 * VK Nex re-runs its own engine at Sync; this is what the phone shows and sends. Money is paise.
 */

export type OpenItemKind = 'BILL' | 'ADVANCE' | 'SALES_RETURN' | 'OPENING_CR' | 'JOURNAL_CR';

/** One early-payment slab: perc % of what is pending, for receipts dated up to tillDate. */
export interface PpdSlab {
  /** YYYY-MM-DD */
  tillDate: string;
  perc: number;
}

/** A bill or a held credit, in VK Nex's order. */
export interface OpenItem {
  /** billId + '|' + billAccYear. */
  key: string;
  kind: OpenItemKind;
  /** Bill: still pending (after this phone's unsent receipts). Credit: what it still holds. */
  pendingPaise: number;
  ppd: readonly PpdSlab[];
}

/** What the salesman typed on one bill (Bill adjustment). */
export interface BillEntry {
  receivePaise: number;
  discountPaise: number;
  roundoffPaise: number;
}

export interface SettleInput {
  /** The amount received (all payment modes, fees not included). */
  amountPaise: number;
  /** The receipt date (YYYY-MM-DD): picks the PPD slab. */
  date: string;
  items: readonly OpenItem[];
  /** Bills adjusted by hand, by key. */
  typedBills?: Readonly<Record<string, BillEntry>>;
  /** Credits lowered by hand, by key (absent = all it holds). */
  typedCredits?: Readonly<Record<string, number>>;
}

export interface BillLine {
  key: string;
  pendingPaise: number;
  receivePaise: number;
  /** Credits that landed on this bill. */
  creditPaise: number;
  discountPaise: number;
  roundoffPaise: number;
  /** Pending after this receipt. */
  leftPaise: number;
  /** The PPD discount the slab gives on the receipt date (0 when none). */
  ppdPaise: number;
  typed: boolean;
}

export interface CreditLine {
  key: string;
  heldPaise: number;
  /** Spent by this receipt. */
  usedPaise: number;
  typed: boolean;
}

export type SettleProblem = 'nothing' | 'typedOverAmount' | 'overPending';

export interface Settlement {
  bills: BillLine[];
  credits: CreditLine[];
  receivedPaise: number;
  creditsPaise: number;
  discountPaise: number;
  roundoffPaise: number;
  /** Taken off the bills: receive + credits + discount + round-off. */
  settledPaise: number;
  onAccountPaise: number;
  problem: SettleProblem | null;
}

/** Round-off may take off paise only (D5). */
export const ROUNDOFF_MAX_PAISE = 99;

const isCredit = (i: OpenItem) => i.kind !== 'BILL';

/** The slab for a date: the first whose tillDate is on or after it. */
export function ppdSlab(slabs: readonly PpdSlab[], date: string): PpdSlab | null {
  return [...slabs].filter((s) => s.tillDate >= date && s.perc > 0).sort((a, b) => a.tillDate.localeCompare(b.tillDate))[0] ?? null;
}

/**
 * The PPD discount VK Nex suggests: perc % of what is pending, rounded DOWN to the paisa, so the
 * phone never asks for more than VK Nex allows (D4: lower or clear only).
 */
export function ppdPaise(item: Pick<OpenItem, 'pendingPaise' | 'ppd'>, date: string): number {
  const slab = ppdSlab(item.ppd, date);
  if (!slab || item.pendingPaise <= 0) return 0;
  return Math.floor((item.pendingPaise * Math.round(slab.perc * 1000)) / 100_000);
}

export function settle(input: SettleInput): Settlement {
  const typedBills = input.typedBills ?? {};
  const typedCredits = input.typedCredits ?? {};
  const credits = input.items.filter(isCredit);
  const bills = input.items.filter((i) => !isCredit(i));

  const applies = credits.map((c) => {
    const typed = typedCredits[c.key];
    return { c, typed: typed !== undefined, apply: Math.max(0, Math.min(c.pendingPaise, typed ?? c.pendingPaise)) };
  });
  let creditLeft = applies.reduce((s, a) => s + a.apply, 0);
  const amount = Math.max(0, input.amountPaise);
  let cashLeft = amount - bills.reduce((s, b) => s + (typedBills[b.key]?.receivePaise ?? 0), 0);
  let over = false;

  const lines: BillLine[] = bills.map((b) => {
    const ppd = ppdPaise(b, input.date);
    const typed = typedBills[b.key];
    if (typed) {
      // A discount above today's slab (a receipt from an earlier day, opened again: D4, D7) or a
      // round-off above ₹0.99 (D5) is cut back, as VK Nex would refuse it.
      const discount = Math.min(typed.discountPaise, ppd);
      const roundoff = Math.min(typed.roundoffPaise, ROUNDOFF_MAX_PAISE);
      const room = b.pendingPaise - typed.receivePaise - discount - roundoff;
      if (room < 0) over = true;
      const credit = Math.min(creditLeft, Math.max(0, room));
      creditLeft -= credit;
      return {
        key: b.key,
        pendingPaise: b.pendingPaise,
        receivePaise: typed.receivePaise,
        creditPaise: credit,
        discountPaise: discount,
        roundoffPaise: roundoff,
        leftPaise: room - credit,
        ppdPaise: ppd,
        typed: true,
      };
    }
    const credit = Math.min(creditLeft, b.pendingPaise);
    creditLeft -= credit;
    const rest = b.pendingPaise - credit;
    const disc = Math.min(ppd, rest);
    const need = rest - disc;
    let receive = 0;
    let discount = 0;
    if (rest > 0 && need <= Math.max(0, cashLeft)) {
      receive = need;
      discount = disc;
    } else if (rest > 0) {
      receive = Math.max(0, cashLeft);
    }
    cashLeft -= receive;
    return {
      key: b.key,
      pendingPaise: b.pendingPaise,
      receivePaise: receive,
      creditPaise: credit,
      discountPaise: discount,
      roundoffPaise: 0,
      leftPaise: rest - receive - discount,
      ppdPaise: ppd,
      typed: false,
    };
  });

  // The credits really used, spent from the first credit on.
  let used = applies.reduce((s, a) => s + a.apply, 0) - creditLeft;
  const creditLines: CreditLine[] = applies.map(({ c, typed }) => {
    const take = Math.min(used, applies.find((a) => a.c === c)!.apply);
    used -= take;
    return { key: c.key, heldPaise: c.pendingPaise, usedPaise: take, typed };
  });

  const sum = (f: (l: BillLine) => number) => lines.reduce((s, l) => s + f(l), 0);
  const creditsPaise = creditLines.reduce((s, c) => s + c.usedPaise, 0);
  const discountPaise = sum((l) => l.discountPaise);
  const roundoffPaise = sum((l) => l.roundoffPaise);
  const settledPaise = sum((l) => l.receivePaise + l.creditPaise + l.discountPaise + l.roundoffPaise);
  // A receipt needs money: VK Nex refuses one with no payment line, so credits alone are not a
  // receipt on the phone (they are spent with the next money taken).
  const problem: SettleProblem | null = over ? 'overPending' : cashLeft < 0 ? 'typedOverAmount' : amount <= 0 ? 'nothing' : null;
  return {
    bills: lines,
    credits: creditLines,
    receivedPaise: amount,
    creditsPaise,
    discountPaise,
    roundoffPaise,
    settledPaise,
    onAccountPaise: Math.max(0, cashLeft),
    problem,
  };
}

/**
 * The cash that clears every bill up to and including the bill with this key (credits spent first,
 * PPD discounts taken), for the quick-amount chips. Bills typed by hand count as typed.
 */
export function cashToClearUpTo(input: Omit<SettleInput, 'amountPaise'>, key: string): number {
  const all = input.items.reduce((s, i) => s + (isCredit(i) ? 0 : Math.max(0, i.pendingPaise)), 0);
  const s = settle({ ...input, amountPaise: all });
  const idx = s.bills.findIndex((b) => b.key === key);
  if (idx < 0) return 0;
  // Bills typed by hand further down keep their cash too.
  const later = s.bills.slice(idx + 1).reduce((t, b) => t + (b.typed ? b.receivePaise : 0), 0);
  return s.bills.slice(0, idx + 1).reduce((t, b) => t + b.receivePaise, 0) + later;
}

/** Why a Bill adjustment entry can't be saved, or null (D4, D5, and never above pending). */
export function billEntryProblem(e: BillEntry, item: Pick<OpenItem, 'pendingPaise' | 'ppd'>, date: string): 'overPending' | 'discountAbovePpd' | 'roundoffTooBig' | 'negative' | null {
  if (e.receivePaise < 0 || e.discountPaise < 0 || e.roundoffPaise < 0) return 'negative';
  if (e.discountPaise > ppdPaise(item, date)) return 'discountAbovePpd';
  if (e.roundoffPaise > ROUNDOFF_MAX_PAISE) return 'roundoffTooBig';
  if (e.receivePaise + e.discountPaise + e.roundoffPaise > item.pendingPaise) return 'overPending';
  return null;
}

/** Credits the phone reads from VK Nex's open-items kinds; anything unknown is a bill. */
export function itemKind(kind: string | null | undefined): OpenItemKind {
  return kind === 'ADVANCE' || kind === 'SALES_RETURN' || kind === 'OPENING_CR' || kind === 'JOURNAL_CR' ? kind : 'BILL';
}

/** ppd_schedule JSON → slabs; junk → none. */
export function parsePpd(json: string | null | undefined): PpdSlab[] {
  if (!json) return [];
  try {
    const v: unknown = JSON.parse(json);
    if (!Array.isArray(v)) return [];
    return v
      .map((s: { tillDate?: unknown; perc?: unknown }) => ({ tillDate: String(s?.tillDate ?? '').slice(0, 10), perc: Number(s?.perc) }))
      .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s.tillDate) && Number.isFinite(s.perc) && s.perc > 0);
  } catch {
    return [];
  }
}
