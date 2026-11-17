import Ionicons from '@expo/vector-icons/Ionicons';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CalendarDialog } from '@/components/calendar-dialog';
import { BottomSheet } from '@/components/sheet';
import { Button, TextField } from '@/components/ui';
import { ScreenHeader } from '@/components/screen-header';
import { useDateNames } from '@/components/use-date-names';
import { decimalInput, paiseText, toPaise } from '@/features/orders/order-math';
import { customerName, orderCustomerQuery } from '@/features/orders/queries';
import {
  BANK_MAX,
  billsNow,
  nextReceiptNo,
  openBillsQuery,
  RECEIPT_REMARKS_MAX,
  REF_MAX,
  saveReceipt,
  tendersQuery,
  unsentReceiptsQuery,
  type TenderRow,
} from '@/features/receipts/queries';
import {
  receiptCleared,
  receiptRemarksTyped,
  tenderAdded,
  tenderChanged,
  tenderRemoved,
  type TenderLine,
} from '@/features/receipts/receipt-draft';
import { amountPaise, autoAdjust, receiptSummary, surchargePaise, tenderBalance, tenderProblem, TENDER_TYPE } from '@/features/receipts/receipt-math';
import { formatDay } from '@/lib/date-range';
import { formatAmount, todayISO } from '@/lib/money';
import { store, useAppDispatch, useAppSelector } from '@/store';
import { getDeviceUid } from '@/sync/sync-store';
import { colors, font, radius, spacing } from '@/theme';

const lineOf = (tnd: TenderRow, amount: string): TenderLine => ({
  tndId: tnd.tndId,
  typeId: tnd.tndTypeId,
  name: tnd.tndName,
  needsRef: tnd.appNeedsRef,
  refLabel: tnd.appRefLabel,
  amount,
  refNo: '',
  bankName: '',
  instrumentDate: null,
  surchargePerc: tnd.tndSurchargePerc,
  surchargeFlat: tnd.tndSurchargeAmount,
});

/**
 * Payment types (the Qt app's ReceiptConfirm.qml): how the shop paid the receipt, one line per
 * tender the office set up for the company (Cash, UPI, bank transfer, cheque …), with what VK
 * Nex needs on each. The lines must add up to the receipt. Save receipt asks first, then keeps
 * the receipt on the phone for the next Sync and marks the shop Received.
 */
