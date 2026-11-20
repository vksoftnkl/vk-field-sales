import Ionicons from '@expo/vector-icons/Ionicons';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { router } from 'expo-router';
import type { TFunction } from 'i18next';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/screen-header';
import { BottomSheet } from '@/components/sheet';
import { Button } from '@/components/ui';
import { useDateNames } from '@/components/use-date-names';
import { companiesQuery } from '@/features/company/company';
import { decimalInput, paiseText } from '@/features/orders/order-math';
import { customerName, orderCustomerQuery } from '@/features/orders/queries';
import { tendersQuery, type TenderRow } from '@/features/receipts/queries';
import { tenderAdded, tenderChanged, tenderRemoved, type TenderLine } from '@/features/receipts/receipt-draft';
import { amountPaise, surchargePaise, tenderBalance, tenderProblem, TENDER_TYPE } from '@/features/receipts/receipt-math';
import { isPostDated, lineDetails, lineOf, offeredOnPhone } from '@/features/receipts/tender-lines';
import { useReceiptPlan } from '@/features/receipts/use-receipt-plan';
import { formatDay } from '@/lib/date-range';
import { formatAmount } from '@/lib/money';
import { useAppDispatch, useAppSelector } from '@/store';
import { colors, font, radius, spacing } from '@/theme';

/**
 * Receipt · payment modes (canvas 5b, step 3): how the shop paid the amount received, one line per
 * tender of the company in VK Nex (each once). Cash is typed here; a cheque, UPI or transfer opens
 * its details. A tender's fee is paid on top, so the bills still get the full amount. The modes
 * must add up to the amount received before Review.
 */
