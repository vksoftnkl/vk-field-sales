import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/screen-header';
import { Button, TextField } from '@/components/ui';
import { lineRemoved, lineSaved, type DraftLine } from '@/features/orders/order-draft';
import { itemName } from '@/features/orders/order-items';
import { decimalInput, lineAmounts, lineProblem, priceForLevel, pricedLevels, startingPrice, toPaise } from '@/features/orders/order-math';
import { orderCustomerQuery, orderItemQuery, priceLevelsQuery, seedLine } from '@/features/orders/queries';
import { formatAmount } from '@/lib/money';
import { useAppDispatch, useAppSelector } from '@/store';
import { colors, font, radius, spacing } from '@/theme';

const LETTERS = ['', 'A', 'B', 'C', 'D'];

/**
 * Order item (the Qt app's OrderItemDetail.qml): one unit's price level, quantity, price,
 * discount (% or ₹ per unit: typing one clears the other) and promotion, with the line total.
 * Save puts it on the order being taken. VK Nex keeps no cost price or rate history on the phone,
 * so those are not shown.
 */
export default function OrderItemScreen() {
  const { iucId } = useLocalSearchParams<{ iucId: string }>();
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const dispatch = useAppDispatch();
  const draft = useAppSelector((st) => st.orderDraft);
  const { data: levelNames } = useLiveQuery(priceLevelsQuery());

  // Read once: the form keeps what the salesman types even if a Sync runs meanwhile.
  const [row] = useState(() => (draft.companyId ? orderItemQuery(draft.companyId, iucId).get() : undefined));
  const [customer] = useState(() => (draft.customerId ? orderCustomerQuery(draft.customerId).get() : undefined));
  const existing = draft.lines.find((l) => l.iucId === iucId);
  const [form, setForm] = useState<DraftLine | null>(() => {
    if (existing) return existing;
    if (!row || !customer) return null;
    const start = startingPrice(row, customer.cusPriceLevelId);
    return start ? seedLine(row, customer, start) : null;
  });
  const [submitted, setSubmitted] = useState(false);

  if (!row || !form) {
    return (
      <View style={st.root}>
        <ScreenHeader title={t('order.itemTitle')} backLabel={t('order.back')} />
        <Text style={st.empty}>{t('order.itemGone')}</Text>
      </View>
    );
  }

  const set = (patch: Partial<DraftLine>) => setForm({ ...form, ...patch });
  const a = lineAmounts(form);
  const problem = lineProblem(form, row.ipmMinPrice);
  const levels = pricedLevels(row);
  const levelLabel = (l: number) => levelNames.find((n) => n.id === l)?.name ?? t('order.level', { letter: LETTERS[l] });
  const name = itemName(row, i18n.language);

  const save = () => {
    setSubmitted(true);
    if (problem) return;
    dispatch(lineSaved(form));
    router.back();
  };
  const remove = () => {
    dispatch(lineRemoved(iucId));
    router.back();
  };

  const minPaise = toPaise(row.ipmMinPrice) ?? 0;
  const problemText = submitted && problem ? t(`order.problems.${problem}`, { min: formatAmount(minPaise) }) : undefined;

  return (
    <View style={st.root}>
      <ScreenHeader title={t('order.itemTitle')} subtitle={`${name} · ${row.unitName}`} backLabel={t('order.back')} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView contentContainerStyle={st.form} keyboardShouldPersistTaps="handled">
          {levels.length > 1 ? (
            <View style={st.levels} accessibilityRole="radiogroup" accessibilityLabel={t('order.priceLevel')}>
              {levels.map((l) => {
                const on = form.priceLevel === l;
                const price = priceForLevel(row, l)!;
                return (
                  <Pressable
                    key={l}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: on }}
                    onPress={() => set({ priceLevel: l, price })}
                    style={[st.level, on && st.levelOn]}
                  >
                    <Text style={[st.levelText, on && st.levelTextOn]} numberOfLines={1}>
                      {levelLabel(l)}
                    </Text>
                    <Text style={[st.levelPrice, on && st.levelTextOn]}>{formatAmount(toPaise(price) ?? 0)}</Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}

          <View style={st.grid}>
            <View style={st.cell}>
              <TextField
                label={t('order.qty')}
                value={form.qty}
                onChangeText={(v) => set({ qty: decimalInput(v, 3) })}
                keyboardType="decimal-pad"
                autoFocus={!existing}
                selectTextOnFocus
                maxLength={9}
                error={submitted && problem === 'noQty' ? t('order.problems.noQty') : undefined}
              />
            </View>
            <View style={st.cell}>
              <TextField
                label={t('order.price')}
                value={form.price}
                onChangeText={(v) => set({ price: decimalInput(v) })}
                keyboardType="decimal-pad"
                selectTextOnFocus
                maxLength={12}
                error={submitted && (problem === 'noPrice' || problem === 'belowMin') ? problemText : undefined}
              />
            </View>
            <View style={st.cell}>
              <TextField label={t('order.mrpLabel')} value={row.ipmMaxPrice ?? '—'} editable={false} style={st.readOnly} />
            </View>
            <View style={st.cell} />
            <View style={st.cell}>
              <TextField
                label={t('order.discPerc')}
                value={form.discPerc}
                onChangeText={(v) => set({ discPerc: decimalInput(v), discPerUnit: '' })}
                keyboardType="decimal-pad"
                selectTextOnFocus
                maxLength={6}
                error={submitted && problem === 'discTooBig' ? problemText : undefined}
              />
            </View>
            <View style={st.cell}>
              <TextField
                label={t('order.discPerUnit')}
                value={form.discPerUnit}
                onChangeText={(v) => set({ discPerUnit: decimalInput(v), discPerc: '' })}
                keyboardType="decimal-pad"
                selectTextOnFocus
                maxLength={10}
              />
            </View>
          </View>
          <TextField label={t('order.discAmount')} value={formatAmount(a.discPaise)} editable={false} style={st.readOnly} />

          {form.allowPromo ? (
            <View style={st.switchRow}>
              <Text style={st.switchLabel}>{t('order.promo')}</Text>
              <Switch
                value={form.promo}
                onValueChange={(v) => set({ promo: v })}
                accessibilityLabel={t('order.promo')}
                trackColor={{ true: colors.primary, false: colors.inputBorder }}
                thumbColor={colors.surface}
              />
            </View>
          ) : null}

          <View style={st.total} accessible accessibilityLabel={`${t('order.total')}: ${formatAmount(a.netPaise)}`}>
            <Text style={st.totalLabel}>{t('order.total')}</Text>
            <Text style={st.totalValue}>{formatAmount(a.netPaise)}</Text>
          </View>
          {submitted && problem === 'notPositive' ? <Text style={st.error}>{problemText}</Text> : null}

          {existing ? (
            <Pressable accessibilityRole="button" onPress={remove} style={st.remove} hitSlop={8}>
              <Text style={st.removeText}>{t('order.remove')}</Text>
            </Pressable>
          ) : null}
        </ScrollView>
        <View style={[st.footer, { paddingBottom: insets.bottom + spacing.lg }]}>
          <Button title={t('order.save')} onPress={save} style={{ height: 52 }} />
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  empty: { textAlign: 'center', fontSize: font.md, color: colors.textMuted, padding: spacing.xxl },
  form: { padding: spacing.lg, gap: spacing.sm },
  levels: { flexDirection: 'row', gap: 6, backgroundColor: '#EEECE9', borderRadius: radius.md + 2, padding: 4, marginBottom: spacing.sm },
  level: { flex: 1, minHeight: 48, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  levelOn: { backgroundColor: colors.surface },
  levelText: { fontSize: font.sm, color: colors.textLabel },
  levelPrice: { fontSize: font.sm, fontWeight: '600', color: colors.textLabel },
  levelTextOn: { color: colors.primary, fontWeight: '600' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 10 },
  cell: { flexBasis: '47%', flexGrow: 1 },
  readOnly: { backgroundColor: '#EEECE9', color: colors.textMuted, borderColor: colors.border },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 52,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md + 2,
    paddingHorizontal: spacing.md + 2,
  },
  switchLabel: { fontSize: font.md, color: colors.text },
  total: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md, marginTop: spacing.xs },
  totalLabel: { fontSize: font.md, fontWeight: '600', color: colors.text },
  totalValue: { fontSize: font.xl, fontWeight: '700', color: colors.text },
  error: { fontSize: font.sm, color: colors.danger },
  remove: { alignSelf: 'center', minHeight: 44, justifyContent: 'center', marginTop: spacing.sm },
  removeText: { fontSize: font.md, fontWeight: '600', color: colors.danger },
  footer: { paddingTop: spacing.md, paddingHorizontal: spacing.lg, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
});
