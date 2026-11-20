import Ionicons from '@expo/vector-icons/Ionicons';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LoadMoreFooter, useLoadMore } from '@/components/load-more';
import { ScreenHeader } from '@/components/screen-header';
import { itemFilterKey, type ItemListFilter } from '@/features/orders/item-filter-sql';
import { groupUnits, itemName } from '@/features/orders/order-items';
import { decimalInput, num, qtyText } from '@/features/orders/order-math';
import { customerName, soItemCountQuery, soItemsUpToQuery, soUnitsOfItemsQuery } from '@/features/orders/queries';
import { returnAllBack, returnBillPicked, returnLineSaved } from '@/features/returns/return-draft';
import { partAmounts, returnEstimate, type ReturnPart } from '@/features/returns/return-math';
import { noBillRate, partFromBillLine, partFromUnit, reasonCondition, useReturnSetup } from '@/features/returns/return-parts';
import { barStyles, returnStyles } from '@/features/returns/return-styles';
import { returnCustomerQuery, shopItemSalesQuery } from '@/features/returns/queries';
import { formatDay } from '@/lib/date-range';
import { formatAmount } from '@/lib/money';
import { useAppDispatch, useAppSelector } from '@/store';
import { colors, font, radius, spacing } from '@/theme';
import { useDateNames } from '@/components/use-date-names';

/**
 * No bill, step 2b (canvas 6b; replaces the old Product list): goods that came back on none of the
 * shop's synced bills. Search in English or Tamil; each item shows where VK Nex will take its rate
 * from — the shop's last sale inside the return window, else today's price at its level — and is
 * never typed. An item found on a synced bill offers that bill instead (the desktop's Alt+B). VK
 * Nex asks the office to approve a return with no bill.
 */
