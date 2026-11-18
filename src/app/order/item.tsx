import Ionicons from '@expo/vector-icons/Ionicons';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/screen-header';
import { TextField } from '@/components/ui';
import { useDateNames } from '@/components/use-date-names';
import { metaQuery } from '@/db/meta';
import { lineRemoved, lineSaved, type SoLine } from '@/features/orders/order-draft';
import { itemName } from '@/features/orders/order-items';
import { decimalInput, num, priceForLevel, pricedLevels, qtyText, startingPrice, toPaise } from '@/features/orders/order-math';
import { asOfText } from '@/features/orders/order-status';
import { lastRates, orderCustomerQuery, priceLevelsQuery, soItemUnitsQuery, soSeedLine, type OrderCustomer, type SoUnitRow } from '@/features/orders/queries';
import { backOrderQty, DISC_MODES, soLineAmounts, soLineProblem, unitsPerDefault, type DiscMode } from '@/features/orders/so-math';
import { formatDay } from '@/lib/date-range';
import { formatAmount } from '@/lib/money';
import { useAppDispatch, useAppSelector } from '@/store';
import { colors, font, radius, spacing } from '@/theme';

const LETTERS = ['', 'A', 'B', 'C', 'D'];
const pct = (perc: string | null) => String(Number(num(perc).toFixed(3)));

/** The line again in another unit: that unit's price at the same level, its charges and limits. */
function inUnit(form: SoLine, u: SoUnitRow, c: OrderCustomer): SoLine | null {
  const same = form.priceLevel ? priceForLevel(u, form.priceLevel) : null;
  const start = same && form.priceLevel ? { level: form.priceLevel, price: same } : startingPrice(u, c.cusPriceLevelId);
  if (!start) return null;
  return { ...soSeedLine(u, c, start), qty: form.qty, discMode: form.discMode, disc: form.disc };
}

/**
 * Order item (canvas 3b, step 4): the unit (the item's unit list), price level A–D, quantity and
 * rate, the item discount as %, ₹ per unit or ₹ for the line, and the line's taxable, GST split and
 * total. A rate below the minimum price or above the MRP is refused here, because VK Nex doesn't
 * check them on phone orders. Last rates come from this phone's bills and orders for the shop.
 * No cost price: VK Nex sends none to phones. Promotion is the customer's and item's flags.
 */
