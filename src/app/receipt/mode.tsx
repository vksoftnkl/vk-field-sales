import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CalendarDialog } from '@/components/calendar-dialog';
import { ScreenHeader } from '@/components/screen-header';
import { Button, TextField } from '@/components/ui';
import { useDateNames } from '@/components/use-date-names';
import { decimalInput } from '@/features/orders/order-math';
import { BANK_MAX, IFSC_MAX, REF_MAX } from '@/features/receipts/queries';
import { tenderChanged, tenderRemoved, type TenderLine } from '@/features/receipts/receipt-draft';
import { amountPaise, surchargePaise, tenderProblem, TENDER_TYPE } from '@/features/receipts/receipt-math';
import { isPostDated } from '@/features/receipts/tender-lines';
import { useReceiptPlan } from '@/features/receipts/use-receipt-plan';
import { formatDay } from '@/lib/date-range';
import { formatAmount } from '@/lib/money';
import { useAppDispatch, useAppSelector } from '@/store';
import { colors, font, radius, spacing } from '@/theme';

/**
 * Payment mode details (canvas 5b, step 3a): a cheque's no., date and bank (branch, IFSC and
 * drawer optional), as the desktop's cheque window; a UPI or transfer's reference. A cheque dated
 * after today is a post-dated cheque (D11). Save keeps it; Cancel on a mode just added takes it
 * off again.
 */
