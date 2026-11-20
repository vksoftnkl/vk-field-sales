// Pure TypeScript (no React Native imports) so `npm test` can run it in Node.

import { amountPaise, TENDER_TYPE } from '../receipts/receipt-math.ts';

/**
 * A customer's balance and outstanding, as the Customer list shows them.
 *
 *  - Balance: the customer's LEDGER closing today in VK Nex: the opening plus every posted voucher
 *    (bills, receipts, returns, journals, advances). Dr (+) = the customer owes us; Cr (−) = we
 *    owe them (they paid ahead).
 *  - Outstanding: what the customer's UNPAID BILLS still owe, bill by bill: VK Nex's Party
 *    Outstanding "owed". Money that isn't set against a bill (an advance, a sales return, a receipt
 *    left on account) lowers the balance but not the outstanding. So a shop with ₹12,000 of bills
 *    open and a ₹2,000 advance has outstanding ₹12,000 and balance ₹10,000 Dr.
 *
 * Both come from VK Nex at Sync (customer_balances). Until the next Sync the phone adds what it
 * has that those figures don't:
 *  - A receipt not sent yet, or sent after the figures were read (Send now). VK Nex posts the money
 *    in hand and the discount and round-off on the receipt's own date, so they come off the
 *    balance. What settles bills (credits spent, discount, round-off and the money set on bills)
 *    comes off the outstanding, never below 0. A post-dated cheque counts in neither until its
 *    date. VK Nex fills bills with money in hand before post-dated cheques, so a cheque's part of
 *    the bill money is the last to come off. A receipt without a plan (VK Nex fills the oldest
 *    bills itself) takes its money in hand off both.
 *  - An order not sent yet: its total goes on both, as if billed (the user's choice, 2026-11-20).
 *    VK Nex leaves an order out of both until the office bills it, so after Sync sends the order
 *    the figures go back to VK Nex's.
 * Receipts come off before orders are added: a receipt settles real bills, not an order.
 */

/** What VK Nex said at the last Sync. */
export interface SyncedFigures {
  /** Signed paise, Dr +. */
  balancePaise: number;
  /** null from a VK Nex older than the outstanding figure. */
  outstandingPaise: number | null;
  billCount: number | null;
  /** YYYY-MM-DD of the oldest unpaid bill. */
  oldestBillDate: string | null;
}

/** A receipt of this phone that VK Nex's figures don't have yet, in paise. */
export interface PhoneReceipt {
  customerId: string;
  /** What the customer paid towards the receipt (principals, surcharge left out). */
  amountPaise: number;
  /** Of which cheques dated after today. */
  postDatedPaise: number;
  /**
   * How the salesman settled the bills (the PLANNED rows): money set on bills, and the credits,
   * discount and round-off on them. null = no plan, so VK Nex fills the oldest bills itself.
   */
  plan: { billMoneyPaise: number; creditsPaise: number; discountPaise: number; roundoffPaise: number } | null;
}

/** An order of this phone not sent yet. */
export interface PhoneOrder {
  customerId: string;
  amountPaise: number;
}

/** A receipt row, its payment lines and its PLANNED rows, as read from SQLite (rupees as text). */
export interface ReceiptRows {
  receipt: { id: string; customerId: string; amount: string; onAccount: string | null };
  lines: readonly { receiptId: string; typeId: number; amount: string; surcharge: string | null; instrumentDate: string | null }[];
  plan: readonly { receiptId: string; kind: string; amount: string; credit: string; discount: string; roundoff: string }[];
}

/**
 * The receipts as withPhoneChanges takes them. A receipt saved with the shop's open items on the
 * phone (onAccount set) follows its plan, an empty plan meaning all on account, as its upload
 * does (toReceiptPayload); one without (onAccount null) is filled oldest first by VK Nex.
 */
