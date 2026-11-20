import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/screen-header';
import { useDateNames } from '@/components/use-date-names';
import { decimalInput, paiseText, toPaise } from '@/features/orders/order-math';
import { customerName } from '@/features/orders/queries';
import { returnAdjustSet } from '@/features/returns/return-draft';
import { adjustProblem, planAdjust, returnEstimate, type AdjustBill } from '@/features/returns/return-math';
import { barStyles, returnStyles } from '@/features/returns/return-styles';
import { adjustBillsQuery, returnCustomerQuery } from '@/features/returns/queries';
import { formatDay } from '@/lib/date-range';
import { daysBetween, formatAmount, todayISO } from '@/lib/money';
import { useAppDispatch, useAppSelector } from '@/store';
import { colors, font, radius, spacing } from '@/theme';

const keyOf = (b: { billId: string; billAccYear: string }) => `${b.billId}|${b.billAccYear}`;

/**
 * Adjust against bills, step 4a (canvas 6b; the desktop's Adjust popup): the shop's open bills of
 * this branch from Sync, the bill the goods came on first, then oldest due. Adjust now is typed per
 * bill; Fill again (Alt+A) refills the rows not typed by hand. A row can't pass what its bill owes,
 * all rows can't pass the credit note, and what is not set off stays with the shop as credit.
 */
