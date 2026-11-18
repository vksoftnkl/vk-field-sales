// Pure TypeScript (no React Native imports) so `npm test` can run it in Node.
import { daysBetween } from '../../lib/money.ts';

/**
 * The shop's credit as the Visit and Review screens show it (the Qt order screen's credit panel).
 * On an order this only warns: Qt asks "Order on credit anyway?", it never blocks, and VK Nex
 * saves phone orders as DRAFT for the office to confirm.
 */
export interface CreditInput {
  /** What the shop owes now (ledger balance as of the last Sync, + = owes). */
  outstandingPaise: number;
  /** VK Nex's cus_credit_amt_limit; 0 = none set. */
  limitPaise: number;
  /** VK Nex's cus_credit_days; 0 = none set. */
  creditDays: number;
  /** The oldest bill still pending (YYYY-MM-DD), from the open bills Sync brought; null = none. */
  oldestBillDate: string | null;
  today: string;
  /** This order's total (0 on Visit). */
  orderPaise?: number;
}

/** With no credit days set, a bill older than this reads as overdue (as on the collection screens). */
export const OVERDUE_DEFAULT_DAYS = 30;

export interface CreditView {
  hasLimit: boolean;
  /** 0–100, of the limit used before this order. */
  usedPerc: number;
  /** Limit − outstanding (may be negative). */
  leftPaise: number;
  /** Outstanding + this order. */
  afterOrderPaise: number;
  /** After this order the shop is over its limit. */
  overLimit: boolean;
  /** Days since the oldest pending bill; null = none pending. */
  oldestDays: number | null;
  overdue: boolean;
  /** Something the salesman should see before ordering. */
  warn: boolean;
}

export function creditView(c: CreditInput): CreditView {
  const hasLimit = c.limitPaise > 0;
  const afterOrderPaise = c.outstandingPaise + (c.orderPaise ?? 0);
  const oldestDays = c.oldestBillDate ? daysBetween(c.oldestBillDate, c.today) : null;
  const overdue = oldestDays !== null && oldestDays > (c.creditDays > 0 ? c.creditDays : OVERDUE_DEFAULT_DAYS);
  const overLimit = hasLimit && afterOrderPaise > c.limitPaise;
  return {
    hasLimit,
    usedPerc: hasLimit ? Math.min(100, Math.max(0, Math.round((c.outstandingPaise * 100) / c.limitPaise))) : 0,
    leftPaise: c.limitPaise - c.outstandingPaise,
    afterOrderPaise,
    overLimit,
    oldestDays,
    overdue,
    warn: overLimit || overdue,
  };
}
