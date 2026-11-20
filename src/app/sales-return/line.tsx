import Ionicons from '@expo/vector-icons/Ionicons';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CalendarDialog } from '@/components/calendar-dialog';
import { ScreenHeader } from '@/components/screen-header';
import { PickerSheet } from '@/components/ui';
import { itemName } from '@/features/orders/order-items';
import { decimalInput, num, qtyText } from '@/features/orders/order-math';
import { soItemUnitsQuery } from '@/features/orders/queries';
import { returnLineRemoved, returnLineSaved } from '@/features/returns/return-draft';
import {
  BATCH_NO_MAX,
  CONDITIONS,
  lineKeyOf,
  lineQtyCheck,
  nextSplitNo,
  partAmounts,
  partProblems,
  RETURN_NOTES_MAX,
  type Condition,
  type ReturnPart,
} from '@/features/returns/return-math';
import { partFromBillLine, reasonCondition, useReturnSetup } from '@/features/returns/return-parts';
import { barStyles, CONDITION_TONES, returnStyles } from '@/features/returns/return-styles';
import { billLinesQuery } from '@/features/returns/queries';
import { parseDMY, toDMY } from '@/lib/date-range';
import { formatAmount, todayISO } from '@/lib/money';
import { uuidv7 } from '@/lib/uuid';
import { useAppDispatch, useAppSelector } from '@/store';
import { colors, font, radius, spacing } from '@/theme';

/**
 * Return line, step 3a (canvas 6b): one bill line (or one no-bill item) and its parts. Each part
 * has a quantity (any unit of the item), a condition — Good goes back to saleable stock, Damaged,
 * Expired and Scrap to VK Nex's own stock for them — and notes. Split = the desktop's Ctrl+D: one
 * bill line in two conditions. The bill's rate and lot come with it, read-only; a no-bill line may
 * name its batch and expiry (VK Nex finds the lot). All parts together can't pass what is left.
 */
