import Ionicons from '@expo/vector-icons/Ionicons';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { router, useLocalSearchParams, usePreventRemove } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/screen-header';
import { Button } from '@/components/ui';
import { useDateNames } from '@/components/use-date-names';
import { decimalInput, paiseText, toPaise } from '@/features/orders/order-math';
import { customerName, orderCustomerQuery } from '@/features/orders/queries';
import { NoCollectionButton } from '@/features/receipts/no-collection-button';
import { billsNow, openBillsQuery, unsentReceiptsQuery, type ReceiptBill } from '@/features/receipts/queries';
import { receiptAmountTyped, receiptCleared, receiptStarted } from '@/features/receipts/receipt-draft';
import { autoAdjust, billState, daysFrom, payUpTo, receiptProblem, receiptSummary, type Allocation } from '@/features/receipts/receipt-math';
import { formatDay } from '@/lib/date-range';
import { formatAmount, todayISO } from '@/lib/money';
import { useAppDispatch, useAppSelector } from '@/store';
import { colors, font, radius, spacing } from '@/theme';

/**
 * Receipt (the Qt app's Receipt.qml): how much the shop paid, and how VK Nex will fill its open
 * bills with it, oldest first, when it takes the receipt (the phone does not choose bills). What
 * is left stays on account. Next opens Payment types.
 */
export default function ReceiptScreen() {
  const { customerId, companyId } = useLocalSearchParams<{ customerId: string; companyId: string }>();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const names = useDateNames();
  const dispatch = useAppDispatch();

  const { data: found } = useLiveQuery(orderCustomerQuery(customerId), [customerId]);
  const { data: all } = useLiveQuery(openBillsQuery(customerId), [customerId]);
  const { data: unsent } = useLiveQuery(unsentReceiptsQuery(customerId), [customerId]);
  const c = found[0];
  const draft = useAppSelector((st) => st.receiptDraft);

  useEffect(() => {
    dispatch(receiptStarted({ customerId, companyId }));
  }, [dispatch, customerId, companyId]);

  // Leaving with an amount typed asks first. Save receipt clears the draft before it closes this
  // screen, so it is not asked then.
  const mine = draft.customerId === customerId && draft.companyId === companyId;
  usePreventRemove(mine && (toPaise(draft.amount) ?? 0) > 0, ({ repeat }) => {
    Alert.alert(t('receipt.discardTitle'), t('receipt.discardText', { name: c ? customerName(c) : '' }), [
      { text: t('order.keep'), style: 'cancel' },
      {
        text: t('order.discard'),
        style: 'destructive',
        onPress: () => {
          dispatch(receiptCleared());
          repeat();
        },
      },
    ]);
  });

  const bills = useMemo(() => billsNow(all, unsent, companyId).filter((b) => b.pendingPaise > 0), [all, unsent, companyId]);
  const typed = mine ? (toPaise(draft.amount) ?? 0) : 0;
  const alloc = useMemo(() => autoAdjust(typed, bills), [typed, bills]);
  const sum = receiptSummary(typed, bills, alloc);
  const outstanding = bills.reduce((s, b) => s + b.pendingPaise, 0);
  const syncedOn = all.find((b) => b.companyId === companyId)?.syncedOn ?? null;
  const today = todayISO();

  const setAmount = (paise: number) => dispatch(receiptAmountTyped(paise > 0 ? paiseText(paise) : ''));
  const next = () => {
    if (receiptProblem(sum, bills, alloc)) return Alert.alert(t('receipt.problems.noAmount'));
    const go = () => router.push('/receipt/payment');
    if (sum.onAccountPaise <= 0) return go();
    Alert.alert(t('receipt.advanceTitle', { amount: formatAmount(sum.onAccountPaise) }), t('receipt.advanceText', { name: c ? customerName(c) : '' }), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('receipt.keepAdvance'), onPress: go },
    ]);
  };

  const subtitle = [c ? customerName(c) : '', t('receipt.outstanding', { amount: formatAmount(outstanding) })].filter(Boolean).join(' · ');

  return (
    <View style={st.root}>
      <ScreenHeader
        title={t('receipt.title')}
        subtitle={subtitle}
        backLabel={t('receipt.back')}
        right={<NoCollectionButton customerId={customerId} companyId={companyId} />}
      />

      <View style={st.top}>
        <View style={st.amountRow}>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={st.smallLabel}>{t('receipt.amount')}</Text>
            <TextInput
              value={mine ? draft.amount : ''}
              onChangeText={(v) => dispatch(receiptAmountTyped(decimalInput(v)))}
              placeholder="0.00"
              placeholderTextColor={colors.textMuted}
              keyboardType="decimal-pad"
              accessibilityLabel={t('receipt.amount')}
              selectTextOnFocus
              maxLength={12}
              style={st.amountInput}
            />
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: outstanding <= 0 }}
            disabled={outstanding <= 0}
            onPress={() => setAmount(outstanding)}
            style={({ pressed }) => [st.payAll, outstanding <= 0 && { opacity: 0.5 }, pressed && { opacity: 0.85 }]}
          >
            <Text style={st.payAllText}>{t('receipt.payAll')}</Text>
          </Pressable>
        </View>
        <View style={st.figures}>
          <Figure label={t('receipt.adjusted')} value={formatAmount(sum.adjustedPaise)} color={sum.adjustedPaise > 0 ? '#166534' : undefined} />
          <Figure label={t('receipt.onAccount')} value={formatAmount(sum.onAccountPaise)} />
          <Figure label={t('receipt.billsLeft')} value={t('receipt.billsLeftValue', { left: sum.stillPending, all: sum.billCount })} />
        </View>
      </View>

      <FlatList
        data={bills}
        keyExtractor={(b) => b.key}
        contentContainerStyle={st.list}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <Text style={st.asOf}>
            {syncedOn ? t('receipt.asOf', { date: formatDay(syncedOn.slice(0, 10), names) }) : t('receipt.notSynced')}
          </Text>
        }
        ListFooterComponent={bills.length ? <Text style={st.note}>{t('receipt.fillNote')}</Text> : undefined}
        renderItem={({ item, index }) => (
          <BillRow
            bill={item}
            alloc={alloc}
            today={today}
            dateText={(iso) => formatDay(iso, names)}
            onToggle={(on) => setAmount(on ? payUpTo(bills, index) : index > 0 ? payUpTo(bills, index - 1) : 0)}
          />
        )}
      />

      <View style={[st.footer, { paddingBottom: insets.bottom + spacing.lg }]}>
        <Button title={t('receipt.next')} onPress={next} disabled={sum.amountPaise <= 0} style={{ height: 52 }} />
      </View>
    </View>
  );
}

