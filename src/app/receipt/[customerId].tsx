import Ionicons from '@expo/vector-icons/Ionicons';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { router, useLocalSearchParams, usePreventRemove } from 'expo-router';
import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/screen-header';
import { Button } from '@/components/ui';
import { useDateNames } from '@/components/use-date-names';
import { companiesQuery } from '@/features/company/company';
import { decimalInput, paiseText } from '@/features/orders/order-math';
import { asOfText } from '@/features/orders/order-status';
import { customerName, orderCustomerQuery } from '@/features/orders/queries';
import { NoCollectionButton } from '@/features/receipts/no-collection-button';
import { creditTyped, handEntriesCleared, receiptAmountTyped, receiptCleared, receiptStarted } from '@/features/receipts/receipt-draft';
import { amountPaise } from '@/features/receipts/receipt-math';
import { typedCreditPaise, typedEntries, type ReceiptItem } from '@/features/receipts/receipt-plan';
import { cashToClearUpTo, ppdSlab, type BillLine, type CreditLine } from '@/features/receipts/settle';
import { readMe } from '@/features/receipts/queries';
import { useReceiptPlan } from '@/features/receipts/use-receipt-plan';
import { formatDay } from '@/lib/date-range';
import { daysBetween, formatAmount } from '@/lib/money';
import { useAppDispatch, useAppSelector } from '@/store';
import { colors, font, radius, spacing } from '@/theme';

/**
 * Receipt · dues and amount (canvas 5b, step 2): the shop's held credits and open bills in one
 * company, as of the last Sync, in VK Nex's order; the amount received; and how it settles them
 * by the desktop Receipt's rules: credits spent first, bills typed by hand kept, the rest of the
 * cash filling bills oldest first with their early-payment discount, and what is left on account.
 * A bill opens Bill adjustment. Next goes to Payment. A receipt needs money: credits alone are
 * spent with the next money taken (VK Nex refuses a receipt with no payment line).
 */