export default function PaymentTypesScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const names = useDateNames();
  const dispatch = useAppDispatch();
  const draft = useAppSelector((st) => st.receiptDraft);
  const userId = useAppSelector((st) => st.session.session?.userId ?? '');
  const customerId = draft.customerId ?? '';
  const companyId = draft.companyId ?? '';
  const { data: found } = useLiveQuery(orderCustomerQuery(customerId), [customerId]);
  const { data: all } = useLiveQuery(openBillsQuery(customerId), [customerId]);
  const { data: unsent } = useLiveQuery(unsentReceiptsQuery(customerId), [customerId]);
  const { data: tenderRows, updatedAt } = useLiveQuery(tendersQuery(companyId), [companyId]);
  const c = found[0];

  const bills = useMemo(() => billsNow(all, unsent, companyId).filter((b) => b.pendingPaise > 0), [all, unsent, companyId]);
  const typed = toPaise(draft.amount) ?? 0;
  const sum = receiptSummary(typed, bills, autoAdjust(typed, bills));
  const outstanding = bills.reduce((s, b) => s + b.pendingPaise, 0);
  const { tenderPaise, balancePaise } = tenderBalance(sum.amountPaise, draft.lines);

  const [sheet, setSheet] = useState(false);
  const [dateFor, setDateFor] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const saved = useRef(false);

  // First time in, with no lines yet: the office's default tender (else cash) for the whole amount.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !updatedAt) return;
    seeded.current = true;
    if (draft.lines.length > 0 || sum.amountPaise <= 0) return;
    const first = tenderRows.find((r) => r.appIsDefault) ?? tenderRows.find((r) => r.tndTypeId === TENDER_TYPE.CASH);
    if (first) dispatch(tenderAdded(lineOf(first, paiseText(sum.amountPaise))));
  }, [updatedAt, draft.lines.length, sum.amountPaise, tenderRows, dispatch]);

  const change = (tndId: string, patch: Partial<Omit<TenderLine, 'tndId'>>) => dispatch(tenderChanged({ tndId, patch }));
  const add = (tnd: TenderRow) => {
    // A new line starts with what is still to account for.
    dispatch(tenderAdded(lineOf(tnd, balancePaise > 0 ? paiseText(balancePaise) : '')));
    setSheet(false);
  };

  const save = () => {
    setSubmitted(true);
    if (saved.current || !c || !draft.customerId || !draft.companyId) return;
    if (draft.lines.length === 0) return Alert.alert(t('receipt.fixTitle'), t('receipt.noLines'));
    if (draft.lines.some((l) => tenderProblem(l))) return Alert.alert(t('receipt.fixTitle'), t('receipt.fixLines'));
    if (balancePaise !== 0) {
      return Alert.alert(
        t('receipt.fixTitle'),
        t('receipt.fixBalance', { tender: formatAmount(tenderPaise), receipt: formatAmount(sum.amountPaise) }),
      );
    }
    const no = nextReceiptNo(draft.companyId, getDeviceUid()).refNo;
    const text =
      t('receipt.saveText', { no, name: customerName(c), amount: formatAmount(sum.amountPaise) }) +
      (sum.onAccountPaise > 0 ? `\n${t('receipt.saveAdvance', { amount: formatAmount(sum.onAccountPaise) })}` : '');
    Alert.alert(t('receipt.saveTitle'), text, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('receipt.save'), onPress: doSave },
    ]);
  };

  const doSave = () => {
    const d = store.getState().receiptDraft;
    if (saved.current || !c || !d.customerId || !d.companyId) return;
    setSaving(true);
    try {
      const { refNo } = saveReceipt(
        { customerId: d.customerId, customerName: customerName(c), companyId: d.companyId, amountPaise: sum.amountPaise, lines: d.lines, remarks: d.remarks },
        userId,
        getDeviceUid(),
      );
      saved.current = true;
      const id = d.customerId;
      // Cleared first, and the screens closed a frame later, once Receipt has drawn itself
      // without an amount: then it lets itself be closed without asking to discard.
      dispatch(receiptCleared());
      requestAnimationFrame(() => {
        router.dismissTo({ pathname: '/customer/[id]', params: { id } });
        Alert.alert(t('receipt.savedTitle'), t('receipt.savedText', { no: refNo }));
      });
    } catch {
      setSaving(false);
      Alert.alert(t('common.error'));
    }
  };

  const balanceChip =
    balancePaise === 0
      ? { text: t('receipt.matches'), bg: '#DCFCE7', fg: '#166534' }
      : balancePaise > 0
        ? { text: t('receipt.short', { amount: formatAmount(balancePaise) }), bg: '#FEF3C7', fg: '#92400E' }
        : { text: t('receipt.over', { amount: formatAmount(-balancePaise) }), bg: '#FEE2E2', fg: colors.danger };
  const dateLine = draft.lines.find((l) => l.tndId === dateFor);

  return (
    <View style={st.root}>
      <ScreenHeader title={t('receipt.paymentTitle')} subtitle={c ? customerName(c) : undefined} backLabel={t('receipt.back')} />
      <View style={st.cards}>
        <Card label={t('receipt.outstandingLabel')} value={formatAmount(outstanding)} />
        <Card label={t('receipt.receiptLabel')} value={formatAmount(sum.amountPaise)} color={colors.primary} />
        <Card label={t('receipt.newBalance')} value={formatAmount(Math.max(0, outstanding - sum.adjustedPaise))} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView contentContainerStyle={st.body} keyboardShouldPersistTaps="handled">
          {updatedAt && tenderRows.length === 0 ? <Text style={st.empty}>{t('receipt.noTenders')}</Text> : null}
          {draft.lines.map((l) => (
            <LineCard
              key={l.tndId}
              line={l}
              submitted={submitted}
              dateText={l.instrumentDate ? formatDay(l.instrumentDate, names) : ''}
              onChange={(patch) => change(l.tndId, patch)}
              onRemove={() => dispatch(tenderRemoved(l.tndId))}
              onPickDate={() => setDateFor(l.tndId)}
            />
          ))}
          {tenderRows.length > 0 ? (
            <Pressable accessibilityRole="button" onPress={() => setSheet(true)} style={({ pressed }) => [st.addBtn, pressed && { opacity: 0.85 }]}>
              <Text style={st.addText}>{t('receipt.addType')}</Text>
            </Pressable>
          ) : null}
          <TextField
            label={t('receipt.remarks')}
            value={draft.remarks}
            onChangeText={(v) => dispatch(receiptRemarksTyped(v))}
            placeholder={t('receipt.optional')}
            multiline
            maxLength={RECEIPT_REMARKS_MAX}
            style={st.remarks}
          />
        </ScrollView>

        <View style={[st.footer, { paddingBottom: insets.bottom + spacing.lg }]}>
          <View style={st.tenderRow}>
            <Text style={st.tenderText}>{t('receipt.tender', { amount: formatAmount(tenderPaise) })}</Text>
            <Text style={[st.chip, { backgroundColor: balanceChip.bg, color: balanceChip.fg }]}>{balanceChip.text}</Text>
          </View>
          <Button title={t('receipt.save')} onPress={save} loading={saving} disabled={tenderRows.length === 0} style={{ height: 52 }} />
        </View>
      </KeyboardAvoidingView>

      <BottomSheet visible={sheet} onClose={() => setSheet(false)} title={t('receipt.addTitle')}>
        {tenderRows.map((r) => {
          const added = draft.lines.some((l) => l.tndId === r.tndId);
          return (
            <Pressable
              key={r.tndId}
              accessibilityRole="button"
              accessibilityState={{ disabled: added }}
              disabled={added}
              onPress={() => add(r)}
              style={st.sheetRow}
            >
              <Text style={[st.sheetName, added && { color: colors.textMuted }]}>{r.tndName}</Text>
              <Text style={[st.sheetTag, { color: added ? '#166534' : colors.primary }]}>{added ? t('receipt.added') : t('receipt.add')}</Text>
            </Pressable>
          );
        })}
      </BottomSheet>

      <CalendarDialog
        visible={dateFor !== null}
        value={dateLine?.instrumentDate ?? null}
        today={todayISO()}
        onCancel={() => setDateFor(null)}
        onPick={(iso) => {
          if (dateFor) change(dateFor, { instrumentDate: iso });
          setDateFor(null);
        }}
      />
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

function LineCard({
  line,
  submitted,
  dateText,
  onChange,
  onRemove,
  onPickDate,
}: {
  line: TenderLine;
  submitted: boolean;
  dateText: string;
  onChange: (patch: Partial<Omit<TenderLine, 'tndId'>>) => void;
  onRemove: () => void;
  onPickDate: () => void;
}) {
  const { t } = useTranslation();
  const problem = submitted ? tenderProblem(line) : null;
  const err = (keys: readonly string[]) => (problem && keys.includes(problem) ? t(`receipt.tenderProblems.${problem}`) : undefined);
  const cheque = line.typeId === TENDER_TYPE.CHEQUE;
  const card = line.typeId === TENDER_TYPE.CARD;
  const cash = line.typeId === TENDER_TYPE.CASH;
  const refLabel = cheque ? t('receipt.chequeNo') : card ? t('receipt.cardLast4') : (line.refLabel ?? t('receipt.refNo'));
  const refNeeded = cheque || line.needsRef;
  const principal = amountPaise(line.amount);
  const surcharge = surchargePaise(principal, line.surchargePerc, line.surchargeFlat);

  return (
    <View style={st.line}>
      <View style={st.lineTop}>
        <Text style={st.lineName}>{line.name}</Text>
        <TextInput
          value={line.amount}
          onChangeText={(v) => onChange({ amount: decimalInput(v) })}
          placeholder="0.00"
          placeholderTextColor={colors.textMuted}
          keyboardType="decimal-pad"
          accessibilityLabel={t('receipt.amountFor', { name: line.name })}
          selectTextOnFocus
          maxLength={12}
          style={[st.lineAmount, problem === 'noAmount' && { borderColor: colors.danger }]}
        />
        <Pressable accessibilityRole="button" accessibilityLabel={t('receipt.remove', { name: line.name })} onPress={onRemove} hitSlop={4} style={st.delete}>
          <Ionicons name="trash-outline" size={20} color={colors.textMuted} />
        </Pressable>
      </View>
      {problem === 'noAmount' ? <Text style={st.error}>{t('receipt.tenderProblems.noAmount')}</Text> : null}
      {surcharge > 0 ? (
        <Text style={st.surcharge}>{t('receipt.surcharge', { amount: formatAmount(surcharge), total: formatAmount(principal + surcharge) })}</Text>
      ) : null}
      {!cash ? (
        <View style={st.grid}>
          <View style={st.cell}>
            <TextField
              label={refLabel}
              value={line.refNo}
              onChangeText={(v) => onChange({ refNo: card ? v.replace(/\D/g, '').slice(0, 4) : v })}
              placeholder={refNeeded ? undefined : t('receipt.optional')}
              keyboardType={card ? 'number-pad' : 'default'}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={card ? 4 : REF_MAX}
              required={refNeeded}
              error={err(['chequeNo', 'cardLast4', 'refNo'])}
            />
          </View>
          {cheque ? (
            <>
              <View style={st.cell}>
                <TextField
                  label={t('receipt.bank')}
                  value={line.bankName}
                  onChangeText={(v) => onChange({ bankName: v })}
                  maxLength={BANK_MAX}
                  required
                  error={err(['bankName'])}
                />
              </View>
              <View style={st.cell}>
                <Text style={st.dateLabel}>{t('receipt.chequeDate')} *</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${t('receipt.chequeDate')}: ${dateText || t('receipt.pickDate')}`}
                  onPress={onPickDate}
                  style={[st.dateBtn, problem === 'chequeDate' && { borderColor: colors.danger }]}
                >
                  <Text style={[st.dateText, !dateText && { color: colors.textMuted }]}>{dateText || t('receipt.pickDate')}</Text>
                  <Ionicons name="calendar-outline" size={18} color={colors.textMuted} />
                </Pressable>
                {problem === 'chequeDate' ? <Text style={st.error}>{t('receipt.tenderProblems.chequeDate')}</Text> : null}
              </View>
            </>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  cards: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.md + 2 },
  card: { flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md + 2, padding: 10, gap: 1 },
  cardLabel: { fontSize: 12, color: colors.textMuted },
  cardValue: { fontSize: font.md, fontWeight: '600', color: colors.text },
  body: { padding: spacing.lg, gap: 10 },
  empty: { fontSize: font.md, color: colors.textMuted, textAlign: 'center', padding: spacing.lg },
  line: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, paddingVertical: spacing.md, paddingLeft: spacing.md + 2, paddingRight: 6, gap: spacing.sm },
  lineTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  lineName: { flex: 1, fontSize: font.md, fontWeight: '600', color: colors.text },
  lineAmount: {
    width: 130,
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
  delete: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.sm, paddingRight: 8 },
  cell: { flexBasis: '47%', flexGrow: 1 },
  dateLabel: { fontSize: font.sm, fontWeight: '500', color: colors.textLabel, marginBottom: 6 },
  dateBtn: {
    height: 48,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: radius.md + 2,
    paddingHorizontal: spacing.md + 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
  },
  dateText: { fontSize: font.md, color: colors.text },
  error: { fontSize: font.sm, color: colors.danger },
  surcharge: { fontSize: 12, color: '#92400E' },
  addBtn: { minHeight: 48, borderRadius: radius.md + 2, borderWidth: 1, borderStyle: 'dashed', borderColor: '#A8A29E', alignItems: 'center', justifyContent: 'center' },
  addText: { fontSize: 14, fontWeight: '600', color: colors.primary },
  remarks: { minHeight: 64, textAlignVertical: 'top', paddingTop: spacing.md },
  footer: { paddingTop: spacing.md, paddingHorizontal: spacing.lg, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border, gap: 10 },
  tenderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  tenderText: { fontSize: 14, color: colors.text },
  chip: { fontSize: 12, fontWeight: '600', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, overflow: 'hidden' },
  sheetRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, borderBottomWidth: 1, borderBottomColor: '#F1EDE4' },
  sheetName: { fontSize: font.md, fontWeight: '500', color: colors.text },
  sheetTag: { fontSize: 12, fontWeight: '600' },
});
