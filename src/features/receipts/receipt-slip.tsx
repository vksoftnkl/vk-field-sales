import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import type { TFunction } from 'i18next';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { useDateNames } from '@/components/use-date-names';
import { companiesQuery } from '@/features/company/company';
import { hhmm } from '@/features/orders/order-status';
import { formatDay, type DateNames } from '@/lib/date-range';
import { formatAmount } from '@/lib/money';
import { useAppSelector } from '@/store';
import { colors, font, radius, spacing } from '@/theme';

import { readMe, receiptAllocsQuery, receiptLinesQuery, receiptQuery } from './queries';
import { amountPaise, TENDER_TYPE } from './receipt-math';
import { amountInWords, rcState, savedReceiptMoney, settledBreakdown, type RcState } from './receipt-status';
import { useReceiptPlan } from './use-receipt-plan';

export interface SlipLine {
  name: string;
  details: string;
  /** Towards the receipt (fee not included). */
  amountPaise: number;
  feePaise: number;
}

export interface SlipBill {
  key: string;
  docRefno: string;
  kind: 'BILL' | 'CREDIT';
  /** BILL: cash + credits + discount + round-off on it; CREDIT: spent. */
  settledPaise: number;
  creditPaise: number;
  discountPaise: number;
  roundoffPaise: number;
}

export interface Slip {
  id: string;
  state: RcState;
  companyName: string;
  phoneNo: string;
  voucherNo: string | null;
  createdOn: string;
  customerName: string;
  docRefno: string | null;
  lines: SlipLine[];
  /** The money towards the receipt: the lines without their surcharges (the bills and on account get it). */
  receivedPaise: number;
  /** The surcharges paid on top, line by line (UPI 1% …), shown as their own lines. */
  surcharges: { name: string; paise: number }[];
  /** What the customer paid: every payment line plus its surcharge (VK Nex's avh_doc_amount, Σ td_amount). */
  totalPaise: number;
  bills: SlipBill[];
  /** True: the bills as VK Nex applied them; false: as planned on the phone. */
  posted: boolean;
  onAccountPaise: number | null;
  /** Net due for the shop in this company now, as the phone has it. */
  balancePaise: number;
  collector: string | null;
  remarks: string | null;
}

/** One of this phone's receipts as a slip (Saved, Receipt detail, Share). null until it loads, or when it is gone. */
export function useSlip(id: string): { slip: Slip | null; loaded: boolean; raw: ReturnType<typeof useRaw> } {
  const raw = useRaw(id);
  const { r, lines, allocs, companies } = raw;
  const plan = useReceiptPlan(r?.avhPartyId ?? '', r?.avhCompanyId ?? '');
  const userId = useAppSelector((st) => st.session.session?.userId ?? null);
  const me = useMemo(() => readMe(userId), [userId]);
  const slip = useMemo((): Slip | null => {
    if (!r) return null;
    const postedRows = allocs.filter((a) => a.ralSource === 'POSTED');
    // VK Nex's rows once it answered with them. None posted but changes noted (adjusted): it put
    // nothing on the planned bills (paid in the office meanwhile), so the plan is not shown as done.
    const vkNexApplied = postedRows.length > 0 || (!r.appPendingUpload && !!r.appAdjusted);
    const rows = vkNexApplied ? postedRows : allocs.filter((a) => a.ralSource === 'PLANNED');
    const money = savedReceiptMoney(lines.map((l) => ({ amount: l.tdAmount, surcharge: l.tdSurchargeAmt })));
    return {
      id: r.avhClientUuid,
      state: rcState(r),
      companyName: companies.find((c) => c.id === r.avhCompanyId)?.name ?? '',
      phoneNo: r.avhUsrRefno,
      voucherNo: r.avhVoucherRefno,
      createdOn: r.avhCreatedOn,
      customerName: r.appPartyName,
      docRefno: r.avhDocRefno,
      lines: lines.map((l) => {
        const fee = amountPaise(l.tdSurchargeAmt ?? '');
        const bank = [l.tdBankName, l.appChequeBranch].filter(Boolean).join(', ');
        return {
          name: l.appTenderName,
          details: [l.tdTenderTypeId === TENDER_TYPE.BANK ? l.tdTransferType : null, l.tdRefNo, l.tdTenderTypeId === TENDER_TYPE.CHEQUE ? bank : null].filter(Boolean).join(' · '),
          amountPaise: amountPaise(l.tdAmount) - fee,
          feePaise: fee,
        };
      }),
      receivedPaise: money.receivedPaise,
      surcharges: lines.filter((l) => amountPaise(l.tdSurchargeAmt ?? '') > 0).map((l) => ({ name: l.appTenderName, paise: amountPaise(l.tdSurchargeAmt ?? '') })),
      totalPaise: money.totalPaise,
      bills: rows.map((a) => {
        const cash = amountPaise(a.ralAmount);
        const credit = amountPaise(a.ralCredit);
        const discount = amountPaise(a.ralDiscount);
        const roundoff = amountPaise(a.ralRoundoff);
        return {
          key: a.ralId,
          docRefno: a.appDocRefno ?? '',
          kind: a.ralKind === 'CREDIT' ? 'CREDIT' : 'BILL',
          settledPaise: a.ralKind === 'CREDIT' ? cash : cash + credit + discount + roundoff,
          creditPaise: credit,
          discountPaise: discount,
          roundoffPaise: roundoff,
        };
      }),
      posted: vkNexApplied,
      onAccountPaise: r.appOnAccount === null ? null : amountPaise(r.appOnAccount),
      balancePaise: Math.max(0, plan.outstandingPaise - plan.creditsHeldPaise),
      collector: me.employeeName,
      remarks: r.avhRemarks,
    };
  }, [r, lines, allocs, companies, plan.outstandingPaise, plan.creditsHeldPaise, me]);
  return { slip, loaded: raw.loaded, raw };
}