export default function ReceiptDuesScreen() {
  const { customerId, companyId, billKey } = useLocalSearchParams<{ customerId: string; companyId: string; billKey?: string }>();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const names = useDateNames();
  const dispatch = useAppDispatch();
  const draft = useAppSelector((st) => st.receiptDraft);

  const { data: found } = useLiveQuery(orderCustomerQuery(customerId), [customerId]);
  const { data: companyList } = useLiveQuery(companiesQuery());
  const c = found[0];
  const plan = useReceiptPlan(customerId, companyId);
  const { settlement: sum, items, mine, date } = plan;

  useEffect(() => {
    dispatch(receiptStarted({ customerId, companyId }));
  }, [dispatch, customerId, companyId]);

  // Opened from a bill on the Ledger: that bill's adjustment opens on top, once, when the plan has
  // it (a bill this phone's unsent receipts already clear stays on Dues).
  const billOpened = useRef(false);
  useEffect(() => {
    if (!billKey || billOpened.current || !mine || !plan.ready) return;
    billOpened.current = true;
    if (plan.byKey.get(billKey)?.pendingPaise) router.push({ pathname: '/receipt/bill', params: { key: billKey } });
  }, [billKey, mine, plan.ready, plan.byKey]);

  // Leaving with something typed asks first. Save clears the draft before it closes this screen.
  const typedAnything = mine && (amountPaise(draft.amount) > 0 || Object.keys(draft.typedBills).length > 0 || Object.keys(draft.typedCredits).length > 0);
  usePreventRemove(typedAnything, ({ repeat }) => {
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

  const credits = items.filter((i) => i.kind !== 'BILL');
  const bills = items.filter((i) => i.kind === 'BILL');
  const lineOf = useMemo(() => new Map(sum.bills.map((b) => [b.key, b])), [sum.bills]);
  const creditOf = useMemo(() => new Map(sum.credits.map((b) => [b.key, b])), [sum.credits]);
  const overdue = bills.filter((b) => b.dueDate && b.dueDate < date);
  const oldestDays = bills.reduce((m, b) => Math.max(m, daysBetween(b.docDate, date)), 0);
  const netDue = Math.max(0, plan.outstandingPaise - plan.creditsHeldPaise);
  const hand = mine && (Object.keys(draft.typedBills).length > 0 || Object.keys(draft.typedCredits).length > 0);
  const companyName = companyList.find((x) => x.id === companyId)?.name;
  // A login without the Post right on Receipt (menu 99), as the last Sync read it: the receipt can
  // still be taken, but VK Nex sends it back until the office gives the right.
  const sessionUserId = useAppSelector((st) => st.session.session?.userId ?? null);
  const noPostRight = readMe(sessionUserId).receiptPost === false;

  // Quick amounts: what clears the overdue bills, one bill more, and everything (credits and
  // discounts taken first, bills typed by hand as typed).
  const chips = (() => {
    if (!bills.length) return [];
    const input = { date, items, typedBills: mine ? typedEntries(draft.typedBills) : undefined, typedCredits: mine ? typedCreditPaise(draft.typedCredits) : undefined };
    const out: { label: string; paise: number }[] = [];
    if (overdue.length > 0 && overdue.length < bills.length) {
      const p = cashToClearUpTo(input, overdue[overdue.length - 1]!.key);
      out.push({ label: t('receipt.chipOverdue', { amount: formatAmount(p) }), paise: p });
    }
    const n = overdue.length + 1;
    if (n < bills.length) {
      const p = cashToClearUpTo(input, bills[n - 1]!.key);
      out.push({ label: t('receipt.chipBills', { count: n, amount: formatAmount(p) }), paise: p });
    }
    const all = cashToClearUpTo(input, bills[bills.length - 1]!.key);
    out.push({ label: t('receipt.chipAll', { amount: formatAmount(all) }), paise: all });
    return out.filter((x) => x.paise > 0);
  })();

  const setAmount = (paise: number) => dispatch(receiptAmountTyped(paise > 0 ? paiseText(paise) : ''));
  const clearAll = () => {
    dispatch(receiptAmountTyped(''));
    dispatch(handEntriesCleared());
  };

  const next = () => {
    if (sum.problem === 'nothing') return Alert.alert(t('receipt.problems.noAmount'));
    if (sum.problem === 'overPending') return Alert.alert(t('receipt.problems.overPending'));
    if (sum.problem === 'typedOverAmount') {
      const need = sum.bills.reduce((s, b) => s + (b.typed ? b.receivePaise : 0), 0);
      return Alert.alert(t('receipt.problems.typedOverTitle'), t('receipt.problems.typedOver', { typed: formatAmount(need), amount: formatAmount(sum.receivedPaise) }), [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('receipt.makeIt', { amount: formatAmount(need) }), onPress: () => setAmount(need) },
      ]);
    }
    const go = () => router.push('/receipt/payment');
    if (sum.onAccountPaise <= 0) return go();
    Alert.alert(t('receipt.advanceTitle', { amount: formatAmount(sum.onAccountPaise) }), t('receipt.advanceText', { name: c ? customerName(c) : '' }), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('receipt.keepAdvance'), onPress: go },
    ]);
  };

  const sortText = plan.settings?.billSort === 'BILL_DATE' ? t('receipt.sortBillDate') : t('receipt.sortDueDate');
  const asOf = plan.syncedOn ? asOfText(plan.syncedOn, names, t('so.today')) : null;
  const onBills = sum.bills.reduce((s, b) => s + b.receivePaise, 0);

  return (
    <View style={st.root}>
      <ScreenHeader
        title={t('receipt.title')}
        subtitle={[c ? customerName(c) : '', companyName].filter(Boolean).join(' · ')}
        backLabel={t('receipt.back')}
        right={<NoCollectionButton customerId={customerId} companyId={companyId} />}
      />

      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView contentContainerStyle={st.body} keyboardShouldPersistTaps="handled">
          <Text style={st.asOf}>{asOf ? t('receipt.asOfSort', { when: asOf, sort: sortText }) : t('receipt.notSynced')}</Text>
          {noPostRight ? (
            <View style={st.warnBox}>
              <Ionicons name="alert-circle-outline" size={18} color="#92400E" />
              <Text style={st.warnText}>{t('receipt.noPostRight')}</Text>
            </View>
          ) : null}

          <View style={st.card}>
            <Row label={t('receipt.outstandingLabel')} value={formatAmount(plan.outstandingPaise)} />
            {plan.creditsHeldPaise > 0 ? <Row label={t('receipt.creditsHeld')} value={`−${formatAmount(plan.creditsHeldPaise)}`} color="#166534" /> : null}
            <View style={st.rule} />
            <Row label={t('receipt.netDue')} value={formatAmount(netDue)} strong />
            {bills.length ? (
              <Text style={[st.small, overdue.length ? { color: colors.danger } : null]}>
                {overdue.length ? t('receipt.overdueLine', { count: overdue.length, days: oldestDays }) : t('receipt.noOverdue', { days: oldestDays })}
              </Text>
            ) : null}
          </View>

          <View style={{ gap: 6 }}>
            <Text style={st.label}>{t('receipt.amountReceived')}</Text>
            <View style={st.amountBox}>
              <Text style={st.rupee}>₹</Text>
              <TextInput
                value={mine ? draft.amount : ''}
                onChangeText={(v) => dispatch(receiptAmountTyped(decimalInput(v)))}
                placeholder="0.00"
                placeholderTextColor={colors.textMuted}
                keyboardType="decimal-pad"
                accessibilityLabel={t('receipt.amountReceived')}
                selectTextOnFocus
                maxLength={12}
                style={st.amountInput}
              />
            </View>
            {chips.length ? (
              <View style={st.chips}>
                {chips.map((ch) => (
                  <Pressable key={ch.label} accessibilityRole="button" onPress={() => setAmount(ch.paise)} style={({ pressed }) => [st.chip, pressed && { opacity: 0.85 }]}>
                    <Text style={st.chipText}>{ch.label}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </View>

          {credits.length ? (
            <View style={{ gap: spacing.sm }}>
              <View style={st.sectionHead}>
                <Text style={st.section} accessibilityRole="header">
                  {t('receipt.creditsFirst', { count: credits.length })}
                </Text>
                <Text style={st.small}>{t('receipt.asDesktop')}</Text>
              </View>
              {credits.map((cr) => (
                <CreditRow
                  key={cr.key}
                  item={cr}
                  line={creditOf.get(cr.key)}
                  typed={mine ? draft.typedCredits[cr.key] : undefined}
                  dateText={formatDay(cr.docDate, names).replace(/ \d{4}$/, '')}
                  onType={(v) => {
                    const p = amountPaise(v);
                    dispatch(creditTyped({ key: cr.key, amount: p > cr.pendingPaise ? paiseText(cr.pendingPaise) : v }));
                  }}
                />
              ))}
            </View>
          ) : null}

          <View style={{ gap: spacing.sm }}>
            <View style={st.sectionHead}>
              <Text style={st.section} accessibilityRole="header">
                {t('receipt.billsCount', { count: bills.length })}
              </Text>
              <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                {hand ? <SmallBtn label={t('receipt.fillOldest')} onPress={() => dispatch(handEntriesCleared())} /> : null}
                {mine && (amountPaise(draft.amount) > 0 || hand) ? <SmallBtn label={t('receipt.clear')} onPress={clearAll} /> : null}
              </View>
            </View>
            {plan.ready && !bills.length ? <Text style={st.empty}>{t('receipt.noBillsHere')}</Text> : null}
            {bills.map((b) => (
              <BillCard
                key={b.key}
                bill={b}
                line={lineOf.get(b.key)}
                date={date}
                dateText={(iso) => formatDay(iso, names).replace(/ \d{4}$/, '')}
                onPress={() => router.push({ pathname: '/receipt/bill', params: { key: b.key } })}
              />
            ))}
          </View>
        </ScrollView>

        <View style={[st.footer, { paddingBottom: insets.bottom + spacing.lg }]}>
          <View style={st.footRow}>
            <Text style={st.small}>{t('receipt.onBillsLine', { bills: formatAmount(onBills), account: formatAmount(sum.onAccountPaise) })}</Text>
            <Text style={st.footAmount}>{formatAmount(sum.receivedPaise)}</Text>
          </View>
          {sum.problem === 'typedOverAmount' ? <Text style={st.error}>{t('receipt.problems.typedOverShort')}</Text> : null}
          <Button title={t('receipt.nextPayment')} onPress={next} style={{ height: 52 }} />
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

function Row({ label, value, color, strong }: { label: string; value: string; color?: string; strong?: boolean }) {
  return (
    <View style={st.row} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={[st.rowLabel, strong && { fontWeight: '600', color: colors.text }]}>{label}</Text>
      <Text style={[st.rowValue, color ? { color } : null, strong && { fontSize: font.lg }]}>{value}</Text>
    </View>
  );
}

function SmallBtn({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} hitSlop={6} style={({ pressed }) => [st.smallBtn, pressed && { opacity: 0.8 }]}>
      <Text style={st.smallBtnText}>{label}</Text>
    </Pressable>
  );
}

/** A held credit (advance, sales return …): spent first; the salesman may lower it. */
function CreditRow({ item, line, typed, dateText, onType }: { item: ReceiptItem; line: CreditLine | undefined; typed: string | undefined; dateText: string; onType: (v: string) => void }) {
  const { t } = useTranslation();
  const used = line?.usedPaise ?? 0;
  return (
    <View style={st.credit}>
      <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
        <Text style={st.billNo} numberOfLines={1}>
          {t(`receipt.creditKinds.${item.kind}`)} {item.docRefno}
        </Text>
        <Text style={st.small}>{t('receipt.creditMeta', { date: dateText, amount: formatAmount(item.pendingPaise) })}</Text>
      </View>
      <TextInput
        value={typed ?? paiseText(used)}
        onChangeText={(v) => onType(decimalInput(v))}
        keyboardType="decimal-pad"
        selectTextOnFocus
        maxLength={12}
        accessibilityLabel={t('receipt.creditUse', { name: item.docRefno })}
        style={st.creditInput}
      />
    </View>
  );
}

/** One open bill and how this receipt settles it. Tap: Bill adjustment. */
function BillCard({ bill, line, date, dateText, onPress }: { bill: ReceiptItem; line: BillLine | undefined; date: string; dateText: (iso: string) => string; onPress: () => void }) {
  const { t } = useTranslation();
  const days = daysBetween(bill.docDate, date);
  const overdue = !!bill.dueDate && bill.dueDate < date;
  const slab = ppdSlab(bill.ppd, date);
  const parts: string[] = [];
  if (line) {
    if (line.creditPaise > 0) parts.push(t('receipt.partCredits', { amount: formatAmount(line.creditPaise) }));
    if (line.receivePaise > 0) parts.push(t('receipt.partReceive', { amount: formatAmount(line.receivePaise) }));
    if (line.discountPaise > 0)
      parts.push(
        slab && line.discountPaise === line.ppdPaise
          ? t('receipt.partPpd', { perc: slab.perc, amount: formatAmount(line.discountPaise) })
          : t('receipt.partDiscount', { amount: formatAmount(line.discountPaise) }),
      );
    if (line.roundoffPaise > 0) parts.push(t('receipt.partRoundoff', { amount: formatAmount(line.roundoffPaise) }));
  }
  const touched = parts.length > 0;
  const cleared = touched && line!.leftPaise === 0;
  const meta = [dateText(bill.docDate), bill.dueDate ? t('receipt.dueOn', { date: dateText(bill.dueDate) }) : null, t('receipt.pendingAmt', { amount: formatAmount(bill.pendingPaise) })]
    .filter(Boolean)
    .join(' · ');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint={t('receipt.billHint')}
      onPress={onPress}
      style={({ pressed }) => [st.bill, cleared && st.billDone, pressed && { opacity: 0.9 }]}
    >
      <View style={st.billTop}>
        <Text style={st.billNo} numberOfLines={1}>
          {bill.docRefno}
        </Text>
        <Text style={[st.age, { color: overdue ? colors.danger : days > 30 ? '#92400E' : colors.textMuted }]}>
          {overdue ? t('receipt.ageOverdue', { count: days }) : t('receipt.age', { count: days })}
        </Text>
      </View>
      <Text style={st.small}>{meta}</Text>
      {touched ? (
        <View style={st.billBottom}>
          <Text style={[st.settle, { flex: 1 }]}>{parts.join(' + ')}</Text>
          {line!.typed ? <Text style={st.handTag}>{t('receipt.byHand')}</Text> : null}
          <Text style={[st.status, { color: cleared ? '#166534' : '#92400E' }]}>
            {cleared ? t('receipt.cleared') : t('receipt.leftOn', { amount: formatAmount(line!.leftPaise) })}
          </Text>
        </View>
      ) : slab && line && line.ppdPaise > 0 ? (
        <Text style={st.ppdHint}>{t('receipt.ppdIf', { perc: slab.perc, amount: formatAmount(line.ppdPaise), date: dateText(slab.tillDate) })}</Text>
      ) : null}
      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} style={st.chev} />
    </Pressable>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { padding: spacing.lg, gap: spacing.md + 2 },
  asOf: { fontSize: 12, color: colors.textMuted },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md + 2, gap: 6 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: spacing.sm },
  rowLabel: { fontSize: font.sm, color: colors.textLabel },
  rowValue: { fontSize: font.md, fontWeight: '600', color: colors.text },
  rule: { height: 1, backgroundColor: colors.border },
  small: { fontSize: 12.5, color: colors.textMuted },
  warnBox: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, backgroundColor: '#FFFBEB', borderWidth: 1, borderColor: '#FCD34D', borderRadius: radius.md + 2, padding: spacing.md },
  warnText: { flex: 1, fontSize: font.sm, lineHeight: 18, color: '#92400E' },
  label: { fontSize: font.sm, fontWeight: '500', color: colors.textLabel },
  amountBox: { flexDirection: 'row', alignItems: 'center', height: 56, borderWidth: 2, borderColor: colors.primary, borderRadius: radius.md + 2, paddingHorizontal: 13, backgroundColor: colors.surface, gap: 6 },
  rupee: { fontSize: font.xl, fontWeight: '700', color: colors.textMuted },
  amountInput: { flex: 1, height: '100%', fontSize: font.xl, fontWeight: '700', color: colors.text },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { minHeight: 36, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: 999, borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.surface },
  chipText: { fontSize: font.sm, fontWeight: '600', color: colors.primary },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  section: { fontSize: font.md, fontWeight: '600', color: colors.text },
  smallBtn: { minHeight: 32, justifyContent: 'center', paddingHorizontal: 10, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  smallBtnText: { fontSize: 12.5, fontWeight: '600', color: colors.primary },
  empty: { fontSize: font.sm, color: colors.textMuted, paddingVertical: spacing.sm },
  credit: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#F0FDF4', borderWidth: 1, borderColor: '#BBF7D0', borderRadius: radius.md + 2, paddingVertical: 10, paddingLeft: spacing.md + 2, paddingRight: 10 },
  creditInput: {
    width: 120,
    height: 44,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: radius.md,
    textAlign: 'right',
    paddingHorizontal: 10,
    fontSize: font.md,
    fontWeight: '600',
    color: colors.text,
    backgroundColor: colors.surface,
  },
  bill: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md + 2, paddingVertical: spacing.md, paddingLeft: spacing.md + 2, paddingRight: 30, gap: 4 },
  billDone: { borderColor: '#86EFAC' },
  billTop: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  billNo: { fontSize: 14, fontWeight: '600', color: colors.text, flexShrink: 1 },
  age: { fontSize: 12, fontWeight: '600' },
  billBottom: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 2 },
  settle: { fontSize: 12.5, color: colors.text },
  handTag: { fontSize: 11, fontWeight: '600', color: colors.primary, borderWidth: 1, borderColor: colors.primary, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1 },
  status: { fontSize: 12, fontWeight: '600' },
  ppdHint: { fontSize: 12, color: '#1E40AF', marginTop: 2 },
  chev: { position: 'absolute', right: 8, top: '50%', marginTop: -8 },
  footer: { paddingTop: spacing.md, paddingHorizontal: spacing.lg, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border, gap: spacing.sm },
  footRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  footAmount: { fontSize: font.lg, fontWeight: '700', color: colors.text },
  error: { fontSize: font.sm, color: colors.danger },
});
