import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/screen-header';
import { Button, TextField } from '@/components/ui';
import { useDateNames } from '@/components/use-date-names';
import { decimalInput, paiseText } from '@/features/orders/order-math';
import { billTyped } from '@/features/receipts/receipt-draft';
import { amountPaise } from '@/features/receipts/receipt-math';
import { typedCreditPaise, typedEntries } from '@/features/receipts/receipt-plan';
import { ppdPaise, ppdSlab, ROUNDOFF_MAX_PAISE, settle, type BillEntry } from '@/features/receipts/settle';
import { useReceiptPlan } from '@/features/receipts/use-receipt-plan';
import { formatDay } from '@/lib/date-range';
import { daysBetween, formatAmount } from '@/lib/money';
import { useAppDispatch, useAppSelector } from '@/store';
import { colors, font, radius, spacing } from '@/theme';

type Field = 'receive' | 'discount' | 'roundoff';

/**
 * Bill adjustment (canvas 5b, step 2a): one bill by hand, as a row of the desktop Receipt's grid —
 * receive, the early-payment discount (pre-filled from VK Nex's slab for today, lower or clear
 * only: D4) and round-off (paise only, up to ₹0.99: D5). Together they never pass what is
 * pending; a field is held back instead, as the desktop clamps the cell. Write-off stays in the
 * office (D6). Save keeps the bill as typed; the other bills still fill oldest first.
 */
