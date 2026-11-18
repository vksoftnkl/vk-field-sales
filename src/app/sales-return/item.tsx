import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CalendarDialog } from '@/components/calendar-dialog';
import { ScreenHeader } from '@/components/screen-header';
import { Button, s as ui, TextField } from '@/components/ui';
import { itemName } from '@/features/orders/order-items';
import { decimalInput, qtyText, startingPrice } from '@/features/orders/order-math';
import { returnCustomerQuery, seedReturnLine } from '@/features/returns/queries';
import { returnLineSaved } from '@/features/returns/return-draft';
import {
  BATCH_NO_MAX,
  RETURN_NOTES_MAX,
  RETURN_REASONS,
  returnLineAmounts,
  returnLineProblems,
  type ReturnField,
  type ReturnLine,
} from '@/features/returns/return-math';
import { saleItemQuery } from '@/features/sales/queries';
import { taxRate } from '@/features/sales/sale-math';
import { parseDMY, toDMY } from '@/lib/date-range';
import { formatAmount, todayISO } from '@/lib/money';
import { uuidv7 } from '@/lib/uuid';
import { useAppDispatch, useAppSelector } from '@/store';
import { colors, font, radius, spacing } from '@/theme';

type DateKey = 'batchDate' | 'expiryDate';

/**
 * Return item (the Qt app's ReturnItemDetail.qml): why it came back (damaged or expired stock),
 * how many, at what price (the customer's price to start), the batch and its dates, and notes.
 * Opened from Product list for a new line (Save goes back to the return, past the list), or from
 * a line on the return to change it. Dates are typed dd-mm-yyyy or picked on the calendar.
 */