export default function ReturnLineScreen() {
  const { lineKey } = useLocalSearchParams<{ lineKey: string }>();
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const dispatch = useAppDispatch();
  const d = useAppSelector((st) => st.returnDraft);
  const companyId = d.companyId ?? '';
  const { reasons } = useReturnSetup(companyId);
  const reasonCond = reasonCondition(reasons.find((r) => r.reasonId === d.reasonId));
  const { data: lines } = useLiveQuery(billLinesQuery(d.bill?.sbId ?? '', d.bill?.accYear ?? ''), [d.bill?.sbId, d.bill?.accYear]);
  const billRow = lines.find((r) => `${r.line.billItemId}|${r.line.accYear}` === lineKey);
  const saved = useMemo(() => d.parts.filter((p) => lineKeyOf(p) === lineKey), [d.parts, lineKey]);

  const [parts, setParts] = useState<ReturnPart[]>(saved);
  const [errors, setErrors] = useState<ReturnType<typeof partProblems>>({});
  const [unitFor, setUnitFor] = useState<string | null>(null);
  const [calendarFor, setCalendarFor] = useState<string | null>(null);
  // A bill line opened with nothing typed yet starts with one part on the reason's condition, once
  // its row has loaded (set while rendering, as useDraft resets a sheet's draft).
  const [seeded, setSeeded] = useState(saved.length > 0);
  if (!seeded && billRow) {
    setSeeded(true);
    if (parts.length === 0) setParts([partFromBillLine(billRow, reasonCond)]);
  }

  const first = parts[0];
  const { data: units } = useLiveQuery(soItemUnitsQuery(companyId, first?.itemId ?? ''), [companyId, first?.itemId]);
  const unitOptions = units.length
    ? units.map((u) => ({ value: u.iucId, label: u.unitName }))
    : first
      ? [{ value: first.iucId, label: first.unitName }]
      : [];

  if (!first) {
    return (
      <View style={st.root}>
        <ScreenHeader title={t('sr.line.title')} backLabel={t('sr.back')} />
        <Text style={st.empty}>{t('sr.line.gone')}</Text>
      </View>
    );
  }

  const name = itemName({ itemNameEn: first.name, itemNameTa: first.nameTa }, i18n.language);
  const set = (key: string, patch: Partial<ReturnPart>) => setParts((ps) => ps.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  const split = () =>
    setParts((ps) => [...ps, { ...first, key: uuidv7(), splitNo: nextSplitNo(ps, lineKey), qty: '', condition: first.condition === 'RESTOCK' ? 'DAMAGED' : 'RESTOCK', notes: '' }]);
  const check = billRow ? lineQtyCheck(parts, billRow.line) : null;
  const billFactor = billRow ? num(billRow.line.toBaseFactor) || 1 : 1;
  const inBillUnit = (base: number) => qtyText(base / billFactor);
  const total = parts.reduce((s, p) => s + partAmounts(p).netPaise, 0);
  const taxable = parts.reduce((s, p) => s + partAmounts(p).taxablePaise, 0);

  const save = () => {
    const problems = partProblems(parts);
    setErrors(problems);
    if (Object.keys(problems).length) return;
    if (check && check.over > 0) return Alert.alert(t('sr.items.tooManyTitle'), t('sr.line.tooMany', { left: inBillUnit(check.leftBase), unit: billRow?.line.unitName ?? '' }));
    dispatch(returnLineSaved({ lineKey, parts }));
    router.back();
  };
  const remove = () => {
    dispatch(returnLineRemoved(lineKey));
    router.back();
  };

  const unitPart = parts.find((p) => p.key === unitFor);
  const calPart = parts.find((p) => p.key === calendarFor);

  return (
    <View style={st.root}>
      <ScreenHeader title={name} subtitle={billRow && d.bill ? t('sr.line.ofBill', { line: billRow.line.lineNo, bill: d.bill.refno }) : t('sr.line.noBill')} backLabel={t('sr.back')} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView contentContainerStyle={st.body} keyboardShouldPersistTaps="handled">
          {billRow ? (
            <View style={st.facts}>
              <Fact label={t('sr.line.billed')} value={`${inBillUnit(num(billRow.line.billQtyBase))} ${billRow.line.unitName ?? ''}`} />
              <Fact label={t('sr.line.backBefore')} value={inBillUnit(num(billRow.line.returnedQtyBase))} />
              <Fact label={t('sr.line.canReturn')} value={inBillUnit(num(billRow.line.qtyLeftBase))} tone={colors.success} />
              <View style={st.locked}>
                <Ionicons name="lock-closed-outline" size={14} color={colors.textMuted} />
                <Text style={st.lockedText}>
                  {[
                    billRow.line.isFree
                      ? t('sr.line.freeRate')
                      : t('sr.line.rate', { rate: formatAmount(Math.round(num(billRow.line.ratePreTaxBase) * billFactor * 100)), unit: billRow.line.unitName ?? '' }),
                    t('sr.line.gst', { perc: qtyText(num(billRow.line.taxPerc)) }),
                    billRow.line.batchNo ? t('sr.line.batch', { batch: billRow.line.batchNo }) : null,
                    billRow.line.expiryDate ? t('sr.line.exp', { date: toDMY(billRow.line.expiryDate) }) : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </View>
            </View>
          ) : (
            <View style={st.facts}>
              <View style={st.locked}>
                <Ionicons name="lock-closed-outline" size={14} color={colors.textMuted} />
                <Text style={st.lockedText}>{first.rateSource === 'LAST_SALE' ? t('sr.noBill.lastSaleShort', { bill: first.rateFrom ?? '' }) : t('sr.noBill.todayShort')}</Text>
              </View>
            </View>
          )}

          {parts.map((p, i) => {
            const e = errors[p.key] ?? {};
            return (
              <View key={p.key} style={st.part}>
                {i > 0 ? (
                  <View style={st.between}>
                    <Text style={st.splitTitle}>{t('sr.line.splitTitle')}</Text>
                    <Pressable accessibilityRole="button" onPress={() => setParts((ps) => ps.filter((x) => x.key !== p.key))} style={st.textBtn}>
                      <Text style={st.removeText}>{t('sr.line.removeSplit')}</Text>
                    </Pressable>
                  </View>
                ) : null}
                <View style={st.qtyRow}>
                  <View style={{ flex: 1, gap: 6 }}>
                    <Text style={st.label}>{t('sr.line.qty')}</Text>
                    <TextInput
                      value={p.qty}
                      onChangeText={(v) => set(p.key, { qty: decimalInput(v, 3) })}
                      keyboardType="decimal-pad"
                      accessibilityLabel={t('sr.line.qty')}
                      style={[st.input, st.qtyInput, !!e.qty && st.inputError]}
                    />
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('sr.line.unitLabel', { unit: p.unitName })}
                    disabled={unitOptions.length < 2}
                    onPress={() => setUnitFor(p.key)}
                    style={[st.unitBtn, unitOptions.length < 2 && { opacity: 0.7 }]}
                  >
                    <Text style={st.unitText}>{p.unitName}</Text>
                    {unitOptions.length > 1 ? <Ionicons name="chevron-down" size={16} color={colors.text} /> : null}
                  </Pressable>
                </View>
                {e.qty ? <Text style={st.error}>{t('sr.line.noQty')}</Text> : null}
                <View style={st.conds} accessibilityRole="radiogroup" accessibilityLabel={t('sr.line.condition')}>
                  {CONDITIONS.map((c: Condition) => {
                    const on = p.condition === c;
                    const tone = CONDITION_TONES[c];
                    return (
                      <Pressable
                        key={c}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: on }}
                        onPress={() => set(p.key, { condition: c })}
                        style={[st.cond, on && { backgroundColor: tone.bg, borderColor: tone.fg, borderWidth: 1.5 }]}
                      >
                        <Text style={[st.condText, on && { color: tone.fg, fontWeight: '600' }]}>{t(`sr.condition.${c}`)}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                {i === 0 ? <Text style={st.hint}>{t('sr.line.conditionHint')}</Text> : null}
                <View style={{ gap: 6 }}>
                  <Text style={st.label}>{t('sr.line.notes')}</Text>
                  <TextInput value={p.notes} onChangeText={(v) => set(p.key, { notes: v.slice(0, RETURN_NOTES_MAX) })} placeholder={t('sr.line.notesHint')} placeholderTextColor={colors.textMuted} style={st.input} />
                </View>
                {!p.billItemId ? (
                  <View style={st.qtyRow}>
                    <View style={{ flex: 1, gap: 6 }}>
                      <Text style={st.label}>{t('sr.line.batchNo')}</Text>
                      <TextInput value={p.batchNo} autoCapitalize="characters" onChangeText={(v) => set(p.key, { batchNo: v.slice(0, BATCH_NO_MAX) })} style={st.input} />
                    </View>
                    <View style={{ width: 150, gap: 6 }}>
                      <Text style={st.label}>{t('sr.line.expiry')}</Text>
                      <View style={[st.input, st.dateBox, !!e.expiryDate && st.inputError]}>
                        <TextInput value={p.expiryDate} onChangeText={(v) => set(p.key, { expiryDate: v })} placeholder="dd-mm-yyyy" placeholderTextColor={colors.textMuted} style={{ flex: 1, fontSize: font.md, padding: 0 }} />
                        <Pressable accessibilityRole="button" accessibilityLabel={t('sr.line.pickDate')} onPress={() => setCalendarFor(p.key)} hitSlop={8}>
                          <Ionicons name="calendar-outline" size={20} color={colors.primary} />
                        </Pressable>
                      </View>
                    </View>
                  </View>
                ) : null}
                {e.expiryDate ? <Text style={st.error}>{t('sr.line.badDate')}</Text> : null}
              </View>
            );
          })}

          {billRow ? (
            <Pressable accessibilityRole="button" onPress={split} style={st.splitBtn}>
              <Text style={st.splitBtnText}>{t('sr.line.split')}</Text>
            </Pressable>
          ) : null}

          <View style={st.amountCard}>
            <View style={st.between}>
              <Text style={st.small}>{t('sr.line.taxable')}</Text>
              <Text style={st.amountText}>{formatAmount(taxable)}</Text>
            </View>
            <View style={st.between}>
              <Text style={st.small}>{t('sr.line.gstAmount')}</Text>
              <Text style={st.amountText}>{formatAmount(total - taxable)}</Text>
            </View>
            <View style={[st.between, st.totalRow]}>
              <Text style={st.totalText}>{t('sr.line.estimate')}</Text>
              <Text style={st.totalText}>{formatAmount(total)}</Text>
            </View>
            {check ? (
              <Text style={[st.small, { color: check.over > 0 ? colors.danger : colors.success }]}>
                {check.over > 0
                  ? t('sr.line.over', { left: inBillUnit(check.leftBase), unit: billRow?.line.unitName ?? '' })
                  : t('sr.line.leftAfter', { asked: inBillUnit(check.askedBase), left: inBillUnit(check.leftBase - check.askedBase), unit: billRow?.line.unitName ?? '' })}
              </Text>
            ) : null}
          </View>
        </ScrollView>

        <View style={[barStyles.bar, { paddingBottom: insets.bottom + spacing.lg }]}>
          {saved.length ? (
            <Pressable accessibilityRole="button" onPress={remove} style={st.removeBtn}>
              <Text style={st.removeBtnText}>{t('sr.line.removeLine')}</Text>
            </Pressable>
          ) : null}
          <Pressable accessibilityRole="button" onPress={save} style={({ pressed }) => [barStyles.barBtn, { flex: 1 }, pressed && { opacity: 0.85 }]}>
            <Text style={barStyles.barBtnText}>{t('sr.line.save')}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      <PickerSheet
        visible={!!unitPart}
        title={t('sr.line.pickUnit')}
        value={unitPart?.iucId ?? ''}
        options={unitOptions}
        onPick={(iucId) => {
          const u = units.find((x) => x.iucId === iucId);
          if (unitPart && u) set(unitPart.key, { iucId, unitName: u.unitName, factor: String(u.factor) });
          setUnitFor(null);
        }}
        onClose={() => setUnitFor(null)}
      />
      <CalendarDialog
        visible={!!calPart}
        value={calPart ? parseDMY(calPart.expiryDate) : null}
        today={todayISO()}
        onPick={(iso: string) => {
          if (calPart) set(calPart.key, { expiryDate: toDMY(iso) });
          setCalendarFor(null);
        }}
        onCancel={() => setCalendarFor(null)}
      />
    </View>
  );
}

function Fact({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <View style={st.fact} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={st.small}>{label}</Text>
      <Text style={[st.factValue, tone ? { color: tone } : null]}>{value}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  ...returnStyles,
  facts: { flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md + 2 },
  fact: { width: '33%', gap: 2 },
  factValue: { fontSize: font.md, fontWeight: '600', color: colors.text },
  locked: { width: '100%', flexDirection: 'row', alignItems: 'center', gap: 6 },
  lockedText: { flex: 1, fontSize: 12.5, color: colors.textLabel },
  part: { gap: 10, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md + 2 },
  splitTitle: { fontSize: 14, fontWeight: '600', color: colors.text },
  textBtn: { minHeight: 36, justifyContent: 'center', paddingHorizontal: 4 },
  removeText: { fontSize: font.sm, color: colors.danger },
  qtyRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  label: { fontSize: font.sm, fontWeight: '500', color: colors.textLabel },
  input: { minHeight: 46, borderWidth: 1, borderColor: colors.inputBorder, borderRadius: radius.md + 2, paddingHorizontal: spacing.md, fontSize: font.md, color: colors.text, backgroundColor: colors.surface },
  qtyInput: { fontSize: 18, fontWeight: '700', borderColor: colors.primary, borderWidth: 2 },
  inputError: { borderColor: colors.danger },
  dateBox: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  unitBtn: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.inputBorder, borderRadius: radius.md + 2, backgroundColor: colors.surface },
  unitText: { fontSize: 14, fontWeight: '600', color: colors.text },
  conds: { flexDirection: 'row', gap: 6 },
  cond: { flex: 1, minHeight: 44, borderWidth: 1, borderColor: colors.inputBorder, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  condText: { fontSize: font.sm, color: colors.textLabel },
  error: { fontSize: 12.5, color: colors.danger },
  splitBtn: { minHeight: 44, borderWidth: 1, borderStyle: 'dashed', borderColor: '#A8A29E', borderRadius: radius.md + 2, alignItems: 'center', justifyContent: 'center' },
  splitBtnText: { fontSize: 14, fontWeight: '600', color: colors.primary },
  amountCard: { gap: 6, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md + 2 },
  amountText: { fontSize: 14, color: colors.text },
  totalRow: { borderTopWidth: 1, borderTopColor: '#F1EDE4', paddingTop: 6 },
  totalText: { fontSize: 16, fontWeight: '700', color: colors.text },
  removeBtn: { minHeight: 52, paddingHorizontal: 18, borderRadius: radius.md + 2, borderWidth: 1, borderColor: '#FCA5A5', alignItems: 'center', justifyContent: 'center' },
  removeBtnText: { fontSize: font.md, fontWeight: '600', color: colors.danger },
  empty: { textAlign: 'center', fontSize: font.md, color: colors.textMuted, padding: spacing.xl },
});
