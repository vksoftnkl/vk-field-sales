import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useMemo } from 'react';

import { todayISO } from '@/lib/money';
import { useAppSelector } from '@/store';

import { openItemsQuery, receiptSettingsQuery, unsentPlansQuery, unsentReceiptsQuery } from './queries';
import { amountPaise } from './receipt-math';
import { itemsNow, typedCreditPaise, typedEntries, type ReceiptItem } from './receipt-plan';
import { settle, type Settlement } from './settle';

export interface ReceiptPlan {
  /** The draft is for this customer and company (else the figures are for an empty receipt). */
  mine: boolean;
  /** Credits first, then bills, in VK Nex's order, after this phone's unsent receipts. */
  items: ReceiptItem[];
  byKey: Map<string, ReceiptItem>;
  settlement: Settlement;
  /** Bills pending (credits not taken off). */
  outstandingPaise: number;
  creditsHeldPaise: number;
  /** When Sync last brought this company's open items; null = never. */
  syncedOn: string | null;
  settings: { billSort: string | null; salesmanMandatory: boolean; pdcPostingMode: string | null; ppdEnabled: boolean } | null;
  /** The receipt date (D7: always today). */
  date: string;
  /** The live queries have answered at least once. */
  ready: boolean;
}

/**
 * The receipt being taken, worked out the desktop's way (canvas 5b): the customer's open items in
 * one company as they stand now, and how the draft's amount, hand-typed bills and credits settle
 * them. Dues, Bill adjustment, Payment and Review all read it, so they always agree.
 */
export function useReceiptPlan(customerId: string, companyId: string): ReceiptPlan {
  const draft = useAppSelector((st) => st.receiptDraft);
  const { data: rows, updatedAt } = useLiveQuery(openItemsQuery(customerId), [customerId]);
  const { data: unsent } = useLiveQuery(unsentReceiptsQuery(customerId), [customerId]);
  // The plans query reads receipt_allocations, so it alone would not notice a receipt sent or
  // saved: it is read again whenever this shop's unsent receipts change.
  const unsentKey = unsent.map((u) => `${u.id}:${u.onAccount ?? ''}`).join(',');
  const { data: plans } = useLiveQuery(unsentPlansQuery(customerId), [customerId, unsentKey]);
  const { data: settingRows } = useLiveQuery(receiptSettingsQuery(companyId), [companyId]);

  const mine = draft.customerId === customerId && draft.companyId === companyId;
  // Editing a sent-back receipt: its own plan is not taken off the bills twice.
  const editingId = mine ? draft.editingId : null;
  const date = todayISO();

  const items = useMemo(() => {
    const myPlans = plans.filter((p) => p.receiptId !== editingId);
    const old = unsent.filter((u) => u.id !== editingId && u.onAccount === null);
    return itemsNow(rows, myPlans, old, companyId);
  }, [rows, plans, unsent, editingId, companyId]);

  const typedBills = mine ? draft.typedBills : null;
  const typedCredits = mine ? draft.typedCredits : null;
  const amount = mine ? draft.amount : '';
  const settlement = useMemo(
    () =>
      settle({
        amountPaise: amountPaise(amount),
        date,
        items,
        typedBills: typedBills ? typedEntries(typedBills) : undefined,
        typedCredits: typedCredits ? typedCreditPaise(typedCredits) : undefined,
      }),
    [amount, date, items, typedBills, typedCredits],
  );

  const byKey = useMemo(() => new Map(items.map((i) => [i.key, i])), [items]);
  const outstandingPaise = items.reduce((s, i) => s + (i.kind === 'BILL' ? i.pendingPaise : 0), 0);
  const creditsHeldPaise = items.reduce((s, i) => s + (i.kind === 'BILL' ? 0 : i.pendingPaise), 0);
  const syncedOn = rows.find((r) => r.companyId === companyId)?.syncedOn ?? null;
  const st = settingRows[0];
  const settings = st ? { billSort: st.billSort, salesmanMandatory: st.salesmanMandatory, pdcPostingMode: st.pdcPostingMode, ppdEnabled: st.ppdEnabled } : null;

  return { mine, items, byKey, settlement, outstandingPaise, creditsHeldPaise, syncedOn, settings, date, ready: !!updatedAt };
}
