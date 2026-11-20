import Ionicons from '@expo/vector-icons/Ionicons';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/screen-header';
import { TextField } from '@/components/ui';
import { useDateNames } from '@/components/use-date-names';
import { metaQuery } from '@/db/meta';
import { lineOffersSet, lineRemoved, lineSaved, type SoLine } from '@/features/orders/order-draft';
import { itemName, unitInBase } from '@/features/orders/order-items';
import { decimalInput, num, priceForLevel, pricedLevels, qtyText, startingPrice, toPaise } from '@/features/orders/order-math';
import { asOfText } from '@/features/orders/order-status';
import { companyQuery, customerName, lastRates, orderCustomerQuery, priceLevelsQuery, soItemUnitsQuery, soSeedLine, type SoUnitRow } from '@/features/orders/queries';
import { backOrderQty, DISC_MODES, soLineAmounts, soLineProblem, type DiscMode } from '@/features/orders/so-math';
import { useUnitQty } from '@/features/orders/unit-sheet';
import { soLineInUnit } from '@/features/orders/unit-switch';
import { isShownOffer } from '@/features/schemes/offer-text';
import { OfferSection } from '@/features/schemes/offer-body';
import { OfferSheet } from '@/features/schemes/offer-sheet';
import { useOrderSchemes } from '@/features/schemes/use-order-schemes';
import { formatDay } from '@/lib/date-range';
import { formatAmount } from '@/lib/money';
import { useAppDispatch, useAppSelector } from '@/store';
import { colors, font, offerColors, radius, spacing } from '@/theme';

const LETTERS = ['', 'A', 'B', 'C', 'D'];
const pct = (perc: string | null) => String(Number(num(perc).toFixed(3)));

/**
 * Order item (canvas 3b, step 4; offers mockup screen 2): the unit (the item's priced units, each with its size in the
 * base unit, "CASE (24 PKT)"; a new line starts in the unit its Add items row showed), price level A–D, quantity and
 * rate, the item discount as %, ₹ per unit or ₹ for the line, and the line's taxable, GST split and
 * total. A rate below the minimum price or above the MRP is refused here, because VK Nex doesn't
 * check them on phone orders. Last rates come from this phone's bills and orders for the shop.
 * No cost price: VK Nex sends none to phones. Promotion is the customer's and item's flags.
 */