export default function PaymentModesScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const names = useDateNames();
  const dispatch = useAppDispatch();
  const draft = useAppSelector((st) => st.receiptDraft);
  const customerId = draft.customerId ?? '';
  const companyId = draft.companyId ?? '';
  const { data: found } = useLiveQuery(orderCustomerQuery(customerId), [customerId]);
  const { data: tenderRows, updatedAt } = useLiveQuery(tendersQuery(companyId), [companyId]);
  const { data: companyList } = useLiveQuery(companiesQuery());
  const plan = useReceiptPlan(customerId, companyId);
  const c = found[0];
  const offered = tenderRows.filter(offeredOnPhone);
  const toTake = plan.settlement.receivedPaise;
  const { tenderPaise, balancePaise } = tenderBalance(toTake, draft.lines);
  const [sheet, setSheet] = useState(false);
  const companyName = companyList.find((x) => x.id === companyId)?.name ?? '';

  // First time in: the office's default tender (else cash) for the whole amount. One line only and
  // the amount changed on Dues since: that line follows it.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !updatedAt) return;
    seeded.current = true;
    if (toTake <= 0) return;
    if (draft.lines.length === 0) {
      const first = offered.find((r) => r.appIsDefault) ?? offered.find((r) => r.tndTypeId === TENDER_TYPE.CASH);
      if (first) dispatch(tenderAdded(lineOf(first, paiseText(toTake))));
    } else if (draft.lines.length === 1 && amountPaise(draft.lines[0]!.amount) !== toTake) {
      dispatch(tenderChanged({ tndId: draft.lines[0]!.tndId, patch: { amount: paiseText(toTake) } }));
    }
  }, [updatedAt, draft.lines, toTake, offered, dispatch]);

  const add = (tnd: TenderRow) => {
    setSheet(false);
    // A new line starts with what is still to account for; anything but cash needs its details.
    dispatch(tenderAdded(lineOf(tnd, balancePaise > 0 ? paiseText(balancePaise) : '')));
    if (tnd.tndTypeId !== TENDER_TYPE.CASH) router.push({ pathname: '/receipt/mode', params: { tndId: tnd.tndId, isNew: '1' } });
  };

  const next = () => {
    if (draft.lines.length === 0) return Alert.alert(t('receipt.fixTitle'), t('receipt.noLines'));
    const bad = draft.lines.find((l) => tenderProblem(l));
    if (bad) {
      return Alert.alert(t('receipt.fixTitle'), t('receipt.fixLine', { name: bad.name, problem: t(`receipt.tenderProblems.${tenderProblem(bad)}`) }), [
        { text: t('common.cancel'), style: 'cancel' },
        ...(bad.typeId !== TENDER_TYPE.CASH ? [{ text: t('receipt.edit'), onPress: () => router.push({ pathname: '/receipt/mode', params: { tndId: bad.tndId } }) }] : []),
      ]);
    }
    if (balancePaise !== 0) return Alert.alert(t('receipt.fixTitle'), t('receipt.fixBalance', { tender: formatAmount(tenderPaise), receipt: formatAmount(toTake) }));
    router.push('/receipt/review');
  };

  const chip =
    balancePaise === 0
      ? { text: t('receipt.matches'), bg: '#DCFCE7', fg: '#166534' }
      : balancePaise > 0
        ? { text: t('receipt.short', { amount: formatAmount(balancePaise) }), bg: '#FEF3C7', fg: '#92400E' }
        : { text: t('receipt.over', { amount: formatAmount(-balancePaise) }), bg: '#FEE2E2', fg: colors.danger };
  const anyFee = draft.lines.some((l) => surchargePaise(amountPaise(l.amount), l.surchargePerc, l.surchargeFlat) > 0) || offered.some((r) => Number(r.tndSurchargePerc) > 0 || Number(r.tndSurchargeAmount) > 0);

  return (
    <View style={st.root}>
      <ScreenHeader title={t('receipt.paymentTitle')} subtitle={[c ? customerName(c) : '', t('receipt.toTake', { amount: formatAmount(toTake) })].filter(Boolean).join(' · ')} backLabel={t('receipt.back')} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView contentContainerStyle={st.body} keyboardShouldPersistTaps="handled">
          <Text style={st.note}>{t('receipt.tendersNote', { company: companyName })}</Text>
          {updatedAt && offered.length === 0 ? <Text style={st.empty}>{t('receipt.noTenders')}</Text> : null}

          {draft.lines.map((l) =>
            l.typeId === TENDER_TYPE.CASH ? (
              <CashLine key={l.tndId} line={l} onAmount={(v) => dispatch(tenderChanged({ tndId: l.tndId, patch: { amount: v } }))} onRemove={() => dispatch(tenderRemoved(l.tndId))} />
            ) : (
              <ModeLine
                key={l.tndId}
                line={l}
                date={plan.date}
                dateText={(iso) => formatDay(iso, names)}
                onEdit={() => router.push({ pathname: '/receipt/mode', params: { tndId: l.tndId } })}
                onRemove={() => dispatch(tenderRemoved(l.tndId))}
              />
            ),
          )}

          {offered.length > draft.lines.length ? (
            <Pressable accessibilityRole="button" onPress={() => setSheet(true)} style={({ pressed }) => [st.addBtn, pressed && { opacity: 0.85 }]}>
              <Ionicons name="add" size={18} color={colors.primary} />
              <Text style={st.addText}>{t('receipt.addMode')}</Text>
            </Pressable>
          ) : null}

          {draft.lines.length ? (
            <View style={st.sumCard}>
              {draft.lines.map((l) => {
                const fee = surchargePaise(amountPaise(l.amount), l.surchargePerc, l.surchargeFlat);
                return (
                  <View key={l.tndId} style={st.sumRow}>
                    <Text style={st.sumLabel}>{fee > 0 ? t('receipt.withFee', { name: l.name, fee: formatAmount(fee) }) : l.name}</Text>
                    <Text style={st.sumValue}>{formatAmount(amountPaise(l.amount))}</Text>
                  </View>
                );
              })}
              <View style={st.rule} />
              <View style={st.sumRow}>
                <Text style={[st.sumLabel, { fontWeight: '600', color: colors.text }]}>{t('receipt.totalPaid')}</Text>
                <Text style={[st.sumValue, { fontSize: font.md }]}>{formatAmount(tenderPaise)}</Text>
              </View>
              <Text style={[st.chip, { backgroundColor: chip.bg, color: chip.fg }]} accessibilityLiveRegion="polite">
                {chip.text}
              </Text>
            </View>
          ) : null}
          {anyFee ? <Text style={st.note}>{t('receipt.feeNote')}</Text> : null}
        </ScrollView>

        <View style={[st.footer, { paddingBottom: insets.bottom + spacing.lg }]}>
          <View style={st.footRow}>
            <Text style={st.small}>{t('receipt.nModes', { count: draft.lines.length })}</Text>
            <Text style={st.footAmount}>{formatAmount(tenderPaise)}</Text>
          </View>
          <Button title={t('receipt.nextReview')} onPress={next} disabled={updatedAt !== undefined && offered.length === 0} style={{ height: 52 }} />
        </View>
      </KeyboardAvoidingView>

      <BottomSheet visible={sheet} onClose={() => setSheet(false)} title={t('receipt.addMode')} subtitle={t('receipt.addModeNote', { company: companyName })}>
        {offered.map((r) => {
          const added = draft.lines.some((l) => l.tndId === r.tndId);
          return (
            <Pressable key={r.tndId} accessibilityRole="button" accessibilityState={{ disabled: added }} disabled={added} onPress={() => add(r)} style={st.sheetRow}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[st.sheetName, added && { color: colors.textMuted }]}>{r.tndName}</Text>
                <Text style={st.small}>{modeHint(t, r)}</Text>
              </View>
              <Text style={[st.sheetTag, { color: added ? '#166534' : colors.primary }]}>{added ? t('receipt.added') : t('receipt.add')}</Text>
            </Pressable>
          );
        })}
        <Text style={[st.small, { paddingVertical: spacing.md }]}>{t('receipt.onceNote')}</Text>
      </BottomSheet>
    </View>
  );
}