export default function PaymentModeScreen() {
  const { tndId, isNew } = useLocalSearchParams<{ tndId: string; isNew?: string }>();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const names = useDateNames();
  const dispatch = useAppDispatch();
  const draft = useAppSelector((st) => st.receiptDraft);
  const plan = useReceiptPlan(draft.customerId ?? '', draft.companyId ?? '');
  const saved = draft.lines.find((l) => l.tndId === tndId);
  const [line, setLine] = useState<TenderLine | undefined>(saved);
  const [submitted, setSubmitted] = useState(false);
  const [calendar, setCalendar] = useState(false);

  if (!line) {
    return (
      <View style={st.root}>
        <ScreenHeader title={t('receipt.addMode')} backLabel={t('receipt.back')} />
      </View>
    );
  }

  const cheque = line.typeId === TENDER_TYPE.CHEQUE;
  const bank = line.typeId === TENDER_TYPE.BANK;
  const change = (patch: Partial<TenderLine>) => setLine((l) => (l ? { ...l, ...patch } : l));
  const problem = submitted ? tenderProblem(line) : null;
  const err = (keys: readonly string[]) => (problem && keys.includes(problem) ? t(`receipt.tenderProblems.${problem}`) : undefined);
  const fee = surchargePaise(amountPaise(line.amount), line.surchargePerc, line.surchargeFlat);
  const pdc = isPostDated(line, plan.date);
  const onClearing = (plan.settings?.pdcPostingMode ?? '').toUpperCase() === 'ON_CLEARING';

  const cancel = () => {
    if (isNew === '1') dispatch(tenderRemoved(tndId));
    router.back();
  };
  const save = () => {
    setSubmitted(true);
    if (tenderProblem(line)) return;
    const { tndId: _id, ...patch } = line;
    dispatch(tenderChanged({ tndId, patch }));
    router.back();
  };

  const title = cheque ? t('receipt.chequeTitle') : t('receipt.modeTitle', { name: line.name });
  const refLabel = cheque ? t('receipt.chequeNo') : (line.refLabel ?? (bank || line.typeId === TENDER_TYPE.UPI ? t('receipt.utrNo') : t('receipt.refNo')));
  const refNeeded = cheque || line.needsRef;
  const dateText = line.instrumentDate ? `${formatDay(line.instrumentDate, names)}${line.instrumentDate === plan.date ? ` · ${t('so.today')}` : ''}` : '';

  return (
    <View style={st.root}>
      <ScreenHeader title={title} subtitle={cheque ? undefined : line.name} backLabel={t('receipt.back')} onBack={cancel} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView contentContainerStyle={st.body} keyboardShouldPersistTaps="handled">
          <TextField
            label={t('receipt.amountRs')}
            value={line.amount}
            onChangeText={(v) => change({ amount: decimalInput(v) })}
            keyboardType="decimal-pad"
            placeholder="0.00"
            selectTextOnFocus
            maxLength={12}
            required
            error={err(['noAmount'])}
          />
          {fee > 0 ? <Text style={st.fee}>{t('receipt.surcharge', { amount: formatAmount(fee), total: formatAmount(amountPaise(line.amount) + fee) })}</Text> : null}
          <TextField
            label={refLabel}
            value={line.refNo}
            onChangeText={(v) => change({ refNo: v })}
            placeholder={refNeeded ? undefined : t('receipt.optional')}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={REF_MAX}
            required={refNeeded}
            error={err(['chequeNo', 'refNo', 'cardLast4'])}
          />
          {cheque || bank ? (
            <View style={{ gap: 6 }}>
              <Text style={st.label}>
                {cheque ? t('receipt.chequeDate') : t('receipt.transferDate')}
                {cheque ? ' *' : ''}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${cheque ? t('receipt.chequeDate') : t('receipt.transferDate')}: ${dateText || t('receipt.pickDate')}`}
                onPress={() => setCalendar(true)}
                style={[st.dateBtn, problem === 'chequeDate' && { borderColor: colors.danger }]}
              >
                <Text style={[st.dateText, !dateText && { color: colors.textMuted }]}>{dateText || t('receipt.pickDate')}</Text>
                <Ionicons name="calendar-outline" size={18} color={colors.textMuted} />
              </Pressable>
              {problem === 'chequeDate' ? <Text style={st.error}>{t('receipt.tenderProblems.chequeDate')}</Text> : null}
            </View>
          ) : null}
          {cheque ? (
            <>
              <Text style={[st.note, pdc && { color: '#1E40AF' }]}>{pdc ? (onClearing ? t('receipt.pdcOnClearing') : t('receipt.pdcNote')) : t('receipt.pdcHint')}</Text>
              <TextField label={t('receipt.bank')} value={line.bankName} onChangeText={(v) => change({ bankName: v })} maxLength={BANK_MAX} required error={err(['bankName'])} />
              <TextField label={t('receipt.branch')} value={line.chequeBranch ?? ''} onChangeText={(v) => change({ chequeBranch: v })} placeholder={t('receipt.optional')} maxLength={BANK_MAX} />
              <TextField
                label={t('receipt.ifsc')}
                value={line.chequeIfsc ?? ''}
                onChangeText={(v) => change({ chequeIfsc: v.toUpperCase().replace(/[^A-Z0-9]/g, '') })}
                placeholder={t('receipt.optional')}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={IFSC_MAX}
                error={err(['ifsc'])}
              />
              <TextField label={t('receipt.drawer')} value={line.chequeDrawer ?? ''} onChangeText={(v) => change({ chequeDrawer: v })} placeholder={t('receipt.optional')} maxLength={BANK_MAX} />
              <Text style={st.note}>{t('receipt.chequeRules')}</Text>
            </>
          ) : null}
        </ScrollView>
        <View style={[st.footer, { paddingBottom: insets.bottom + spacing.lg }]}>
          <Button title={t('common.cancel')} variant="outline" onPress={cancel} style={{ flex: 1, height: 52 }} />
          <Button title={cheque ? t('receipt.saveCheque') : t('receipt.saveMode')} onPress={save} style={{ flex: 1, height: 52 }} />
        </View>
      </KeyboardAvoidingView>
      <CalendarDialog
        visible={calendar}
        value={line.instrumentDate}
        today={plan.date}
        onCancel={() => setCalendar(false)}
        onPick={(iso) => {
          change({ instrumentDate: iso });
          setCalendar(false);
        }}
      />
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { padding: spacing.lg, gap: spacing.md },
  label: { fontSize: font.sm, fontWeight: '500', color: colors.textLabel },
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
  note: { fontSize: 12.5, color: colors.textMuted, lineHeight: 18 },
  fee: { fontSize: 12, color: '#92400E' },
  footer: { flexDirection: 'row', gap: spacing.sm, paddingTop: spacing.md, paddingHorizontal: spacing.lg, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
});