function useRaw(id: string) {
  const { data: rs, updatedAt } = useLiveQuery(receiptQuery(id), [id]);
  const { data: lines } = useLiveQuery(receiptLinesQuery(id), [id]);
  const { data: allocs } = useLiveQuery(receiptAllocsQuery(id), [id]);
  const { data: companies } = useLiveQuery(companiesQuery());
  return { r: rs[0], lines, allocs, companies, loaded: !!updatedAt };
}

/** The slip as text, for Share (WhatsApp …): what the card shows, line by line. */
export function slipText(s: Slip, t: TFunction, names: DateNames): string {
  const when = `${formatDay(s.createdOn.slice(0, 10), names)}, ${hhmm(s.createdOn)}`;
  const bills = s.bills.filter((b) => b.kind === 'BILL');
  const incl = inclText(s, t);
  return [
    s.companyName,
    t('receipt.slip.heading'),
    s.voucherNo ? `${t('receipt.slip.vkNexNo')} ${s.voucherNo}` : null,
    `${t('receipt.slip.phoneNo')} ${s.phoneNo}`,
    `${t('receipt.slip.date')} ${when}`,
    `${t('receipt.slip.from')} ${s.customerName}`,
    s.docRefno ? `${t('receipt.slip.shopNo')} ${s.docRefno}` : null,
    '',
    ...s.lines.map((l) => `${[l.name, l.details].filter(Boolean).join(' ')}  ${formatAmount(l.amountPaise)}`),
    ...s.surcharges.map((f) => `${t('receipt.surchargeOf', { name: f.name })}  ${formatAmount(f.paise)}`),
    `${t('receipt.slip.total')} ${formatAmount(s.totalPaise)}`,
    amountInWords(s.totalPaise),
    '',
    ...bills.map((b) => `${b.docRefno}  ${formatAmount(b.settledPaise)}`),
    incl,
    s.onAccountPaise ? `${t('receipt.leftOnAccount')} ${formatAmount(s.onAccountPaise)}` : null,
    `${t('receipt.slip.balance')} ${formatAmount(s.balancePaise)}`,
    '',
    [s.collector ? t('receipt.slip.collector', { name: s.collector }) : null, t('receipt.slip.realisation')].filter(Boolean).join(' · '),
    s.state === 'posted' ? null : t('receipt.slip.notInVkNex'),
  ]
    .filter((x) => x !== null)
    .join('\n');
}

/**
 * What the bills' figures hold beside this receipt's money: credits spent, discount and round-off
 * (null when none). Then the bills, less these, plus on account come to the money received.
 */
