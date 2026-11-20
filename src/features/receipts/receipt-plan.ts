// Pure TypeScript (no React Native imports) so `npm test` can run it in Node.

import { amountPaise, afterReceipts } from './receipt-math.ts';
import { itemKind, parsePpd, type BillEntry, type OpenItem, type Settlement } from './settle.ts';

/** An open item as the phone keeps it (open_bills), for the Receipt screens. */
export interface OpenItemRow {
  billId: string;
  billAccYear: string;
  companyId: string;
  kind: string | null;
  docRefno: string;
  docDate: string;
  dueDate: string | null;
  billAmountPaise: number;
  pendingPaise: number;
  paidPaise: number;
  pdcHeldPaise: number;
  ppdSchedule: string | null;
}

/** A planned allocation of one of this phone's receipts VK Nex doesn't have yet. */
export interface UnsentPlanRow {
  companyId: string;
  kind: string;
  billId: string;
  billAccYear: string;
  amount: string;
  credit: string;
  discount: string;
  roundoff: string;
}

/** An unsent receipt saved before the desktop-rule receipt: only its amount (VK Nex fills oldest first). */
export interface UnsentOldReceipt {
  companyId: string;
  amount: string;
}

export type ReceiptItem = OpenItemRow & OpenItem;

export const itemKey = (r: { billId: string; billAccYear: string }): string => `${r.billId}|${r.billAccYear}`;

/** Rupees as exact text ('12474.00') → paise. */
const paise = (s: string | null | undefined): number => amountPaise(s ?? '');

/**
 * One company's open items as they stand now: VK Nex's figures at the last Sync, less this phone's
 * receipts not yet sent (their plans, or for older receipts the oldest-first fill VK Nex will do).
 * Credits come first, then bills, each in VK Nex's order. Settled items are left out.
 */
export function itemsNow(rows: readonly OpenItemRow[], plans: readonly UnsentPlanRow[], old: readonly UnsentOldReceipt[], companyId: string): ReceiptItem[] {
  const taken = new Map<string, number>();
  for (const p of plans) {
    if (p.companyId !== companyId) continue;
    const k = itemKey(p);
    const t = p.kind === 'CREDIT' ? paise(p.amount) : paise(p.amount) + paise(p.credit) + paise(p.discount) + paise(p.roundoff);
    taken.set(k, (taken.get(k) ?? 0) + t);
  }
  const mine: ReceiptItem[] = rows
    .filter((r) => r.companyId === companyId)
    .map((r) => ({ ...r, key: itemKey(r), kind: itemKind(r.kind), pendingPaise: Math.max(0, r.pendingPaise - (taken.get(itemKey(r)) ?? 0)), ppd: parsePpd(r.ppdSchedule) }));
  const credits = mine.filter((i) => i.kind !== 'BILL');
  const bills = afterReceipts(
    mine.filter((i) => i.kind === 'BILL'),
    old.filter((r) => r.companyId === companyId).map((r) => paise(r.amount)),
  );
  return [...credits, ...bills].filter((i) => i.pendingPaise > 0);
}

/** The hand-typed bills of the draft, in paise (bad text counts as 0). */
export function typedEntries(typed: Readonly<Record<string, { receive: string; discount: string; roundoff: string }>>): Record<string, BillEntry> {
  const out: Record<string, BillEntry> = {};
  for (const [k, v] of Object.entries(typed)) out[k] = { receivePaise: paise(v.receive), discountPaise: paise(v.discount), roundoffPaise: paise(v.roundoff) };
  return out;
}

export function typedCreditPaise(typed: Readonly<Record<string, string>>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(typed)) out[k] = paise(v);
  return out;
}

/** Paise → '12474.00'. */
export const rupeeText = (p: number): string => (p / 100).toFixed(2);

/** The rows Save keeps for a settlement (receipt_allocations, 'PLANNED'): bills touched and credits spent. */
export function plannedRows(
  s: Settlement,
  items: readonly ReceiptItem[],
): { kind: 'BILL' | 'CREDIT'; billId: string; billAccYear: string; docRefno: string; amount: string; credit: string; discount: string; roundoff: string }[] {
  const byKey = new Map(items.map((i) => [i.key, i]));
  const bills = s.bills
    .filter((b) => b.receivePaise + b.creditPaise + b.discountPaise + b.roundoffPaise > 0)
    .map((b) => {
      const i = byKey.get(b.key)!;
      return {
        kind: 'BILL' as const,
        billId: i.billId,
        billAccYear: i.billAccYear,
        docRefno: i.docRefno,
        amount: rupeeText(b.receivePaise),
        credit: rupeeText(b.creditPaise),
        discount: rupeeText(b.discountPaise),
        roundoff: rupeeText(b.roundoffPaise),
      };
    });
  const credits = s.credits
    .filter((c) => c.usedPaise > 0)
    .map((c) => {
      const i = byKey.get(c.key)!;
      return { kind: 'CREDIT' as const, billId: i.billId, billAccYear: i.billAccYear, docRefno: i.docRefno, amount: rupeeText(c.usedPaise), credit: '0.00', discount: '0.00', roundoff: '0.00' };
    });
  return [...credits, ...bills];
}