export default function ReturnItemScreen() {
  const { iucId, lineKey } = useLocalSearchParams<{ iucId?: string; lineKey?: string }>();
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const dispatch = useAppDispatch();
  const draft = useAppSelector((st) => st.returnDraft);
  const today = todayISO();

  // Read once: the form keeps what the salesman types even if a Sync runs meanwhile.
  const [form, setForm] = useState<ReturnLine | null>(() => {
    if (lineKey) return draft.lines.find((l) => l.key === lineKey) ?? null;
    if (!iucId || !draft.companyId || !draft.customerId) return null;
    const row = saleItemQuery(draft.companyId, iucId).get();
    const level = returnCustomerQuery(draft.customerId).get()?.cusPriceLevelId ?? null;
    const start = row ? startingPrice(row, level) : null;
    return row && start ? seedReturnLine(row, start) : null;
  });
  const [submitted, setSubmitted] = useState(false);
  const [calendar, setCalendar] = useState<DateKey | null>(null);

  if (!form) {
    return (
      <View style={st.root}>
        <ScreenHeader title={t('salesReturn.itemTitle')} backLabel={t('salesReturn.back')} />
        <Text style={st.empty}>{t('order.itemGone')}</Text>
      </View>
    );
  }

  const set = (patch: Partial<ReturnLine>) => setForm({ ...form, ...patch });
  const a = returnLineAmounts(form);
  const rate = taxRate(form.taxPerc);
  const problems = returnLineProblems(form, today);
  const errorFor = (f: ReturnField) => (submitted && problems[f] ? t(`salesReturn.problems.${problems[f]}`) : undefined);
  const name = itemName({ itemNameEn: form.name, itemNameTa: form.nameTa }, i18n.language);

  const save = () => {
    setSubmitted(true);
    if (Object.keys(problems).length > 0) return;
    dispatch(returnLineSaved({ ...form, key: form.key || uuidv7(), batchNo: form.batchNo.trim().toUpperCase(), notes: form.notes.trim() }));
    // A new line came through Product list: back to the return past it.
    if (lineKey) router.back();
    else router.dismiss(2);
  };

  return (
    <View style={st.root}>
      <ScreenHeader title={t('salesReturn.itemTitle')} subtitle={`${name} · ${form.unitName}`} backLabel={t('salesReturn.back')} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView contentContainerStyle={st.form} keyboardShouldPersistTaps="handled">
          <Text style={ui.label}>{t('salesReturn.reason')}</Text>
          <View style={st.reasons} accessibilityRole="radiogroup" accessibilityLabel={t('salesReturn.reason')}>
            {RETURN_REASONS.map((r) => {
              const on = form.reason === r;
              return (
                <Pressable
                  key={r}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                  onPress={() => set({ reason: r })}
                  style={[st.reason, on && st.reasonOn]}
                >
                  <Text style={[st.reasonText, on && st.reasonTextOn]}>{t(`salesReturn.reasonStock.${r}`)}</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={st.grid}>
            <View style={st.cell}>
              <TextField
                label={t('salesReturn.returnQty')}
                value={form.qty}
                onChangeText={(v) => set({ qty: decimalInput(v, 3) })}
                keyboardType="decimal-pad"
                autoFocus={!lineKey}
                selectTextOnFocus
                maxLength={9}
                error={errorFor('qty')}
              />
            </View>
            <View style={st.cell}>
              <TextField
                label={t('salesReturn.returnPrice')}
                value={form.price}
                onChangeText={(v) => set({ price: decimalInput(v) })}
                keyboardType="decimal-pad"
                selectTextOnFocus
                maxLength={12}
                error={errorFor('price')}
              />
            </View>
            <View style={st.cell}>
              <TextField label={t('order.mrpLabel')} value={form.mrp ?? '—'} editable={false} style={st.readOnly} />
            </View>
            <View style={st.cell}>
              <TextField
                label={t('salesReturn.batchNo')}
                value={form.batchNo}
                onChangeText={(v) => set({ batchNo: v })}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={BATCH_NO_MAX}
              />
            </View>
            <View style={st.cell}>
              <DateField
                label={t('salesReturn.batchDate')}
                pickLabel={t('salesReturn.pickBatchDate')}
                value={form.batchDate}
                onChange={(v) => set({ batchDate: v })}
                onPick={() => setCalendar('batchDate')}
                error={errorFor('batchDate')}
              />
            </View>
            <View style={st.cell}>
              <DateField
                label={t('salesReturn.expiryDate')}
                pickLabel={t('salesReturn.pickExpiryDate')}
                value={form.expiryDate}
                onChange={(v) => set({ expiryDate: v })}
                onPick={() => setCalendar('expiryDate')}
                error={errorFor('expiryDate')}
              />
            </View>
          </View>

          <TextField
            label={t('salesReturn.notes')}
            value={form.notes}
            onChangeText={(v) => set({ notes: v })}
            multiline
            maxLength={RETURN_NOTES_MAX}
            style={st.notes}
          />

          <View style={st.totals}>
            {rate > 0 ? (
              <View style={st.taxRow}>
                <Text style={st.taxText}>{t('sale.taxLine', { taxable: formatAmount(a.taxablePaise), perc: qtyText(rate) })}</Text>
                <Text style={st.taxText}>{formatAmount(a.taxPaise)}</Text>
              </View>
            ) : null}
            {rate > 0 && form.inclTax ? <Text style={st.taxText}>{t('sale.taxIncl')}</Text> : null}
            <View style={st.total} accessible accessibilityLabel={`${t('salesReturn.total')}: ${formatAmount(a.netPaise)}`}>
              <Text style={st.totalLabel}>{t('salesReturn.total')}</Text>
              <Text style={st.totalValue}>{formatAmount(a.netPaise)}</Text>
            </View>
          </View>
        </ScrollView>
        <View style={[st.footer, { paddingBottom: insets.bottom + spacing.lg }]}>
          <Button title={t('salesReturn.save')} onPress={save} style={{ height: 52 }} />
        </View>
      </KeyboardAvoidingView>

      <CalendarDialog
        visible={calendar !== null}
        value={calendar ? parseDMY(form[calendar]) : null}
        today={today}
        onCancel={() => setCalendar(null)}
        onPick={(iso) => {
          if (calendar) set({ [calendar]: toDMY(iso) });
          setCalendar(null);
        }}
      />
    </View>
  );
}

/** A dd-mm-yyyy box with a calendar button inside it. */
function DateField({
  label,
  pickLabel,
  value,
  onChange,
  onPick,
  error,
}: {
  label: string;
  pickLabel: string;
  value: string;
  onChange: (v: string) => void;
  onPick: () => void;
  error?: string;
}) {
  const { t } = useTranslation();
  const [focused, setFocused] = useState(false);
  return (
    <View style={ui.field}>
      <Text style={ui.label}>{label}</Text>
      <View style={[st.dateBox, focused && st.dateBoxFocused, !!error && { borderColor: colors.danger }]}>
        <TextInput
          value={value}
          onChangeText={(v) => onChange(v.replace(/[^\d\-/.]/g, ''))}
          placeholder={t('salesReturn.datePlaceholder')}
          placeholderTextColor={colors.textMuted}
          accessibilityLabel={label}
          keyboardType="numbers-and-punctuation"
          maxLength={10}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={st.dateInput}
        />
        <Pressable accessibilityRole="button" accessibilityLabel={pickLabel} onPress={onPick} style={st.dateBtn}>
          <Ionicons name="calendar-outline" size={20} color={colors.primary} />
        </Pressable>
      </View>
      {error ? <Text style={ui.fieldError}>{error}</Text> : null}
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  empty: { textAlign: 'center', fontSize: font.md, color: colors.textMuted, padding: spacing.xxl },
  form: { padding: spacing.lg, gap: spacing.sm },
  reasons: {
    flexDirection: 'row',
    gap: 6,
    backgroundColor: '#EEECE9',
    borderRadius: radius.md + 2,
    padding: 4,
    marginBottom: spacing.md,
  },
  reason: { flex: 1, minHeight: 44, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  reasonOn: { backgroundColor: colors.surface },
  reasonText: { fontSize: 14, color: colors.textLabel },
  reasonTextOn: { color: colors.primary, fontWeight: '600' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 10 },
  cell: { flexBasis: '47%', flexGrow: 1 },
  readOnly: { backgroundColor: '#EEECE9', color: colors.textMuted, borderColor: colors.border },
  dateBox: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingLeft: spacing.md,
    paddingRight: 2,
  },
  // 1 px thicker border, 1 px less padding: the text doesn't shift when the field gains focus.
  dateBoxFocused: { borderColor: colors.primary, borderWidth: 2, paddingLeft: spacing.md - 1, paddingRight: 1 },
  dateInput: { flex: 1, minWidth: 0, fontSize: font.md, color: colors.text, padding: 0 },
  dateBtn: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
  notes: { height: 76, paddingTop: spacing.md, textAlignVertical: 'top' },
  totals: { gap: 4, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md },
  taxRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  taxText: { fontSize: font.sm, color: colors.textMuted },
  total: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  totalLabel: { fontSize: font.md, fontWeight: '600', color: colors.text },
  totalValue: { fontSize: font.xl, fontWeight: '700', color: colors.text },
  footer: { paddingTop: spacing.md, paddingHorizontal: spacing.lg, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
});