export default function OrderItemScreen() {
  const { itemId } = useLocalSearchParams<{ itemId: string }>();
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const names = useDateNames();
  const dispatch = useAppDispatch();
  const draft = useAppSelector((st) => st.orderDraft);
  const { data: levelNames } = useLiveQuery(priceLevelsQuery());
  const { data: synced } = useLiveQuery(metaQuery('itemsSyncedAt'));

  // Read once: the form keeps what the salesman types even if a Sync runs meanwhile.
  const [units] = useState(() => (draft.companyId ? soItemUnitsQuery(draft.companyId, itemId).all() : []));
  const [customer] = useState(() => (draft.customerId ? orderCustomerQuery(draft.customerId).get() : undefined));
  const [rates] = useState(() => (draft.customerId ? lastRates(draft.customerId, itemId, draft.editingSoId) : []));
  const existing = draft.lines.find((l) => l.itemId === itemId);
  const priced = units.filter((u) => u.appPriced);
  const [form, setForm] = useState<SoLine | null>(() => {
    if (existing) return existing;
    const u = priced.find((x) => x.isDefault) ?? priced[0];
    if (!u || !customer) return null;
    const start = startingPrice(u, customer.cusPriceLevelId);
    return start ? soSeedLine(u, customer, start) : null;
  });
  const [submitted, setSubmitted] = useState(false);
  const [showRates, setShowRates] = useState(false);

  const unit = form ? units.find((u) => u.iucId === form.iucId) : undefined;
  if (!form || !customer) {
    return (
      <View style={st.root}>
        <ScreenHeader title={t('order.itemTitle')} backLabel={t('so.backToItems')} />
        <Text style={st.empty}>{t('order.itemGone')}</Text>
      </View>
    );
  }

  const set = (patch: Partial<SoLine>) => setForm({ ...form, ...patch });
  const a = soLineAmounts(form);
  const problem = soLineProblem(form, { minPrice: form.minPrice, mrp: form.mrp });
  const levels = unit ? pricedLevels(unit) : [];
  const levelLabel = (l: number) => levelNames.find((n) => n.id === l)?.name ?? t('order.level', { letter: LETTERS[l] });
  const own = customer.cusPriceLevelId;
  const name = itemName({ itemNameEn: form.name, itemNameTa: form.nameTa }, i18n.language);
  const defaultUnit = units.find((u) => u.isDefault) ?? units[0];
  const stock = Number(unit?.stockQty) || 0;
  const back = backOrderQty(num(form.qty), stock);
  const rate = num(form.taxPerc);
  const minPaise = toPaise(form.minPrice) ?? 0;
  const mrpPaise = toPaise(form.mrp) ?? 0;
  const syncedOn = synced[0]?.value;

  const save = () => {
    setSubmitted(true);
    if (problem) return;
    dispatch(lineSaved(form));
    router.back();
  };
  const remove = () => {
    dispatch(lineRemoved(itemId));
    router.back();
  };
  const pickUnit = (u: SoUnitRow) => {
    const next = inUnit(form, u, customer);
    if (next) setForm(next);
  };

  const msg = (p: string) => t(`so.problems.${p}`, { min: formatAmount(minPaise), mrp: formatAmount(mrpPaise) });
  const qtyError = submitted && problem === 'noQty' ? msg(problem) : undefined;
  const rateError = submitted && (problem === 'noPrice' || problem === 'belowMin' || problem === 'aboveMrp') ? msg(problem) : undefined;
  const discError = submitted && (problem === 'discTooBig' || problem === 'notPositive') ? msg(problem) : undefined;
  const discLabel =
    form.discMode === 'perc' ? t('so.discPerc', { perc: form.disc || '0' }) : form.discMode === 'perUnit' ? t('so.discPerUnit', { amount: formatAmount(toPaise(form.disc) ?? 0) }) : t('so.discount');

  return (
    <View style={st.root}>
      <ScreenHeader title={t('order.itemTitle')} subtitle={t('so.itemSubtitle', { name, gst: pct(form.taxPerc) })} backLabel={t('so.backToItems')} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView contentContainerStyle={st.form} keyboardShouldPersistTaps="handled">
          {priced.length > 1 ? (
            <View style={{ gap: 6 }}>
              <Text style={st.label}>{t('so.unit')}</Text>
              <View style={st.segment} accessibilityRole="radiogroup" accessibilityLabel={t('so.unit')}>
                {priced.map((u) => {
                  const on = u.iucId === form.iucId;
                  const per = unitsPerDefault(u.factor, defaultUnit?.factor ?? '1');
                  const text = u.iucId === defaultUnit?.iucId || per === 1 ? u.unitName : t('so.unitOf', { unit: u.unitName, n: qtyText(per), base: defaultUnit?.unitName ?? '' });
                  return (
                    <Pressable key={u.iucId} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => pickUnit(u)} style={[st.seg, on && st.segOn]}>
                      <Text style={[st.segText, on && st.segTextOn]} numberOfLines={1}>
                        {text}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}

          {levels.length > 1 && unit ? (
            <View style={{ gap: 6 }}>
              <Text style={st.label}>{own ? t('so.levelOwn', { level: LETTERS[own] ?? levelLabel(own) }) : t('order.priceLevel')}</Text>
              <View style={st.segment} accessibilityRole="radiogroup" accessibilityLabel={t('order.priceLevel')}>
                {levels.map((l) => {
                  const on = form.priceLevel === l;
                  const price = priceForLevel(unit, l)!;
                  return (
                    <Pressable
                      key={l}
                      accessibilityRole="radio"
                      accessibilityLabel={`${levelLabel(l)} ${formatAmount(toPaise(price) ?? 0)}`}
                      accessibilityState={{ checked: on }}
                      onPress={() => set({ priceLevel: l, price })}
                      style={[st.seg, st.level, on && st.segOn]}
                    >
                      <Text style={[st.levelText, on && st.segTextOn]} numberOfLines={1}>
                        {LETTERS[l]}
                      </Text>
                      <Text style={[st.levelPrice, on && st.segTextOn]}>{formatAmount(toPaise(price) ?? 0).replace(/\.00$/, '')}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}

          <View style={st.grid}>
            <View style={st.cell}>
              <TextField
                label={t('so.qtyUnit', { unit: form.unitName })}
                value={form.qty}
                onChangeText={(v) => set({ qty: decimalInput(v, 3) })}
                keyboardType="decimal-pad"
                autoFocus={!existing}
                selectTextOnFocus
                maxLength={9}
                error={qtyError}
              />
              <Text style={[st.hint, back > 0 && { color: '#92400E' }]}>
                {back > 0
                  ? t('so.backOrderHint', { stock: qtyText(stock), qty: qtyText(back) })
                  : syncedOn
                    ? t('so.stockHint', { stock: qtyText(stock), when: asOfText(syncedOn, names, t('so.today')) })
                    : t('order.stock', { qty: qtyText(stock) })}
              </Text>
            </View>
            <View style={st.cell}>
              <TextField
                label={form.inclTax && rate > 0 ? t('so.rateIncl') : t('so.rateExcl')}
                value={form.price}
                onChangeText={(v) => set({ price: decimalInput(v), priceLevel: null })}
                keyboardType="decimal-pad"
                selectTextOnFocus
                maxLength={12}
                error={rateError}
              />
              <Text style={st.hint}>
                {[minPaise ? t('so.minHint', { amount: formatAmount(minPaise) }) : null, mrpPaise ? t('order.mrp', { price: formatAmount(mrpPaise) }) : null].filter(Boolean).join(' · ') || ' '}
              </Text>
            </View>
          </View>

          <View style={{ gap: 6 }}>
            <Text style={st.label}>{t('so.itemDiscount')}</Text>
            <View style={st.discRow}>
              <View style={[st.segment, { flex: 1 }]} accessibilityRole="radiogroup" accessibilityLabel={t('so.itemDiscount')}>
                {DISC_MODES.map((m: DiscMode) => {
                  const on = form.discMode === m;
                  return (
                    <Pressable key={m} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => set({ discMode: m })} style={[st.seg, { minHeight: 40 }, on && st.segOn]}>
                      <Text style={[st.segText, on && st.segTextOn]}>{t(`so.discModes.${m}`)}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <TextInput
                value={form.disc}
                onChangeText={(v) => set({ disc: decimalInput(v) })}
                keyboardType="decimal-pad"
                placeholder="0"
                placeholderTextColor={colors.textMuted}
                accessibilityLabel={t(`so.discModes.${form.discMode}`)}
                selectTextOnFocus
                maxLength={10}
                style={[st.discInput, !!discError && { borderColor: colors.danger }]}
              />
            </View>
            {discError ? <Text style={st.error}>{discError}</Text> : null}
          </View>

          <View style={st.card} accessibilityLabel={t('so.lineAmount')}>
            <Row label={t('so.grossLine', { qty: qtyText(a.qty), price: formatAmount(toPaise(form.price) ?? 0) })} value={formatAmount(a.grossPaise)} />
            {a.discPaise > 0 ? <Row label={discLabel} value={`−${formatAmount(a.discPaise)}`} /> : null}
            <Row label={t('so.taxable')} value={formatAmount(a.taxablePaise)} />
            <Row label={rate > 0 ? t('so.gstSplit', { gst: pct(form.taxPerc), half: String(Number((rate / 2).toFixed(3))) }) : t('so.noGst')} value={formatAmount(a.taxPaise)} />
            <View style={st.totalRow} accessible accessibilityLabel={`${t('so.lineTotal')}: ${formatAmount(a.lineTotalPaise)}`}>
              <Text style={st.totalLabel}>{t('so.lineTotal')}</Text>
              <Text style={st.totalValue}>{formatAmount(a.lineTotalPaise)}</Text>
            </View>
            {a.freightPaise + a.loadPaise > 0 ? (
              <Text style={st.hint}>{t('so.chargesNote', { freight: formatAmount(a.freightPaise), load: formatAmount(a.loadPaise) })}</Text>
            ) : null}
          </View>

          <Pressable accessibilityRole="button" accessibilityState={{ expanded: showRates }} onPress={() => setShowRates(!showRates)} style={st.rates}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={st.ratesTitle}>{t('so.lastRates')}</Text>
              <Text style={st.hint}>
                {rates[0] ? t('so.rateRow', { date: formatDay(rates[0].date, names), qty: qtyText(num(rates[0].qty)), unit: rates[0].unitName, rate: formatAmount(toPaise(rates[0].rate) ?? 0) }) : t('so.noRates')}
              </Text>
            </View>
            {rates.length > 1 ? <Ionicons name={showRates ? 'chevron-up' : 'chevron-down'} size={16} color={colors.primary} /> : null}
          </Pressable>
          {showRates
            ? rates.slice(1).map((r, i) => (
                <Text key={i} style={[st.hint, { paddingHorizontal: spacing.md + 2 }]}>
                  {t('so.rateRow', { date: formatDay(r.date, names), qty: qtyText(num(r.qty)), unit: r.unitName, rate: formatAmount(toPaise(r.rate) ?? 0) })}
                </Text>
              ))
            : null}
        </ScrollView>
        <View style={[st.footer, { paddingBottom: insets.bottom + spacing.lg }]}>
          {existing ? (
            <Pressable accessibilityRole="button" onPress={remove} style={({ pressed }) => [st.btn, st.btnRemove, pressed && { opacity: 0.85 }]}>
              <Text style={[st.btnText, { color: colors.danger }]}>{t('so.remove')}</Text>
            </Pressable>
          ) : null}
          <Pressable accessibilityRole="button" onPress={save} style={({ pressed }) => [st.btn, st.btnPrimary, { flex: 2 }, pressed && { opacity: 0.85 }]}>
            <Text style={[st.btnText, { color: colors.onPrimary }]}>{t('so.saveLine')}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={st.row}>
      <Text style={st.rowLabel}>{label}</Text>
      <Text style={st.rowValue}>{value}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  empty: { textAlign: 'center', fontSize: font.md, color: colors.textMuted, padding: spacing.xxl },
  form: { padding: spacing.lg, paddingTop: spacing.md + 2, gap: spacing.md },
  label: { fontSize: font.sm, fontWeight: '500', color: colors.textLabel },
  segment: { flexDirection: 'row', gap: 4, backgroundColor: '#EEECE9', borderRadius: radius.md + 2, padding: 4 },
  seg: { flex: 1, minHeight: 44, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  segOn: { backgroundColor: colors.surface },
  segText: { fontSize: 14, color: colors.textLabel },
  segTextOn: { color: colors.primary, fontWeight: '600' },
  level: { minHeight: 48 },
  levelText: { fontSize: 12.5, color: colors.textLabel },
  levelPrice: { fontSize: 12.5, fontWeight: '600', color: colors.textLabel },
  grid: { flexDirection: 'row', gap: 10 },
  cell: { flex: 1 },
  hint: { fontSize: 12, color: colors.textMuted },
  discRow: { flexDirection: 'row', gap: spacing.sm },
  discInput: {
    width: 88,
    height: 48,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: radius.md + 2,
    paddingHorizontal: spacing.md + 2,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.surface,
    textAlign: 'right',
  },
  error: { fontSize: font.sm, color: colors.danger },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, paddingVertical: spacing.md, paddingHorizontal: spacing.md + 2, gap: 6 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  rowLabel: { flex: 1, fontSize: 14, color: colors.textMuted },
  rowValue: { fontSize: 14, color: colors.text },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', borderTopWidth: 1, borderTopColor: '#F1EDE4', paddingTop: spacing.sm, marginTop: 2 },
  totalLabel: { fontSize: font.md, fontWeight: '600', color: colors.text },
  totalValue: { fontSize: 20, fontWeight: '700', color: colors.text },
  rates: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 48,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md + 2,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md + 2,
  },
  ratesTitle: { fontSize: 14, fontWeight: '600', color: colors.primary },
  footer: { flexDirection: 'row', gap: 10, paddingTop: spacing.md, paddingHorizontal: spacing.lg, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
  btn: { flex: 1, minHeight: 52, borderRadius: radius.md + 2, alignItems: 'center', justifyContent: 'center' },
  btnRemove: { backgroundColor: colors.surface, borderWidth: 1, borderColor: '#FCA5A5' },
  btnPrimary: { backgroundColor: colors.primary },
  btnText: { fontSize: font.md, fontWeight: '600' },
});