/** What a tender needs, under its name in Add payment mode. */
function modeHint(t: TFunction, r: TenderRow): string {
  const perc = Number(r.tndSurchargePerc) || 0;
  const flat = Number(r.tndSurchargeAmount) || 0;
  if (perc > 0) return t('receipt.hintFeePerc', { perc });
  if (flat > 0) return t('receipt.hintFeeFlat', { amount: formatAmount(Math.round(flat * 100)) });
  switch (r.tndTypeId) {
    case TENDER_TYPE.CASH:
      return t('receipt.hintCash');
    case TENDER_TYPE.CHEQUE:
      return t('receipt.hintCheque');
    case TENDER_TYPE.BANK:
      return r.appNeedsRef ? t('receipt.hintTransfer') : t('receipt.hintTransferOpt');
    default:
      return r.appNeedsRef ? t('receipt.hintRef', { label: r.appRefLabel ?? t('receipt.refNo') }) : t('receipt.hintRefOpt');
  }
}

function CashLine({ line, onAmount, onRemove }: { line: TenderLine; onAmount: (v: string) => void; onRemove: () => void }) {
  const { t } = useTranslation();
  const fee = surchargePaise(amountPaise(line.amount), line.surchargePerc, line.surchargeFlat);
  return (
    <View style={st.line}>
      <View style={st.lineTop}>
        <Text style={st.lineName}>{line.name}</Text>
        <TextInput
          value={line.amount}
          onChangeText={(v) => onAmount(decimalInput(v))}
          placeholder="0.00"
          placeholderTextColor={colors.textMuted}
          keyboardType="decimal-pad"
          accessibilityLabel={t('receipt.amountFor', { name: line.name })}
          selectTextOnFocus
          maxLength={12}
          style={st.lineAmount}
        />
        <Pressable accessibilityRole="button" accessibilityLabel={t('receipt.remove', { name: line.name })} onPress={onRemove} hitSlop={4} style={st.iconBtn}>
          <Ionicons name="trash-outline" size={20} color={colors.textMuted} />
        </Pressable>
      </View>
      {fee > 0 ? <Text style={st.fee}>{t('receipt.surcharge', { amount: formatAmount(fee), total: formatAmount(amountPaise(line.amount) + fee) })}</Text> : null}
    </View>
  );
}