export default function BillAdjustmentScreen() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const names = useDateNames();
  const dispatch = useAppDispatch();
  const draft = useAppSelector((st) => st.receiptDraft);
  const plan = useReceiptPlan(draft.customerId ?? '', draft.companyId ?? '');
  const bill = plan.byKey.get(key);
  const line = plan.settlement.bills.find((b) => b.key === key);
  const date = plan.date;
  const ppd = bill ? ppdPaise(bill, date) : 0;
  const slab = bill ? ppdSlab(bill.ppd, date) : null;

  // Starts from what the bill has now; a bill the fill left untouched starts cleared in full.
  // Worked out on every render until the first keystroke, because the open items arrive from
  // their live query a moment after the screen opens.
  const [edited, setEdited] = useState<Record<Field, string> | null>(null);
  const start = ((): Record<Field, string> => {
    const typed = draft.typedBills[key];
    // As settle() reads it: a discount above today's slab, or round-off above ₹0.99, cut back.
    if (typed)
      return {
        receive: typed.receive,
        discount: amountPaise(typed.discount) > ppd ? (ppd ? paiseText(ppd) : '') : typed.discount,
        roundoff: amountPaise(typed.roundoff) > ROUNDOFF_MAX_PAISE ? paiseText(ROUNDOFF_MAX_PAISE) : typed.roundoff,
      };
    if (!bill || !line) return { receive: '', discount: '', roundoff: '' };
    if (line.receivePaise + line.discountPaise > 0) return { receive: paiseText(line.receivePaise), discount: line.discountPaise ? paiseText(line.discountPaise) : '', roundoff: '' };
    const rest = Math.max(0, bill.pendingPaise - line.creditPaise);
    const disc = Math.min(ppd, rest);
    return { receive: rest - disc > 0 ? paiseText(rest - disc) : '', discount: disc ? paiseText(disc) : '', roundoff: '' };
  })();
  const entry = edited ?? start;
  const setEntry = (f: (e: Record<Field, string>) => Record<Field, string>) => setEdited((e) => f(e ?? start));

  const p: BillEntry = { receivePaise: amountPaise(entry.receive), discountPaise: amountPaise(entry.discount), roundoffPaise: amountPaise(entry.roundoff) };
  // The whole receipt again with this bill as typed: where the credits land, and what is left.
  const preview = settle({
    amountPaise: amountPaise(draft.amount),
    date,
    items: plan.items,
    typedBills: { ...typedEntries(draft.typedBills), [key]: p },
    typedCredits: typedCreditPaise(draft.typedCredits),
  }).bills.find((b) => b.key === key);

  if (!bill) {
    return (
      <View style={st.root}>
        <ScreenHeader title={t('receipt.billTitle')} backLabel={t('receipt.back')} />
        <Text style={st.gone}>{plan.ready ? t('receipt.billGone') : ''}</Text>
      </View>
    );
  }

  /** Types into one field, held back so receive + discount + round-off stay within pending. */
  const type = (f: Field, text: string) => {
    const v = decimalInput(text);
    const others = (f === 'receive' ? 0 : p.receivePaise) + (f === 'discount' ? 0 : p.discountPaise) + (f === 'roundoff' ? 0 : p.roundoffPaise);
    let cap = Math.max(0, bill.pendingPaise - others);
    if (f === 'discount') cap = Math.min(cap, ppd);
    if (f === 'roundoff') cap = Math.min(cap, ROUNDOFF_MAX_PAISE);
    setEntry((e) => ({ ...e, [f]: amountPaise(v) > cap ? paiseText(cap) : v }));
  };

  /** Clear bill: receive whatever the credits, discount and round-off leave. */
  const clearBill = () => {
    const credit = preview?.creditPaise ?? 0;
    const need = Math.max(0, bill.pendingPaise - p.discountPaise - p.roundoffPaise - credit);
    setEntry((e) => ({ ...e, receive: need ? paiseText(need) : '' }));
  };

  const save = () => {
    dispatch(billTyped({ key, entry: { receive: paiseText(p.receivePaise), discount: paiseText(p.discountPaise), roundoff: paiseText(p.roundoffPaise) } }));
    router.back();
  };
  const backToFill = () => {
    dispatch(billTyped({ key, entry: null }));
    router.back();
  };

  const days = daysBetween(bill.docDate, date);
  const sub = [
    t('receipt.billOn', { date: formatDay(bill.docDate, names) }),
    bill.dueDate ? t('receipt.dueOn', { date: formatDay(bill.dueDate, names).replace(/ \d{4}$/, '') }) : null,
    t('receipt.age', { count: days }),
  ]
    .filter(Boolean)
    .join(' · ');
  const left = preview?.leftPaise ?? bill.pendingPaise;
  const credit = preview?.creditPaise ?? 0;

  return (
    <View style={st.root}>
      <ScreenHeader title={bill.docRefno} subtitle={sub} backLabel={t('receipt.back')} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView contentContainerStyle={st.body} keyboardShouldPersistTaps="handled">
          <View style={st.cards}>
            <Card label={t('receipt.billAmt')} value={formatAmount(bill.billAmountPaise)} />
            <Card label={t('receipt.paid')} value={formatAmount(bill.paidPaise)} />
            <Card label={t('receipt.pending')} value={formatAmount(bill.pendingPaise)} color={colors.primary} />
          </View>
          {bill.pdcHeldPaise > 0 ? <Text style={st.note}>{t('receipt.pdcHeldNote', { amount: formatAmount(bill.pdcHeldPaise) })}</Text> : null}
          {credit > 0 ? <Text style={st.creditNote}>{t('receipt.creditsLand', { amount: formatAmount(credit) })}</Text> : null}

          <TextField label={t('receipt.receive')} value={entry.receive} onChangeText={(v) => type('receive', v)} keyboardType="decimal-pad" placeholder="0.00" selectTextOnFocus maxLength={12} />
          <TextField
            label={t('receipt.ppdDiscountField')}
            value={entry.discount}
            onChangeText={(v) => type('discount', v)}
            keyboardType="decimal-pad"
            placeholder="0.00"
            selectTextOnFocus
            maxLength={12}
          />
          <TextField label={t('receipt.roundoffField')} value={entry.roundoff} onChangeText={(v) => type('roundoff', v)} keyboardType="decimal-pad" placeholder="0.00" selectTextOnFocus maxLength={4} />
          <Text style={st.note}>
            {slab && ppd > 0
              ? t('receipt.ppdSuggests', { perc: slab.perc, amount: formatAmount(ppd), date: formatDay(slab.tillDate, names) })
              : t('receipt.noPpd')}{' '}
            {t('receipt.roundoffNote')}
          </Text>

          <View style={[st.left, left === 0 && { borderColor: '#86EFAC', backgroundColor: '#F0FDF4' }]} accessible accessibilityLabel={`${t('receipt.leftOnBill')}: ${formatAmount(left)}`}>
            <Text style={st.leftLabel}>{t('receipt.leftOnBill')}</Text>
            <Text style={[st.leftValue, { color: left === 0 ? '#166534' : colors.text }]}>
              {left === 0 ? t('receipt.leftCleared', { amount: formatAmount(0) }) : formatAmount(left)}
            </Text>
          </View>
          <Text style={st.note}>{t('receipt.billRules')}</Text>
          {draft.typedBills[key] ? (
            <Pressable accessibilityRole="button" onPress={backToFill} hitSlop={6} style={st.linkBtn}>
              <Text style={st.link}>{t('receipt.backToFill')}</Text>
            </Pressable>
          ) : null}
        </ScrollView>
        <View style={[st.footer, { paddingBottom: insets.bottom + spacing.lg }]}>
          <Button title={t('receipt.clearBill')} variant="outline" onPress={clearBill} style={{ flex: 1, height: 52 }} />
          <Button title={t('receipt.saveBill')} onPress={save} style={{ flex: 1, height: 52 }} />
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

function Card({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={st.card} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={st.cardLabel}>{label}</Text>
      <Text style={[st.cardValue, color ? { color } : null]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { padding: spacing.lg, gap: spacing.md },
  gone: { padding: spacing.xl, textAlign: 'center', fontSize: font.md, color: colors.textMuted },
  cards: { flexDirection: 'row', gap: spacing.sm },
  card: { flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md + 2, padding: 10, gap: 1 },
  cardLabel: { fontSize: 12, color: colors.textMuted },
  cardValue: { fontSize: font.md, fontWeight: '600', color: colors.text },
  note: { fontSize: 12.5, color: colors.textMuted, lineHeight: 18 },
  creditNote: { fontSize: 12.5, color: '#166534' },
  left: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: radius.md + 2, padding: spacing.md, backgroundColor: colors.surface },
  leftLabel: { fontSize: font.sm, color: colors.textLabel },
  leftValue: { fontSize: font.md, fontWeight: '700' },
  linkBtn: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  link: { fontSize: font.sm, fontWeight: '600', color: colors.primary },
  footer: { flexDirection: 'row', gap: spacing.sm, paddingTop: spacing.md, paddingHorizontal: spacing.lg, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
});
