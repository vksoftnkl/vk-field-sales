import Ionicons from '@expo/vector-icons/Ionicons';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { router } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CalendarDialog } from '@/components/calendar-dialog';
import { ScreenHeader } from '@/components/screen-header';
import { Button, TextField } from '@/components/ui';
import { useDateNames } from '@/components/use-date-names';
import { companiesQuery } from '@/features/company/company';
import { customerName, orderCustomerQuery } from '@/features/orders/queries';
import { DOC_REF_MAX, readMe, RECEIPT_REMARKS_MAX, receiptBranchFor, sameAmountToday, saveReceipt } from '@/features/receipts/queries';
import { docRefTyped, receiptCleared, receiptRemarksTyped } from '@/features/receipts/receipt-draft';
import { amountPaise, TENDER_TYPE } from '@/features/receipts/receipt-math';
import { plannedRows } from '@/features/receipts/receipt-plan';
import { ppdSlab } from '@/features/receipts/settle';
import { useReceiptPlan } from '@/features/receipts/use-receipt-plan';
import { formatDay } from '@/lib/date-range';
import { formatAmount } from '@/lib/money';
import { store, useAppDispatch, useAppSelector } from '@/store';
import { getDeviceUid } from '@/sync/sync-store';
import { colors, font, radius, spacing } from '@/theme';

/**
 * Review receipt (canvas 5b, step 4): the desktop's balance rule as a card — received + credits +
 * discount = bills settled + on account — the bills it settles, and the receipt's details: date
 * (always today, D7), collector (the login's employee, D8), the shop's own receipt no. and date
 * (optional, D10) and narration. A warning, never a block, when the same amount was already taken
 * from the shop today. Save receipt confirms, keeps it on the phone for the next Sync and shows
 * the slip.
 */
