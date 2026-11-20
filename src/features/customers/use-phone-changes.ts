import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useCallback, useMemo } from 'react';

import { metaQuery } from '@/db/meta';
import { amountPaise } from '@/features/receipts/receipt-math';
import { todayISO } from '@/lib/money';

import { byCustomer, toPhoneReceipts, withPhoneChanges, type ShownFigures, type SyncedFigures } from './customer-figures';
import { figuresInfoQuery, receiptDetailsFor, unsentOrdersQuery, unsyncedReceiptsQuery } from './queries';

export interface PhoneChanges {
  /** When VK Nex's balances were read (ISO time) and its day; null before a Sync brought them. */
  syncedOn: string | null;
  asOn: string | null;
  /** A customer's figures: VK Nex's from the last Sync plus this phone's receipts and orders since. */
  shown(c: { cusId: string; newOnPhone: boolean; synced: SyncedFigures | null }): ShownFigures;
}

/**
 * Live: this phone's receipts and orders that VK Nex's figures don't have yet, and the rule that
 * adds them (customer-figures.ts). Only those of the company the figures were read in count; a
 * VK Nex that doesn't say which company (older than 2026-11-20) counts them all.
 */
export function usePhoneChanges(): PhoneChanges {
  const { data: mark } = useLiveQuery(metaQuery('customerFiguresSyncedAt'));
  const readAt = mark[0]?.value ?? null;
  const { data: info } = useLiveQuery(figuresInfoQuery(), [readAt]);
  const { data: rcts } = useLiveQuery(unsyncedReceiptsQuery(readAt), [readAt]);
  const { data: orders } = useLiveQuery(unsentOrdersQuery());
  const companyId = info[0]?.companyId ?? null;
  const today = todayISO();

  const receiptsBy = useMemo(() => {
    const mine = rcts.filter((r) => !companyId || r.companyId === companyId);
    // Lines and plan rows are saved in the receipt's own transaction: read with it.
    const { lines, plan } = receiptDetailsFor(mine.map((r) => r.id));
    return byCustomer(toPhoneReceipts(mine, lines, plan, today));
  }, [rcts, companyId, today]);
  const ordersBy = useMemo(
    () => byCustomer(orders.filter((o) => !companyId || o.companyId === companyId).map((o) => ({ customerId: o.customerId, amountPaise: amountPaise(o.amount) }))),
    [orders, companyId],
  );

  const shown = useCallback(
    (c: { cusId: string; newOnPhone: boolean; synced: SyncedFigures | null }) => withPhoneChanges(c.synced, receiptsBy.get(c.cusId) ?? [], ordersBy.get(c.cusId) ?? [], c.newOnPhone),
    [receiptsBy, ordersBy],
  );
  return { syncedOn: info[0]?.syncedOn ?? null, asOn: info[0]?.asOn ?? null, shown };
}

/** A list or detail row's synced columns as withPhoneChanges takes them (null = no Sync figures). */
export function syncedFrom(r: {
  syncedBalancePaise: number | null;
  syncedOutstandingPaise: number | null;
  syncedBillCount: number | null;
  syncedOldestBillDate: string | null;
}): SyncedFigures | null {
  return r.syncedBalancePaise === null
    ? null
    : { balancePaise: r.syncedBalancePaise, outstandingPaise: r.syncedOutstandingPaise, billCount: r.syncedBillCount, oldestBillDate: r.syncedOldestBillDate };
}