export default function ReturnAdjustScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const names = useDateNames();
  const dispatch = useAppDispatch();
  const d = useAppSelector((st) => st.returnDraft);
  const custId = d.customerId ?? '';
  const companyId = d.companyId ?? '';
  const today = todayISO();
  const { data: shop } = useLiveQuery(returnCustomerQuery(custId), [custId]);
  const { data: open } = useLiveQuery(adjustBillsQuery(custId, companyId), [custId, companyId]);
  const credit = returnEstimate(d.parts).totalPaise;
  const bills: AdjustBill[] = useMemo(
    () => open.map((b) => ({ billId: b.billId, billAccYear: b.billAccYear, refno: b.refno, pendingPaise: b.pendingPaise, isThisBill: !!d.bill && b.refno === d.bill.refno })),
    [open, d.bill],
  );
  const ordered = [...bills.filter((b) => b.isThisBill), ...bills.filter((b) => !b.isThisBill)];
  const meta = new Map(open.map((b) => [keyOf(b), b]));

  const start = () => {
    const typed = d.adjust ? new Map(d.adjust.map((r) => [keyOf(r), r.amountPaise])) : undefined;
    const plan = planAdjust(credit, bills, typed);
    return new Map(plan.rows.map((r) => [keyOf(r), paiseText(r.amountPaise)]));
  };
  const [amounts, setAmounts] = useState<Map<string, string>>(start);
  const [typed, setTyped] = useState<Set<string>>(() => new Set(d.adjust ? d.adjust.map(keyOf) : []));
  const paiseOf = (k: string) => toPaise(amounts.get(k) ?? '') ?? 0;
  const rows = ordered.map((b) => ({ billId: b.billId, billAccYear: b.billAccYear, refno: b.refno, amountPaise: paiseOf(keyOf(b)) }));
  const adjusted = rows.reduce((s, r) => s + r.amountPaise, 0);
  const problem = adjustProblem(rows, bills, credit);
  const balanceAfter = bills.reduce((s, b) => s + b.pendingPaise, 0) - adjusted;

  const fillAgain = () => {
    const keep = new Map([...typed].map((k) => [k, paiseOf(k)]));
    const plan = planAdjust(credit, bills, keep);
    setAmounts(new Map(plan.rows.map((r) => [keyOf(r), paiseText(r.amountPaise)])));
  };
  const clear = () => {
    setAmounts(new Map(ordered.map((b) => [keyOf(b), '0.00'])));
    setTyped(new Set(ordered.map(keyOf)));
  };
  const save = () => {
    if (problem === 'overBill') return Alert.alert(t('sr.adjust.problemTitle'), t('sr.adjust.overBill'));
    if (problem === 'overCredit') return Alert.alert(t('sr.adjust.problemTitle'), t('sr.adjust.overCredit', { amount: formatAmount(credit) }));
    dispatch(returnAdjustSet(rows));
    router.back();
  };
  const useVkPlan = () => {
    dispatch(returnAdjustSet(null));
    router.back();
  };

  return (
    <View style={st.root}>
      <ScreenHeader title={t('sr.adjust.title')} subtitle={shop[0] ? customerName(shop[0]) : undefined} backLabel={t('sr.back')} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView contentContainerStyle={st.body} keyboardShouldPersistTaps="handled">
          <View style={st.totals}>
            <Total label={t('sr.adjust.creditNote')} value={formatAmount(credit)} />
            <Total label={t('sr.adjust.adjusted')} value={formatAmount(adjusted)} tone="#1D4ED8" />
            <Total label={t('sr.adjust.leftCredit')} value={formatAmount(Math.max(0, credit - adjusted))} />
          </View>
          <Text style={st.hint}>{t('sr.adjust.note')}</Text>
          <View style={st.listHead}>
            <Text style={st.h2}>{t('sr.adjust.openBills', { n: ordered.length })}</Text>
            <View style={{ flexDirection: 'row' }}>
              <Pressable accessibilityRole="button" onPress={fillAgain} style={st.textBtn}>
                <Text style={st.textBtnMain}>{t('sr.adjust.fillAgain')}</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={clear} style={st.textBtn}>
                <Text style={st.textBtnQuiet}>{t('sr.items.clear')}</Text>
              </Pressable>
            </View>
          </View>
          {ordered.map((b) => {
            const k = keyOf(b);
            const m = meta.get(k);
            const age = m ? daysBetween(m.date, today) : 0;
            const overdue = !!m?.dueDate && m.dueDate < today;
            const amount = paiseOf(k);
            return (
              <View key={k} style={[st.bill, b.isThisBill && st.billThis]}>
                <View style={st.between}>
                  <Text style={st.billNo}>{b.refno}</Text>
                  {b.isThisBill ? (
                    <Text style={[st.chip, st.chipThis]}>{t('sr.adjust.thisBill')}</Text>
                  ) : overdue ? (
                    <Text style={[st.chip, st.chipLate]}>{t('sr.adjust.overdue', { days: age })}</Text>
                  ) : (
                    <Text style={st.small}>{t('sr.start.days', { count: age })}</Text>
                  )}
                </View>
                <Text style={st.small}>
                  {[m ? formatDay(m.date, names).replace(/ \d{4}$/, '') : null, m?.dueDate ? t('sr.adjust.dueOn', { date: formatDay(m.dueDate, names).replace(/ \d{4}$/, '') }) : null, t('sr.adjust.dueNow', { amount: formatAmount(b.pendingPaise) })]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
                <View style={st.amountRow}>
                  <Text style={st.label}>{t('sr.adjust.adjustNow')}</Text>
                  <TextInput
                    value={amounts.get(k) ?? ''}
                    onChangeText={(v) => {
                      setAmounts((a) => new Map(a).set(k, decimalInput(v)));
                      setTyped((s) => new Set(s).add(k));
                    }}
                    keyboardType="decimal-pad"
                    accessibilityLabel={t('sr.adjust.adjustNowFor', { bill: b.refno })}
                    style={[st.amountInput, amount > b.pendingPaise && { borderColor: colors.danger }]}
                  />
                </View>
                <Text style={[st.small, { textAlign: 'right' }]}>{t('sr.adjust.dueAfter', { amount: formatAmount(Math.max(0, b.pendingPaise - amount)) })}</Text>
              </View>
            );
          })}
          {ordered.length === 0 ? <Text style={st.empty}>{t('sr.review.noOpenBills')}</Text> : null}
          <Pressable accessibilityRole="button" onPress={useVkPlan} style={st.vkPlan}>
            <Text style={st.textBtnMain}>{t('sr.adjust.useVkPlan')}</Text>
          </Pressable>
        </ScrollView>
        <View style={[barStyles.bar, { paddingBottom: insets.bottom + spacing.lg }]}>
          <View style={{ flex: 1, gap: 1 }}>
            <Text style={barStyles.barSmall}>{t('sr.adjust.balanceAfter')}</Text>
            <Text style={barStyles.barTotal}>{formatAmount(balanceAfter)}</Text>
          </View>
          <Pressable accessibilityRole="button" onPress={save} style={({ pressed }) => [barStyles.barBtn, { minWidth: 130 }, pressed && { opacity: 0.85 }]}>
            <Text style={barStyles.barBtnText}>{t('sr.line.save')}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

function Total({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <View style={{ flex: 1, gap: 2 }} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={st.small}>{label}</Text>
      <Text style={[st.totalValue, tone ? { color: tone } : null]}>{value}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  ...returnStyles,
  totals: { flexDirection: 'row', gap: spacing.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md + 2 },
  totalValue: { fontSize: font.md, fontWeight: '600', color: colors.text },
  listHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  h2: { fontSize: font.md, fontWeight: '600', color: colors.text },
  textBtn: { minHeight: 40, paddingHorizontal: 10, justifyContent: 'center' },
  textBtnMain: { fontSize: font.sm, fontWeight: '600', color: colors.primary },
  textBtnQuiet: { fontSize: font.sm, color: colors.textMuted },
  bill: { gap: 8, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md + 2, padding: spacing.md },
  billThis: { borderColor: '#1D4ED8', borderWidth: 1.5 },
  billNo: { fontSize: font.md, fontWeight: '600', color: colors.text },
  chipThis: { backgroundColor: '#FEE2E2', color: '#991B1B' },
  chipLate: { backgroundColor: '#FEE2E2', color: '#B91C1C' },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { fontSize: font.sm, color: colors.textLabel },
  amountInput: { flex: 1, minHeight: 44, borderWidth: 1, borderColor: colors.inputBorder, borderRadius: radius.md, paddingHorizontal: 10, fontSize: 16, fontWeight: '600', textAlign: 'right', color: colors.text },
  vkPlan: { alignSelf: 'center', minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.md },
  empty: { textAlign: 'center', fontSize: font.md, color: colors.textMuted, padding: spacing.xl },
});