export default function ReviewReceiptScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const names = useDateNames();
  const dispatch = useAppDispatch();
  const draft = useAppSelector((st) => st.receiptDraft);
  const userId = useAppSelector((st) => st.session.session?.userId ?? '');
  const customerId = draft.customerId ?? '';
  const companyId = draft.companyId ?? '';
  const { data: found } = useLiveQuery(orderCustomerQuery(customerId), [customerId]);
  const { data: companyList } = useLiveQuery(companiesQuery());
  const plan = useReceiptPlan(customerId, companyId);
  const { settlement: sum, byKey, date } = plan;
  const c = found[0];
  const me = useMemo(() => readMe(userId), [userId]);
  const [calendar, setCalendar] = useState(false);
  const [saving, setSaving] = useState(false);
  const saved = useRef(false);

  const companyName = companyList.find((x) => x.id === companyId)?.name ?? '';
  const settled = sum.bills.filter((b) => b.receivePaise + b.creditPaise + b.discountPaise + b.roundoffPaise > 0);
  const leftBills = sum.bills.filter((b) => b.leftPaise > 0);
  const leftPaise = leftBills.reduce((s, b) => s + b.leftPaise, 0);
  const usedCredits = sum.credits.filter((cr) => cr.usedPaise > 0);
  const creditKinds = [...new Set(usedCredits.map((cr) => byKey.get(cr.key)?.kind).filter(Boolean))].map((k) => t(`receipt.creditShort.${k}`)).join(' + ');
  const modes = draft.lines.map((l) => l.name.toLocaleLowerCase()).join(' + ');
  const same = useMemo(() => (c ? sameAmountToday(customerId, companyId, sum.receivedPaise, draft.editingId) : 0), [c, customerId, companyId, sum.receivedPaise, draft.editingId]);
  const noCollector = !me.employeeId;
  const collectorNeeded = !!plan.settings?.salesmanMandatory;

  const doSave = () => {
    const d = store.getState().receiptDraft;
    if (saved.current || !c || !d.customerId || !d.companyId) return;
    setSaving(true);
    try {
      const { id } = saveReceipt(
        {
          customerId: d.customerId,
          customerName: customerName(c),
          companyId: d.companyId,
          branchId: receiptBranchFor(d.companyId),
          amountPaise: sum.receivedPaise,
          onAccountPaise: sum.onAccountPaise,
          lines: d.lines,
          remarks: d.remarks,
          docRefno: d.docRefno,
          docDate: d.docDate,
          plan: plannedRows(sum, plan.items),
          hadItems: plan.items.length > 0,
          editingId: d.editingId,
        },
        userId,
        getDeviceUid(),
      );
      saved.current = true;
      const custId = d.customerId;
      const edited = d.editingId !== null;
      // Cleared first, and the screens closed a frame later, once Receipt has drawn itself
      // without an amount: then it lets itself be closed without asking to discard.
      dispatch(receiptCleared());
      requestAnimationFrame(() => {
        // A new receipt goes back to its customer; a fixed one (opened from the shop's receipt
        // list, whose detail is gone now) to that list. The slip shows on top.
        router.dismissTo({ pathname: '/customer/[id]', params: { id: custId } });
        if (edited) router.push({ pathname: '/receipts', params: { customerId: custId } });
        router.push({ pathname: '/receipt/saved/[id]', params: { id } });
      });
    } catch (e) {
      setSaving(false);
      const code = e instanceof Error ? e.message : '';
      if (code === 'RECEIPT_MAYBE_SENT' || code === 'RECEIPT_ALREADY_SENT') return Alert.alert(t('receipt.cantEditTitle'), t(`receipt.cantEdit.${code}`));
      if (code === 'RECEIPT_LINES_MISMATCH' || code === 'RECEIPT_EMPTY') return Alert.alert(t('receipt.fixTitle'), t('receipt.linesMismatch'));
      Alert.alert(t('common.error'));
    }
  };

  const save = () => {
    if (saved.current || !c) return;
    if (sum.problem) return Alert.alert(t('receipt.problems.noAmount'));
    const cleared = settled.filter((b) => b.leftPaise === 0).map((b) => byKey.get(b.key)?.docRefno ?? '');
    const payText = draft.lines
      .map((l) => (l.typeId === TENDER_TYPE.CHEQUE ? t('receipt.confirmCheque', { no: l.refNo, amount: formatAmount(amountPaise(l.amount)) }) : t('receipt.confirmMode', { name: l.name.toLocaleLowerCase(), amount: formatAmount(amountPaise(l.amount)) })))
      .join(t('receipt.and'));
    const text = [
      t('receipt.confirmHead', { amount: formatAmount(sum.receivedPaise), name: customerName(c), modes: payText }),
      cleared.length ? t('receipt.confirmCleared', { bills: cleared.join(', ') }) : null,
      sum.creditsPaise > 0 ? t('receipt.confirmCredits', { amount: formatAmount(sum.creditsPaise) }) : null,
      t('receipt.confirmAccount', { amount: formatAmount(sum.onAccountPaise) }),
      '',
      t('receipt.confirmNote'),
    ]
      .filter((x) => x !== null)
      .join('\n');
    Alert.alert(t('receipt.saveTitle'), text, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('receipt.save'), onPress: doSave },
    ]);
  };

  return (
    <View style={st.root}>
      <ScreenHeader title={t('receipt.reviewTitle')} subtitle={[c ? customerName(c) : '', companyName].filter(Boolean).join(' · ')} backLabel={t('receipt.back')} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView contentContainerStyle={st.body} keyboardShouldPersistTaps="handled">
          <View style={st.card}>
            <Row label={t('receipt.receivedVia', { modes })} value={formatAmount(sum.receivedPaise)} />
            {sum.creditsPaise > 0 ? <Row label={t('receipt.creditsUsedVia', { kinds: creditKinds })} value={formatAmount(sum.creditsPaise)} /> : null}
            {sum.discountPaise > 0 ? <Row label={t('receipt.ppdDiscount')} value={formatAmount(sum.discountPaise)} /> : null}
            {sum.roundoffPaise > 0 ? <Row label={t('receipt.roundoff')} value={formatAmount(sum.roundoffPaise)} /> : null}
            <View style={st.rule} />
            <Row label={t('receipt.billsSettled', { count: settled.length })} value={formatAmount(sum.settledPaise)} strong />
            <Row label={t('receipt.leftOnAccount')} value={formatAmount(sum.onAccountPaise)} strong />
            <View style={st.rule} />
            <Row label={t('receipt.outstandingAfter', { count: leftBills.length })} value={formatAmount(leftPaise)} />
          </View>

          {settled.map((b) => {
            const item = byKey.get(b.key);
            const slab = item ? ppdSlab(item.ppd, date) : null;
            const parts = [
              b.creditPaise > 0 ? t('receipt.partCredits', { amount: formatAmount(b.creditPaise) }) : null,
              b.receivePaise > 0 ? formatAmount(b.receivePaise) : null,
              b.discountPaise > 0
                ? slab && b.discountPaise === b.ppdPaise
                  ? t('receipt.partPpdDiscount', { perc: slab.perc, amount: formatAmount(b.discountPaise) })
                  : t('receipt.partDiscount', { amount: formatAmount(b.discountPaise) })
                : null,
              b.roundoffPaise > 0 ? t('receipt.partRoundoff', { amount: formatAmount(b.roundoffPaise) }) : null,
            ].filter(Boolean);
            return (
              <View key={b.key} style={st.billRow}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={st.billNo}>
                    {item?.docRefno} · {b.leftPaise === 0 ? t('receipt.clearedLower') : t('receipt.partLower', { amount: formatAmount(b.leftPaise) })}
                  </Text>
                  <Text style={st.small}>{parts.join(' + ')}</Text>
                </View>
                <Text style={st.billAmt}>{formatAmount(b.receivePaise + b.creditPaise + b.discountPaise + b.roundoffPaise)}</Text>
              </View>
            );
          })}

          <Text style={st.section} accessibilityRole="header">
            {t('receipt.details')}
          </Text>
          <View style={st.card}>
            <Row label={t('receipt.receiptDate')} value={formatDay(date, names)} />
            <Row label={t('receipt.collectedBy')} value={me.employeeName ?? t('receipt.collectorUnknown')} />
            {noCollector && collectorNeeded ? <Text style={st.warn}>{t('receipt.collectorMissing')}</Text> : null}
          </View>
          <View style={st.refRow}>
            <View style={{ flex: 1.4 }}>
              <TextField
                label={t('receipt.shopRefNo')}
                value={draft.docRefno}
                onChangeText={(v) => dispatch(docRefTyped({ docRefno: v }))}
                placeholder={t('receipt.optional')}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={DOC_REF_MAX}
              />
            </View>
            <View style={{ flex: 1, gap: 6 }}>
              <Text style={st.label}>{t('receipt.itsDate')}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${t('receipt.itsDate')}: ${formatDay(draft.docDate ?? date, names)}`}
                accessibilityState={{ disabled: !draft.docRefno.trim() }}
                disabled={!draft.docRefno.trim()}
                onPress={() => setCalendar(true)}
                style={[st.dateBtn, !draft.docRefno.trim() && { opacity: 0.5 }]}
              >
                <Text style={st.dateText}>{formatDay(draft.docDate ?? date, names).replace(/ \d{4}$/, '')}</Text>
                <Ionicons name="calendar-outline" size={18} color={colors.textMuted} />
              </Pressable>
            </View>
          </View>
          <TextField
            label={t('receipt.narration')}
            value={draft.remarks}
            onChangeText={(v) => dispatch(receiptRemarksTyped(v))}
            placeholder={t('receipt.optional')}
            multiline
            maxLength={RECEIPT_REMARKS_MAX}
            style={st.remarks}
          />
          <Text style={[st.small, same > 0 && st.warn]}>{same > 0 ? t('receipt.sameToday', { count: same, amount: formatAmount(sum.receivedPaise) }) : t('receipt.noneToday')}</Text>
        </ScrollView>

        <View style={[st.footer, { paddingBottom: insets.bottom + spacing.lg }]}>
          <View style={st.footRow}>
            <Text style={[st.small, { flex: 1 }]} numberOfLines={1}>
              {draft.lines.map((l) => `${l.name} ${formatAmount(amountPaise(l.amount)).replace(/\.00$/, '')}`).join(' · ')}
            </Text>
            <Text style={st.footAmount}>{formatAmount(sum.receivedPaise)}</Text>
          </View>
          <Button title={t('receipt.save')} onPress={save} loading={saving} style={{ height: 52 }} />
        </View>
      </KeyboardAvoidingView>
      <CalendarDialog
        visible={calendar}
        value={draft.docDate ?? date}
        today={date}
        onCancel={() => setCalendar(false)}
        onPick={(iso) => {
          dispatch(docRefTyped({ docDate: iso }));
          setCalendar(false);
        }}
      />
    </View>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={st.row} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={[st.rowLabel, strong && { fontWeight: '600', color: colors.text }]}>{label}</Text>
      <Text style={[st.rowValue, strong && { fontWeight: '700' }]}>{value}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { padding: spacing.lg, gap: spacing.md },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md + 2, gap: 7 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: spacing.sm },
  rowLabel: { fontSize: font.sm, color: colors.textLabel, flexShrink: 1 },
  rowValue: { fontSize: font.sm, fontWeight: '600', color: colors.text },
  rule: { height: 1, backgroundColor: colors.border },
  billRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: '#86EFAC', borderRadius: radius.md + 2, paddingVertical: 10, paddingHorizontal: spacing.md + 2 },
  billNo: { fontSize: 14, fontWeight: '600', color: colors.text },
  billAmt: { fontSize: 14, fontWeight: '600', color: colors.text },
  small: { fontSize: 12.5, color: colors.textMuted },
  warn: { fontSize: 12.5, color: '#92400E' },
  section: { fontSize: font.md, fontWeight: '600', color: colors.text, marginTop: spacing.xs },
  label: { fontSize: font.sm, fontWeight: '500', color: colors.textLabel },
  refRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  dateBtn: {
    height: 48,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: radius.md + 2,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
  },
  dateText: { fontSize: font.md, color: colors.text },
  remarks: { minHeight: 64, textAlignVertical: 'top', paddingTop: spacing.md },
  footer: { paddingTop: spacing.md, paddingHorizontal: spacing.lg, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border, gap: spacing.sm },
  footRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  footAmount: { fontSize: font.lg, fontWeight: '700', color: colors.text },
});