export default function OrderItemScreen() {
  const { itemId, iucId } = useLocalSearchParams<{ itemId: string; iucId?: string }>();
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const names = useDateNames();
  const dispatch = useAppDispatch();
  const draft = useAppSelector((st) => st.orderDraft);
  const { data: levelNames } = useLiveQuery(priceLevelsQuery());
  const { data: synced } = useLiveQuery(metaQuery('itemsSyncedAt'));
  const companyId = draft.companyId ?? '';
  const { data: company } = useLiveQuery(companyQuery(companyId), [companyId]);

  // Read once: the form keeps what the salesman types even if a Sync runs meanwhile.
  const [units] = useState(() => (draft.companyId ? soItemUnitsQuery(draft.companyId, itemId).all() : []));
  const [customer] = useState(() => (draft.customerId ? orderCustomerQuery(draft.customerId).get() : undefined));
  const [rates] = useState(() => (draft.customerId ? lastRates(draft.customerId, itemId, draft.editingSoId) : []));
  const existing = draft.lines.find((l) => l.itemId === itemId);
  const priced = units.filter((u) => u.appPriced);
  const [form, setForm] = useState<SoLine | null>(() => {
    if (existing) return existing;
    const u = priced.find((x) => x.iucId === iucId) ?? priced.find((x) => x.isDefault) ?? priced[0];
    if (!u || !customer) return null;
    const start = startingPrice(u, customer.cusPriceLevelId);
    return start ? soSeedLine(u, customer, start) : null;
  });
  const [submitted, setSubmitted] = useState(false);
  const [showRates, setShowRates] = useState(false);
  // The line's own offers switch, kept with the form until Save line.
  const [offersOnLine, setOffersOnLine] = useState(() => draft.offersOn[itemId] !== false);
  const [sheetId, setSheetId] = useState<string | null>(null);
  const { data: schemesSynced } = useLiveQuery(metaQuery('schemesSyncedOn'));

  // The offers worked out as you type: the order's lines with this one as it is in the form.
  const evalLines = useMemo(() => {
    if (!form) return draft.lines;
    return draft.lines.some((l) => l.itemId === itemId) ? draft.lines.map((l) => (l.itemId === itemId ? form : l)) : [...draft.lines, form];
  }, [draft.lines, form, itemId]);
  const evalOn = useMemo(() => ({ ...draft.offersOn, [itemId]: offersOnLine }), [draft.offersOn, itemId, offersOnLine]);
  const { order, applyOffers } = useOrderSchemes({ lines: evalLines, offersOn: evalOn, extraItemIds: [itemId] });
  const lineIndex = evalLines.findIndex((l) => l.itemId === itemId);

  const unitQty = useUnitQty();
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
  const a = soLineAmounts(order.priced[lineIndex] ?? form);
  const ls = order.lines[lineIndex];
  const offers = order.explain(itemId).filter(isShownOffer);
  const sheetScheme = sheetId ? (order.scheme(sheetId) ?? null) : null;
  const problem = soLineProblem(form, { minPrice: form.minPrice, mrp: form.mrp });
  const levels = unit ? pricedLevels(unit) : [];
  const levelLabel = (l: number) => levelNames.find((n) => n.id === l)?.name ?? t('order.level', { letter: LETTERS[l] });
  const own = customer.cusPriceLevelId;
  const name = itemName({ itemNameEn: form.name, itemNameTa: form.nameTa }, i18n.language);
  const stock = Number(unit?.stockQty) || 0;
  const back = backOrderQty(num(form.qty), stock);
  // Stock in the line's unit and in the base unit: "4 Box (48 Pcs)".
  const stockText = unit ? unitQty(stock, unit, units) : qtyText(stock);
  const rate = num(form.taxPerc);
  const minPaise = toPaise(form.minPrice) ?? 0;
  const mrpPaise = toPaise(form.mrp) ?? 0;
  const syncedOn = synced[0]?.value;

  const save = () => {
    setSubmitted(true);
    if (problem) return;
    dispatch(lineSaved(form));
    dispatch(lineOffersSet({ itemId, on: offersOnLine }));
    router.back();
  };
  const remove = () => {
    dispatch(lineRemoved(itemId));
    router.back();
  };
  const pickUnit = (u: SoUnitRow) => {
    const next = soLineInUnit(form, u, customer);
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
      <ScreenHeader title={t('order.itemTitle')} subtitle={t('so.itemShop', { name, shop: customerName(customer) })} backLabel={t('so.backToItems')} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView contentContainerStyle={st.form} keyboardShouldPersistTaps="handled">
          {priced.length > 1 ? (
            <View style={{ gap: 6 }}>
              <Text style={st.label}>{t('so.unit')}</Text>
              <View style={st.segment} accessibilityRole="radiogroup" accessibilityLabel={t('so.unit')}>
                {priced.map((u, i) => {
                  const on = u.iucId === form.iucId;
                  // "CASE (24 PKT)": its size in the base unit (the base unit itself is just its name).
                  const conv = unitInBase(u, units);
                  const text = conv ? t('so.unitOf', { unit: u.unitName, n: qtyText(conv.n), base: conv.base }) : u.unitName;
                  return (
                    <Pressable key={u.iucId} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => pickUnit(u)} style={[st.seg, i === 0 && st.segFirst, on && st.segOn]}>
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
                {levels.map((l, i) => {
                  const on = form.priceLevel === l;
                  const price = priceForLevel(unit, l)!;
                  return (
                    <Pressable
                      key={l}
                      accessibilityRole="radio"
                      accessibilityLabel={`${levelLabel(l)} ${formatAmount(toPaise(price) ?? 0)}`}
                      accessibilityState={{ checked: on }}
                      onPress={() => set({ priceLevel: l, price })}
                      style={[st.seg, st.level, i === 0 && st.segFirst, on && st.segOn]}
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
                  ? t('so.backOrderHint', { stock: stockText, qty: qtyText(back) })
                  : syncedOn
                    ? t('so.stockHint', { stock: stockText, when: asOfText(syncedOn, names, t('so.today')) })
                    : t('order.stock', { qty: stockText })}
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
            <Text style={st.label}>{t('so.yourDiscount')}</Text>
            <View style={st.discRow}>
              <View style={[st.segment, { flex: 1 }]} accessibilityRole="radiogroup" accessibilityLabel={t('so.yourDiscount')}>
                {DISC_MODES.map((m: DiscMode, i) => {
                  const on = form.discMode === m;
                  return (
                    <Pressable key={m} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => set({ discMode: m })} style={[st.seg, i === 0 && st.segFirst, on && st.segOn]}>
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

          {offers.length > 0 ? (
            <View style={st.offerCard} accessibilityLabel={t('offers.card.title')}>
              {offers.map((o, i) => {
                const sc = order.scheme(o.schemeId);
                if (!sc) return null;
                return (
                  <View key={o.schemeId} style={i > 0 && st.offerNext}>
                    <OfferSection scheme={sc} offer={o} unit={form.unitName} onDetails={() => setSheetId(o.schemeId)} />
                  </View>
                );
              })}
              {form.promo ? (
                <View style={st.switchRow}>
                  <View style={{ flex: 1, gap: 1 }}>
                    <Text style={st.switchLabel}>{t('offers.card.switch')}</Text>
                    {!applyOffers ? <Text style={st.hint}>{t('offers.apply.off')}</Text> : null}
                  </View>
                  <Switch
                    value={offersOnLine}
                    onValueChange={setOffersOnLine}
                    accessibilityLabel={t('offers.card.switch')}
                    accessibilityHint={t('offers.card.switchNote')}
                    trackColor={{ true: colors.success, false: colors.inputBorder }}
                    thumbColor={colors.surface}
                  />
                </View>
              ) : (
                <Text style={[st.hint, st.switchRow]}>{t('offers.card.cannot')}</Text>
              )}
            </View>
          ) : null}

          <View style={st.card} accessibilityLabel={t('so.lineAmount')}>
            <Row label={t('so.grossLine', { qty: qtyText(a.qty), price: formatAmount(toPaise(form.price) ?? 0) })} value={formatAmount(a.grossPaise)} />
            {a.discPaise > 0 ? <Row label={discLabel} value={`−${formatAmount(a.discPaise)}`} /> : null}
            {a.schemePaise > 0 && ls ? (
              <Row
                good
                label={
                  Number(ls.schDiscPerc) > 0
                    ? t('offers.line.perc', { name: ls.schemeName ?? '', perc: ls.schDiscPerc })
                    : Number(ls.schDiscQty) > 0
                      ? t('offers.line.perUnit', { name: ls.schemeName ?? '', amount: formatAmount(toPaise(ls.schDiscQty) ?? 0) })
                      : t('offers.line.plain', { name: ls.schemeName ?? '' })
                }
                value={`−${formatAmount(a.schemePaise)}`}
              />
            ) : null}
            {a.billSchemePaise > 0 ? <Row good label={t('offers.orderOfferTotal')} value={`−${formatAmount(a.billSchemePaise)}`} /> : null}
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
        <OfferSheet
          scheme={sheetScheme}
          offer={sheetId ? offers.find((o) => o.schemeId === sheetId) : undefined}
          unit={form.unitName}
          syncedOn={schemesSynced[0]?.value ?? null}
          companyName={company[0]?.name}
          onClose={() => setSheetId(null)}
        />
        <View style={[st.footer, { paddingBottom: insets.bottom + spacing.lg }]}>
          {existing ? (
            <Pressable accessibilityRole="button" onPress={remove} style={({ pressed }) => [st.btn, st.btnRemove, pressed && { opacity: 0.85 }]}>
              <Text style={[st.btnText, { color: colors.danger }]}>{t('so.remove')}</Text>
            </Pressable>
          ) : null}
          <Pressable accessibilityRole="button" onPress={save} style={({ pressed }) => [st.btn, st.btnPrimary, pressed && { opacity: 0.85 }]}>
            <Text style={[st.btnText, { color: colors.onPrimary }]}>{t('so.saveLine')}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

/** A totals row; `good` = money an offer took off (green). */
function Row({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <View style={st.row}>
      <Text style={[st.rowLabel, good && st.good]}>{label}</Text>
      <Text style={[st.rowValue, good && st.good]}>{value}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  empty: { textAlign: 'center', fontSize: font.md, color: colors.textMuted, padding: spacing.xxl },
  form: { padding: spacing.lg, paddingTop: spacing.md + 2, gap: spacing.md },
  label: { fontSize: font.sm, fontWeight: '500', color: colors.textLabel },
  // Bordered segments, the chosen one filled maroon (unit, price level, discount kind).
  segment: { flexDirection: 'row', borderWidth: 1.5, borderColor: colors.inputBorder, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.surface },
  seg: { flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4, borderLeftWidth: 1, borderLeftColor: colors.inputBorder },
  segFirst: { borderLeftWidth: 0 },
  segOn: { backgroundColor: colors.primary },
  segText: { fontSize: 14, fontWeight: '600', color: colors.textLabel },
  segTextOn: { color: colors.onPrimary, fontWeight: '600' },
  level: { minHeight: 48 },
  levelText: { fontSize: 12.5, color: colors.textLabel },
  levelPrice: { fontSize: 12.5, fontWeight: '600', color: colors.textLabel },
  grid: { flexDirection: 'row', gap: spacing.md },
  cell: { flex: 1 },
  hint: { fontSize: 12, color: colors.textMuted },
  discRow: { flexDirection: 'row', gap: spacing.sm },
  discInput: {
    width: 88,
    height: 44,
    borderWidth: 1.5,
    borderColor: colors.inputBorder,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.surface,
    textAlign: 'right',
  },
  error: { fontSize: font.sm, color: colors.danger },
  offerCard: { backgroundColor: colors.surface, borderWidth: 1.5, borderColor: offerColors.cardBorder, borderRadius: radius.lg, paddingVertical: 11, paddingHorizontal: 13 },
  offerNext: { marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 44, marginTop: 9, paddingTop: 9, borderTopWidth: 1, borderTopColor: colors.border },
  switchLabel: { fontSize: 13.5, fontWeight: '600', color: colors.textLabel },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, paddingVertical: 11, paddingHorizontal: spacing.md + 2, gap: 6 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  rowLabel: { flex: 1, fontSize: 13.5, color: colors.textLabel },
  rowValue: { fontSize: 13.5, fontWeight: '600', color: colors.text },
  good: { color: offerColors.okText },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm, marginTop: 2 },
  totalLabel: { fontSize: 16, fontWeight: '700', color: colors.text },
  totalValue: { fontSize: font.xl, fontWeight: '700', color: colors.text },
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
  footer: { flexDirection: 'row', gap: spacing.md, paddingTop: spacing.md, paddingHorizontal: spacing.lg, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
  btn: { flex: 1, minHeight: 52, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  btnRemove: { flex: 0, width: 120, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.danger },
  btnPrimary: { backgroundColor: colors.primary },
  btnText: { fontSize: 16, fontWeight: '700' },
});