function Figure({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={{ flex: 1, gap: 1 }} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={st.smallLabel}>{label}</Text>
      <Text style={[st.figure, color ? { color } : null]}>{value}</Text>
    </View>
  );
}

function BillRow({
  bill,
  alloc,
  today,
  dateText,
  onToggle,
}: {
  bill: ReceiptBill;
  alloc: Allocation;
  today: string;
  dateText: (iso: string) => string;
  onToggle: (on: boolean) => void;
}) {
  const { t } = useTranslation();
  const state = billState(bill, alloc);
  const days = daysFrom(bill.docDate, today);
  const ageColor = days > 60 ? colors.danger : days > 30 ? '#92400E' : colors.textMuted;
  const meta =
    days > 0
      ? t('receipt.billMeta', { date: dateText(bill.docDate), days, amount: formatAmount(bill.billAmountPaise) })
      : t('receipt.billMetaToday', { date: dateText(bill.docDate), amount: formatAmount(bill.billAmountPaise) });
  const done = state.kind === 'completed';
  return (
    <View style={[st.bill, done && st.billDone]}>
      <View style={st.billTop}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={st.billNo}>{bill.docRefno}</Text>
          <Text style={[st.billMeta, { color: ageColor }]}>{meta}</Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 2 }}>
          <Text style={st.billNo}>{formatAmount(bill.pendingPaise)}</Text>
          {state.kind !== 'none' ? (
            <Text style={[st.status, { color: done ? '#166534' : '#92400E' }]}>
              {done ? t('receipt.completed') : t('receipt.partLeft', { amount: formatAmount(state.leftPaise) })}
            </Text>
          ) : null}
        </View>
      </View>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: done }}
        onPress={() => onToggle(!done)}
        hitSlop={4}
        style={st.check}
      >
        <Ionicons name={done ? 'checkbox' : 'square-outline'} size={22} color={done ? colors.primary : colors.inputBorder} />
        <Text style={st.checkText}>{t('receipt.payUpTo')}</Text>
      </Pressable>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  top: { backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: spacing.md + 2, paddingHorizontal: spacing.lg, gap: 10 },
  amountRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  smallLabel: { fontSize: 12, color: colors.textMuted },
  amountInput: {
    height: 52,
    borderWidth: 2,
    borderColor: colors.primary,
    borderRadius: radius.md + 2,
    paddingHorizontal: 13,
    fontSize: font.xl,
    fontWeight: '700',
    color: colors.text,
    backgroundColor: colors.surface,
  },
  payAll: { minHeight: 52, paddingHorizontal: 14, borderRadius: radius.md + 2, borderWidth: 1, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  payAllText: { fontSize: 14, fontWeight: '600', color: colors.primary },
  figures: { flexDirection: 'row', gap: spacing.sm },
  figure: { fontSize: font.md, fontWeight: '600', color: colors.text },
  list: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.sm },
  asOf: { fontSize: 12, color: colors.textMuted, marginBottom: 2 },
  note: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  bill: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md + 2, paddingVertical: spacing.md, paddingHorizontal: spacing.md + 2, gap: spacing.sm },
  billDone: { borderColor: '#86EFAC' },
  billTop: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  billNo: { fontSize: 14, fontWeight: '600', color: colors.text },
  billMeta: { fontSize: 12 },
  status: { fontSize: 12, fontWeight: '600' },
  check: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44, alignSelf: 'flex-start' },
  checkText: { fontSize: font.sm, color: colors.textLabel },
  footer: { paddingTop: spacing.md, paddingHorizontal: spacing.lg, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
});