export function toPhoneReceipts(rows: Pick<ReceiptRows, 'receipt'>['receipt'][], lines: ReceiptRows['lines'], plan: ReceiptRows['plan'], today: string): PhoneReceipt[] {
  return rows.map((r) => {
    const postDatedPaise = lines
      .filter((l) => l.receiptId === r.id && l.typeId === TENDER_TYPE.CHEQUE && !!l.instrumentDate && l.instrumentDate > today)
      // The surcharge is inside the line's amount; the receipt amount is the principals.
      .reduce((s, l) => s + amountPaise(l.amount) - amountPaise(l.surcharge ?? ''), 0);
    const bills = plan.filter((a) => a.receiptId === r.id && a.kind === 'BILL');
    const sum = (f: (a: (typeof bills)[number]) => string) => bills.reduce((s, a) => s + amountPaise(f(a)), 0);
    return {
      customerId: r.customerId,
      amountPaise: amountPaise(r.amount),
      postDatedPaise,
      plan:
        r.onAccount === null
          ? null
          : { billMoneyPaise: sum((a) => a.amount), creditsPaise: sum((a) => a.credit), discountPaise: sum((a) => a.discount), roundoffPaise: sum((a) => a.roundoff) },
    };
  });
}

/** What one receipt takes off the balance (Cr) and off the unpaid bills, today. */
export function receiptEffect(r: PhoneReceipt): { balancePaise: number; billsPaise: number } {
  const inHand = Math.max(0, r.amountPaise - Math.max(0, r.postDatedPaise));
  if (!r.plan) return { balancePaise: inHand, billsPaise: inHand };
  const deductions = r.plan.discountPaise + r.plan.roundoffPaise;
  return {
    balancePaise: inHand + deductions,
    billsPaise: Math.max(0, r.plan.creditsPaise) + deductions + Math.min(inHand, Math.max(0, r.plan.billMoneyPaise)),
  };
}

/** What the list shows for one customer. null = not known (no Sync has brought it). */
export interface ShownFigures {
  balancePaise: number | null;
  outstandingPaise: number | null;
  /** VK Nex's count and oldest date; null once the phone changed the figure (it can't tell which bills). */
  billCount: number | null;
  oldestBillDate: string | null;
  /** A receipt or order of this phone is in the figures. */
  changedOnPhone: boolean;
}

/**
 * VK Nex's figures plus this customer's receipts and orders VK Nex's figures don't have yet.
 * `newOnPhone`: a shop made on this phone, not on VK Nex yet, so it starts from 0.
 */
export function withPhoneChanges(
  base: SyncedFigures | null,
  receipts: readonly PhoneReceipt[],
  orders: readonly PhoneOrder[],
  newOnPhone = false,
): ShownFigures {
  const start = base ?? (newOnPhone ? { balancePaise: 0, outstandingPaise: 0, billCount: 0, oldestBillDate: null } : null);
  if (!start) return { balancePaise: null, outstandingPaise: null, billCount: null, oldestBillDate: null, changedOnPhone: false };
  if (receipts.length === 0 && orders.length === 0) return { ...start, changedOnPhone: false };

  let balance = start.balancePaise;
  let outstanding = start.outstandingPaise;
  for (const r of receipts) {
    const e = receiptEffect(r);
    balance -= e.balancePaise;
    if (outstanding !== null) outstanding = Math.max(0, outstanding - e.billsPaise);
  }
  const ordered = orders.reduce((s, o) => s + Math.max(0, o.amountPaise), 0);
  balance += ordered;
  if (outstanding !== null) outstanding += ordered;
  const settled = outstanding === 0;
  return {
    balancePaise: balance,
    outstandingPaise: outstanding,
    billCount: settled ? 0 : null,
    oldestBillDate: null,
    changedOnPhone: true,
  };
}

/** Groups by customer, for withPhoneChanges. */
export function byCustomer<T extends { customerId: string }>(rows: readonly T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows) {
    const list = out.get(r.customerId);
    if (list) list.push(r);
    else out.set(r.customerId, [r]);
  }
  return out;
}

/** 845000 → { paise: 845000, side: 'Dr' }; −200000 → { paise: 200000, side: 'Cr' }; 0 → no side. */
export function sideOf(balancePaise: number): { paise: number; side: 'Dr' | 'Cr' | null } {
  const paise = Math.abs(balancePaise);
  return { paise, side: Math.round(paise / 100) === 0 ? null : balancePaise > 0 ? 'Dr' : 'Cr' };
}