export default function ReturnNoBillScreen() {
  const { from } = useLocalSearchParams<{ from?: string }>();
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const names = useDateNames();
  const dispatch = useAppDispatch();
  const d = useAppSelector((st) => st.returnDraft);
  const companyId = d.companyId ?? '';
  const custId = d.customerId ?? '';
  const [search, setSearch] = useState('');
  const filter: ItemListFilter = useMemo(() => ({ search, groupIds: [], brandIds: [] }), [search]);
  const fKey = itemFilterKey(filter);
  const { limit, more } = useLoadMore(fKey);

  const { settings, reasons } = useReturnSetup(companyId);
  const condition = reasonCondition(reasons.find((r) => r.reasonId === d.reasonId));
  const { data: shop } = useLiveQuery(returnCustomerQuery(custId), [custId]);
  const { data: count } = useLiveQuery(soItemCountQuery(companyId, filter), [companyId, fKey]);
  const { data: itemRows } = useLiveQuery(soItemsUpToQuery(companyId, filter, limit), [companyId, fKey, limit]);
  const ids = itemRows.map((r) => r.itemId);
  const idKey = ids.join(',');
  const { data: unitRows } = useLiveQuery(soUnitsOfItemsQuery(companyId, ids), [companyId, idKey]);
  const { data: sales } = useLiveQuery(shopItemSalesQuery(custId, companyId, ids), [custId, companyId, idKey]);
  const items = useMemo(() => groupUnits(unitRows), [unitRows]);
  const total = count[0]?.n ?? 0;
  const level = shop[0]?.cusPriceLevelId ?? null;
  const windowDays = settings?.returnWindowDays ?? 0;

  const noBillParts = d.parts.filter((p) => !p.billItemId);
  const est = returnEstimate(noBillParts);
  const salesOf = (itemId: string) => sales.filter((s) => s.line.itemId === itemId);
  // The first listed item still on one of the shop's synced bills (the desktop's Alt+B offer).
  const onBill = search.trim()
    ? items
        .map((it) => ({ it, sale: salesOf(it.itemId).find((s) => num(s.line.qtyLeftBase) > 0 && s.line.allowReturn) }))
        .find((x) => !!x.sale)
    : undefined;

  const partOf = (itemId: string) => noBillParts.find((p) => p.itemId === itemId);
  const setQty = (it: (typeof items)[number], qty: string) => {
    const was = partOf(it.itemId);
    if (was) {
      dispatch(returnLineSaved({ lineKey: was.key, parts: num(qty) > 0 ? [{ ...was, qty }] : [] }));
      return;
    }
    const rate = noBillRate(it.rowUnit, salesOf(it.itemId), { level, windowDays });
    if (!rate) return Alert.alert(t('sr.noBill.noPriceTitle'), t('sr.noBill.noPrice'));
    const p: ReturnPart = partFromUnit(it.rowUnit, rate, condition, qty);
    dispatch(returnLineSaved({ lineKey: p.key, parts: [p] }));
  };

  const useBill = () => {
    if (!onBill?.sale) return;
    const s = onBill.sale;
    const billLines = sales.filter((x) => x.line.sbId === s.line.sbId && x.line.sbAccYear === s.line.sbAccYear);
    const carry = noBillParts.map((p) => ({ p, line: billLines.find((l) => l.line.itemId === p.itemId && num(l.line.qtyLeftBase) > 0) }));
    const missing = carry.filter((c) => !c.line).map((c) => c.p.name);
    if (missing.length) return Alert.alert(t('sr.noBill.notOnThatBillTitle'), t('sr.noBill.notOnThatBill', { items: missing.join(', '), bill: s.refno }));
    dispatch(returnBillPicked({ sbId: s.line.sbId, accYear: s.line.sbAccYear, refno: s.refno, date: s.billDate }));
    const carried = carry.map(({ p, line }) => ({ ...partFromBillLine({ line: line!.line, nameEn: p.name, nameTa: p.nameTa }, p.condition, { qty: p.qty, notes: p.notes }), iucId: p.iucId, unitName: p.unitName, factor: p.factor }));
    if (!carried.some((c) => c.itemId === onBill.it.itemId)) carried.push(partFromBillLine({ line: s.line, nameEn: onBill.it.rowUnit.itemNameEn, nameTa: onBill.it.rowUnit.itemNameTa }, condition));
    dispatch(returnAllBack(carried));
    router.dismissTo('/sales-return/items');
  };
  const next = () => {
    if (!noBillParts.length) return Alert.alert(t('sr.items.nothingTitle'), t('sr.noBill.pickOne'));
    if (from === 'items') router.back();
    else router.push('/sales-return/items');
  };

  return (
    <View style={st.root}>
      <ScreenHeader title={t('sr.noBill.title')} subtitle={shop[0] ? customerName(shop[0]) : undefined} backLabel={t('sr.back')} />
      <FlatList
        data={items}
        keyExtractor={(it) => it.itemId}
        contentContainerStyle={st.body}
        keyboardShouldPersistTaps="handled"
        onEndReached={() => more(itemRows.length, total)}
        onEndReachedThreshold={0.5}
        ListHeaderComponent={
          <View style={{ gap: 10 }}>
            <View style={st.warn}>
              <Ionicons name="information-circle-outline" size={18} color="#78350F" />
              <Text style={st.warnText}>{t('sr.noBill.approval')}</Text>
            </View>
            <View style={st.search}>
              <Ionicons name="search" size={18} color={colors.textMuted} />
              <TextInput value={search} onChangeText={setSearch} placeholder={t('sr.noBill.search')} placeholderTextColor={colors.textMuted} accessibilityLabel={t('sr.noBill.search')} style={st.searchInput} />
            </View>
            {onBill?.sale ? (
              <View style={st.onBill}>
                <Text style={st.onBillTitle}>{t('sr.noBill.onBill', { item: itemName({ itemNameEn: onBill.it.rowUnit.itemNameEn, itemNameTa: onBill.it.rowUnit.itemNameTa }, i18n.language), bill: onBill.sale.refno })}</Text>
                <Text style={st.small}>
                  {t('sr.noBill.onBillLeft', {
                    date: formatDay(onBill.sale.billDate, names).replace(/ \d{4}$/, ''),
                    qty: qtyText(num(onBill.sale.line.qtyLeftBase) / (num(onBill.sale.line.toBaseFactor) || 1)),
                    unit: onBill.sale.line.unitName ?? '',
                  })}
                </Text>
                <Pressable accessibilityRole="button" onPress={useBill} style={st.onBillBtn}>
                  <Text style={st.onBillBtnText}>{t('sr.noBill.useBill')}</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        }
        ListFooterComponent={
          <View style={{ gap: spacing.sm }}>
            <LoadMoreFooter shown={items.length} total={total} />
            <Text style={st.hint}>{t('sr.noBill.rateNote')}</Text>
          </View>
        }
        renderItem={({ item: it }) => {
          const u = it.rowUnit;
          const p = partOf(it.itemId);
          const rate = p ? null : noBillRate(u, salesOf(it.itemId), { level, windowDays });
          const source = p?.rateSource ?? rate?.source;
          const fromBill = p?.rateFrom ?? rate?.from?.refno ?? '';
          const perUnit = p ? partAmounts({ ...p, qty: '1' }).netPaise : rate ? partAmounts({ qty: '1', factor: String(u.factor), ratePreTaxBase: rate.ratePreTaxBase, taxPerc: rate.taxPerc, igst: rate.igst }).netPaise : 0;
          return (
            <View style={st.row}>
              <Pressable
                accessibilityRole={p ? 'button' : undefined}
                disabled={!p}
                onPress={() => p && router.push({ pathname: '/sales-return/line', params: { lineKey: p.key } })}
                style={{ gap: 5 }}
              >
                <View style={st.between}>
                  <Text style={[st.itemName, { flex: 1 }]} numberOfLines={2}>
                    {itemName({ itemNameEn: u.itemNameEn, itemNameTa: u.itemNameTa }, i18n.language)}
                  </Text>
                  <Text style={st.small}>{(p?.unitName ?? u.unitName).toLocaleUpperCase()}</Text>
                </View>
                {source ? (
                  <Text style={[st.chip, source === 'LAST_SALE' ? st.chipOk : st.chipWarn, { alignSelf: 'flex-start' }]}>
                    {source === 'LAST_SALE' ? t('sr.noBill.lastSale', { bill: fromBill, amount: formatAmount(perUnit) }) : t('sr.noBill.today', { amount: formatAmount(perUnit) })}
                  </Text>
                ) : (
                  <Text style={[st.chip, st.chipGrey, { alignSelf: 'flex-start' }]}>{t('sr.noBill.noPriceShort')}</Text>
                )}
              </Pressable>
              <View style={st.between}>
                <Text style={st.small}>{p ? t(`sr.condition.${p.condition}`) : t('sr.noBill.tapToAdd')}</Text>
                <View style={st.stepper}>
                  <Pressable accessibilityRole="button" accessibilityLabel={t('sr.noBill.less')} disabled={!p} onPress={() => p && setQty(it, qtyText(Math.max(0, num(p.qty) - 1)))} style={[st.step, !p && { opacity: 0.4 }]}>
                    <Text style={st.stepText}>−</Text>
                  </Pressable>
                  <TextInput
                    value={p?.qty ?? ''}
                    onChangeText={(v) => setQty(it, decimalInput(v, 3))}
                    keyboardType="decimal-pad"
                    accessibilityLabel={t('sr.noBill.qtyOf', { name: u.itemNameEn })}
                    style={st.qty}
                  />
                  <Pressable accessibilityRole="button" accessibilityLabel={t('sr.noBill.more')} onPress={() => setQty(it, qtyText(num(p?.qty) + 1))} style={st.step}>
                    <Text style={st.stepText}>+</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          );
        }}
      />
      <View style={[barStyles.bar, { paddingBottom: insets.bottom + spacing.lg }]}>
        <View style={{ flex: 1, gap: 1 }}>
          <Text style={barStyles.barSmall}>{t('sr.noBill.bar', { items: est.lines, qty: qtyText(est.qty) })}</Text>
          <Text style={barStyles.barTotal}>{formatAmount(est.exactPaise)}</Text>
        </View>
        <Pressable accessibilityRole="button" onPress={next} style={({ pressed }) => [barStyles.barBtn, pressed && { opacity: 0.85 }]}>
          <Text style={barStyles.barBtnText}>{from === 'items' ? t('sr.noBill.done') : t('sr.noBill.next')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  ...returnStyles,
  search: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, height: 46, borderWidth: 2, borderColor: colors.primary, borderRadius: radius.md + 2, paddingHorizontal: spacing.md, backgroundColor: colors.surface },
  searchInput: { flex: 1, fontSize: font.md, color: colors.text, paddingVertical: 0 },
  onBill: { gap: 8, backgroundColor: '#F0FDF4', borderWidth: 1, borderColor: '#86EFAC', borderRadius: radius.md + 2, padding: spacing.md + 2 },
  onBillTitle: { fontSize: 14, fontWeight: '600', color: colors.text },
  onBillBtn: { alignSelf: 'flex-start', minHeight: 40, paddingHorizontal: 14, borderRadius: radius.md, backgroundColor: '#166534', justifyContent: 'center' },
  onBillBtnText: { fontSize: 14, fontWeight: '600', color: colors.onPrimary },
  row: { gap: 8, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md + 2, paddingVertical: 10, paddingHorizontal: spacing.md + 2 },
  itemName: { fontSize: font.md, fontWeight: '600', color: colors.text },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  step: { width: 40, height: 40, borderWidth: 1, borderColor: colors.inputBorder, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  stepText: { fontSize: 18, color: colors.text },
  qty: { width: 56, height: 40, borderWidth: 1, borderColor: colors.inputBorder, borderRadius: radius.md, textAlign: 'center', fontSize: 16, fontWeight: '600', color: colors.text, paddingVertical: 0 },
});