function inclText(s: Slip, t: TFunction): string | null {
  const b = settledBreakdown(s.bills);
  const parts = [
    b.creditsPaise > 0 ? t('receipt.slip.inclCredits', { amount: formatAmount(b.creditsPaise) }) : null,
    b.discountPaise > 0 ? t('receipt.slip.inclDiscount', { amount: formatAmount(b.discountPaise) }) : null,
    b.roundoffPaise > 0 ? t('receipt.slip.inclRoundoff', { amount: formatAmount(b.roundoffPaise) }) : null,
  ].filter(Boolean);
  return parts.length ? t('receipt.slip.incl', { parts: parts.join(' · ') }) : null;
}

/** The receipt slip as a card (Saved, Receipt detail). */
export function ReceiptSlip({ slip: s }: { slip: Slip }) {
  const { t } = useTranslation();
  const names = useDateNames();
  const bills = s.bills.filter((b) => b.kind === 'BILL');
  const incl = inclText(s, t);
  return (
    <View style={st.slip} accessible accessibilityLabel={slipText(s, t, names)}>
      <Text style={st.company}>{s.companyName}</Text>
      <Text style={st.heading}>{t('receipt.slip.heading')}</Text>
      <View style={st.rule} />
      {s.voucherNo ? <Pair label={t('receipt.slip.vkNexNo')} value={s.voucherNo} /> : null}
      <Pair label={t('receipt.slip.phoneNo')} value={s.phoneNo} />
      <Pair label={t('receipt.slip.date')} value={`${formatDay(s.createdOn.slice(0, 10), names)}, ${hhmm(s.createdOn)}`} />
      <Pair label={t('receipt.slip.from')} value={s.customerName} />
      {s.docRefno ? <Pair label={t('receipt.slip.shopNo')} value={s.docRefno} /> : null}
      <View style={st.rule} />
      {s.lines.map((l, i) => (
        <Pair key={i} label={[l.name, l.details].filter(Boolean).join(' ')} value={formatAmount(l.amountPaise)} />
      ))}
      {s.surcharges.map((f, i) => (
        <Pair key={`fee${i}`} label={t('receipt.surchargeOf', { name: f.name })} value={formatAmount(f.paise)} />
      ))}
      <Pair label={t('receipt.slip.total')} value={formatAmount(s.totalPaise)} strong />
      <Text style={st.words}>{amountInWords(s.totalPaise)}</Text>
      {bills.length || s.onAccountPaise ? <View style={st.rule} /> : null}
      {bills.map((b) => (
        <Pair key={b.key} label={b.docRefno} value={formatAmount(b.settledPaise)} />
      ))}
      {incl ? <Text style={st.small}>{incl}</Text> : null}
      {s.onAccountPaise ? <Pair label={t('receipt.leftOnAccount')} value={formatAmount(s.onAccountPaise)} /> : null}
      <Pair label={t('receipt.slip.balance')} value={formatAmount(s.balancePaise)} strong />
      <View style={st.rule} />
      <Text style={st.small}>{[s.collector ? t('receipt.slip.collector', { name: s.collector }) : null, t('receipt.slip.realisation')].filter(Boolean).join(' · ')}</Text>
      {s.state !== 'posted' ? <Text style={[st.small, { color: '#92400E' }]}>{t('receipt.slip.notInVkNex')}</Text> : null}
    </View>
  );
}

function Pair({ label, value, strong, note }: { label: string; value: string; strong?: boolean; note?: string }) {
  return (
    <View style={st.pair}>
      <Text style={[st.pairLabel, strong && { fontWeight: '700', color: colors.text }]}>{label}</Text>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={[st.pairValue, strong && { fontWeight: '700' }]}>{value}</Text>
        {note ? <Text style={st.small}>{note}</Text> : null}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  slip: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg, gap: 6 },
  company: { fontSize: font.md, fontWeight: '700', color: colors.text, textAlign: 'center' },
  heading: { fontSize: font.sm, fontWeight: '700', letterSpacing: 2, color: colors.textLabel, textAlign: 'center' },
  rule: { height: 1, backgroundColor: colors.border, marginVertical: 4 },
  pair: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  pairLabel: { fontSize: font.sm, color: colors.textLabel, flexShrink: 1 },
  pairValue: { fontSize: font.sm, fontWeight: '600', color: colors.text },
  words: { fontSize: 12, fontStyle: 'italic', color: colors.textMuted },
  small: { fontSize: 12, color: colors.textMuted },
});
