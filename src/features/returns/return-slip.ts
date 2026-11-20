import type { TFunction } from 'i18next';

import { num, qtyText } from '@/features/orders/order-math';
import { formatDay, type DateNames } from '@/lib/date-range';
import { formatAmount } from '@/lib/money';

import type { returnItemsQuery, returnRowQuery } from './queries';

type Head = ReturnType<ReturnType<typeof returnRowQuery>['all']>[number];
type Item = ReturnType<ReturnType<typeof returnItemsQuery>['all']>[number];

const paise = (v: string | null | undefined) => Math.round(num(v) * 100);

/** A saved JSON note (why VK Nex held or sent a return back, or the office's approval); null when none. */
export interface SavedNote {
  code: string | null;
  message: string | null;
  /** VK Nex's plain words: what happened and what to do. */
  user?: { title: string | null; line: string | null; todo: string | null } | null;
}

export const noteOf = (json: string | null): SavedNote | null => {
  if (!json) return null;
  try {
    return JSON.parse(json) as SavedNote;
  } catch {
    return null;
  }
};

/**
 * The return slip (Saved, Return detail): one line per part, what happens to the money, and the
 * same as text for Share. Until VK Nex posts it, it says it is not a credit note yet.
 */
export function returnSlipLines(h: Head, items: readonly Item[], o: { t: TFunction; names: DateNames; company: string; salesman: string }) {
  const { t } = o;
  const lines = items.map(({ item: i, nameEn }) => ({
    key: i.sriId,
    label: `${i.appItemName ?? nameEn ?? ''} · ${qtyText(num(i.sriReturnQty))} ${i.appUnitName ?? ''} ${t(`sr.condition.${i.sriCondition}`).toLocaleLowerCase()}`,
    amount: formatAmount(paise(i.sriNetAmt)),
  }));
  const posted = h.appStatus === 'POSTED' && !!h.appVkRefno;
  const settleText = posted
    ? t('sr.slip.posted', { no: h.appVkRefno, amount: formatAmount(paise(h.appVkAmt ?? h.srReturnAmt)) })
    : h.srSettleMode === 'ADJUST'
      ? t('sr.slip.adjust', { bill: h.appBillRefno ?? '' })
      : t('sr.slip.credit');
  const total = formatAmount(paise(posted ? (h.appVkAmt ?? h.srReturnAmt) : h.srReturnAmt));
  const text = [
    o.company,
    posted ? t('sr.slip.headPosted') : t('sr.slip.head'),
    `${t('sr.saved.phoneRef')}: ${h.srReturnRefno}${posted ? ` · ${h.appVkRefno}` : ''}`,
    `${t('sr.saved.date')}: ${formatDay(h.srReturnDate, o.names)}`,
    `${t('sr.saved.shop')}: ${h.srCustName}`,
    `${t('sr.saved.against')}: ${h.appBillRefno ?? t('sr.items.noBill')}`,
    h.srReturnReason ? `${t('sr.saved.reason')}: ${h.srReturnReason}` : null,
    '',
    ...lines.map((l) => `${l.label}: ${l.amount}`),
    '',
    `${posted ? t('sr.slip.total') : t('sr.saved.about')}: ${total}`,
    settleText,
    o.salesman ? t('sr.saved.by', { name: o.salesman }) : null,
  ]
    .filter((x) => x !== null)
    .join('\n');
  return { lines, settleText, text };
}