function ModeLine({ line, date, dateText, onEdit, onRemove }: { line: TenderLine; date: string; dateText: (iso: string) => string; onEdit: () => void; onRemove: () => void }) {
  const { t } = useTranslation();
  const problem = tenderProblem(line);
  const pdc = isPostDated(line, date);
  const details = [...lineDetails(line)];
  if (line.instrumentDate) details.splice(1, 0, dateText(line.instrumentDate));
  const fee = surchargePaise(amountPaise(line.amount), line.surchargePerc, line.surchargeFlat);
  return (
    <View style={[st.line, problem && { borderColor: '#FCA5A5' }]}>
      <View style={st.lineTop}>
        <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
          <Text style={st.lineName}>{line.name}</Text>
          <Text style={[st.small, problem && { color: colors.danger }]} numberOfLines={2}>
            {problem ? t(`receipt.tenderProblems.${problem}`) : details.join(' · ')}
          </Text>
          {pdc ? <Text style={st.pdcTag}>{t('receipt.pdcTag')}</Text> : null}
        </View>
        <Text style={st.modeAmount}>{formatAmount(amountPaise(line.amount))}</Text>
      </View>
      {fee > 0 ? <Text style={st.fee}>{t('receipt.surcharge', { amount: formatAmount(fee), total: formatAmount(amountPaise(line.amount) + fee) })}</Text> : null}
      <View style={st.lineBtns}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('receipt.remove', { name: line.name })} onPress={onRemove} hitSlop={4} style={st.textBtn}>
          <Text style={[st.textBtnText, { color: colors.textMuted }]}>{t('receipt.removeShort')}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={t('receipt.editMode', { name: line.name })} onPress={onEdit} hitSlop={4} style={st.textBtn}>
          <Text style={st.textBtnText}>{t('receipt.edit')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { padding: spacing.lg, gap: 10 },
  note: { fontSize: 12.5, color: colors.textMuted, lineHeight: 18 },
  small: { fontSize: 12.5, color: colors.textMuted },
  empty: { fontSize: font.md, color: colors.textMuted, textAlign: 'center', padding: spacing.lg },
  line: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, paddingVertical: spacing.md, paddingLeft: spacing.md + 2, paddingRight: 8, gap: 6 },
  lineTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  lineName: { fontSize: font.md, fontWeight: '600', color: colors.text },
  lineAmount: {
    marginLeft: 'auto',
    width: 140,
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
  modeAmount: { fontSize: font.md, fontWeight: '600', color: colors.text, paddingRight: 6 },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  fee: { fontSize: 12, color: '#92400E' },
  pdcTag: { alignSelf: 'flex-start', fontSize: 11, fontWeight: '600', color: '#1E40AF', backgroundColor: '#DBEAFE', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 1, overflow: 'hidden' },
  lineBtns: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
  textBtn: { minHeight: 40, minWidth: 64, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.sm },
  textBtnText: { fontSize: font.sm, fontWeight: '600', color: colors.primary },
  addBtn: { minHeight: 48, flexDirection: 'row', gap: 6, borderRadius: radius.md + 2, borderWidth: 1, borderStyle: 'dashed', borderColor: '#A8A29E', alignItems: 'center', justifyContent: 'center' },
  addText: { fontSize: 14, fontWeight: '600', color: colors.primary },
  sumCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md + 2, gap: 6 },
  sumRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  sumLabel: { fontSize: font.sm, color: colors.textLabel, flexShrink: 1 },
  sumValue: { fontSize: font.sm, fontWeight: '600', color: colors.text },
  rule: { height: 1, backgroundColor: colors.border },
  chip: { alignSelf: 'flex-start', fontSize: 12, fontWeight: '600', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, overflow: 'hidden' },
  footer: { paddingTop: spacing.md, paddingHorizontal: spacing.lg, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border, gap: spacing.sm },
  footRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  footAmount: { fontSize: font.lg, fontWeight: '700', color: colors.text },
  sheetRow: { minHeight: 60, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, borderBottomWidth: 1, borderBottomColor: '#F1EDE4', paddingVertical: spacing.sm },
  sheetName: { fontSize: font.md, fontWeight: '500', color: colors.text },
  sheetTag: { fontSize: 12, fontWeight: '600' },
});
