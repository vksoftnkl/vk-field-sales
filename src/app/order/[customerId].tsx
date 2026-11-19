import Ionicons from '@expo/vector-icons/Ionicons';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { router, useLocalSearchParams, usePreventRemove } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LoadMoreFooter, useLoadMore } from '@/components/load-more';
import { ScreenHeader } from '@/components/screen-header';
import { useDateNames } from '@/components/use-date-names';
import { metaQuery } from '@/db/meta';
import { currentContext } from '@/features/company/company';
import { itemFilterKey } from '@/features/orders/item-filter-sql';
import { ItemFilterSheet, type ItemFilter } from '@/features/orders/item-filter-sheet';
import { contextChosen, orderCleared, orderRepeated, qtyTyped, type SoLine } from '@/features/orders/order-draft';
import { groupUnits, itemName, type ItemUnits } from '@/features/orders/order-items';
import { decimalInput, num, qtyText, startingPrice, toPaise } from '@/features/orders/order-math';
import { asOfText, isRecentOpen, soState } from '@/features/orders/order-status';
import {
  companyQuery,
  customerName,
  itemBrandsQuery,
  itemGroupsQuery,
  orderCustomerQuery,
  orderRef,
  shopOrderLinesQuery,
  soItemCountQuery,
  soItemsUpToQuery,
  soSeedLine,
  soUnitsOfItemsQuery,
  type OrderCustomer,
  type SoUnitRow,
} from '@/features/orders/queries';
import { backOrderQty, soLineAmounts, soTotals } from '@/features/orders/so-math';
import { useRefreshItems } from '@/features/orders/use-send-now';
import { formatAmount, todayISO } from '@/lib/money';
import { useAppDispatch, useAppSelector } from '@/store';
import { colors, font, radius, spacing } from '@/theme';

const GST = (perc: string | null) => String(Number(num(perc).toFixed(3)));

/**
 * Add items (canvas 3b, step 3; was Order entry): one row per item in its default unit, with the
 * rate, GST and MRP, the stock as of the last Sync and the shop's open orders. Type a quantity on
 * the row, or tap it for the unit, price level, rate and discount. Low stock warns (a back-order),
 * never blocks; an item with no price today can't be ordered. Review order opens the review.
 */
export default function AddItemsScreen() {
  const { customerId, companyId } = useLocalSearchParams<{ customerId: string; companyId: string }>();
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const names = useDateNames();
  const dispatch = useAppDispatch();
  const today = todayISO();

  const { data: found } = useLiveQuery(orderCustomerQuery(customerId), [customerId]);
  const { data: company } = useLiveQuery(companyQuery(companyId), [companyId]);
  const { data: groups } = useLiveQuery(itemGroupsQuery());
  const { data: brands } = useLiveQuery(itemBrandsQuery());
  const { data: synced } = useLiveQuery(metaQuery('itemsSyncedAt'));
  const { data: shopLines } = useLiveQuery(shopOrderLinesQuery(customerId, companyId, today), [customerId, companyId, today]);
  const c = found[0];
  const draft = useAppSelector((st) => st.orderDraft);
  const lines = draft.lines;

  // Opened without a draft for this shop (only by a link): start an empty one, in Switch company's
  // branch when it is this company (else none, and Save asks for one). Another company's lines
  // can't stay (their prices are that company's).
  useEffect(() => {
    if (draft.customerId === customerId && draft.companyId === companyId) return;
    const ctx = currentContext();
    const branchId = ctx?.companyId === companyId ? ctx.branchId : null;
    if (draft.customerId !== customerId) dispatch(orderRepeated({ customerId, companyId, branchId, lines: [] }));
    else dispatch(contextChosen({ companyId, branchId }));
  }, [dispatch, draft.customerId, draft.companyId, customerId, companyId]);

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<ItemFilter>({ groupIds: [], brandIds: [] });
  const [filterOpen, setFilterOpen] = useState(false);
  const { refreshing, result, refresh, clear } = useRefreshItems();

  // A repeat starts here, so leaving it with items asks first (a new order asks on Visit).
  const hasItems = draft.entry === 'repeat' && lines.some((l) => num(l.qty) > 0);
  usePreventRemove(hasItems, ({ repeat }) => {
    Alert.alert(t('order.discardTitle'), t('order.discardText', { name: c ? customerName(c) : '' }), [
      { text: t('order.keep'), style: 'cancel' },
      {
        text: t('order.discard'),
        style: 'destructive',
        onPress: () => {
          dispatch(orderCleared());
          repeat();
        },
      },
    ]);
  });

  // 50 items at first and 50 more as the list is scrolled to its end, searched and filtered in
  // the database; another search, filter or company starts again from the first 50.
  const listFilter = useMemo(() => ({ search, groupIds: filter.groupIds, brandIds: filter.brandIds }), [search, filter]);
  const listKey = `${companyId}|${itemFilterKey(listFilter)}`;
  const { limit, more } = useLoadMore(listKey);
  const { data: counted, updatedAt } = useLiveQuery(soItemCountQuery(companyId, listFilter), [listKey]);
  const total = counted[0]?.n ?? 0;
  const { data: loadedItems } = useLiveQuery(soItemsUpToQuery(companyId, listFilter, limit), [listKey, limit]);
  const itemIds = loadedItems.map((r) => r.itemId);
  const { data: rows } = useLiveQuery(soUnitsOfItemsQuery(companyId, itemIds), [companyId, itemIds.join(',')]);
  const shown = useMemo(() => groupUnits(rows), [rows]);
  const searching = search.trim() !== '' || filter.groupIds.length + filter.brandIds.length > 0;
  const byItem = useMemo(() => new Map(lines.map((l) => [l.itemId, l])), [lines]);

  // "Already on sor00042: 4 Bag": the first open order of this shop holding the item.
  const onOrder = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of shopLines) {
      if (r.soId === draft.editingSoId || m.has(r.itemId)) continue;
      if (!isRecentOpen({ state: soState(r), soOrderDate: r.soOrderDate }, today)) continue;
      m.set(r.itemId, t('so.alreadyOn', { ref: orderRef(r), qty: qtyText(num(r.qty)), unit: r.unitName ?? '' }).trim());
    }
    return m;
  }, [shopLines, draft.editingSoId, today, t]);

  const totals = soTotals(lines);
  const filtered = filter.groupIds.length + filter.brandIds.length > 0;

  const onQty = useCallback(
    (it: ItemUnits<SoUnitRow>, line: SoLine | undefined, qty: string) => {
      if (!c) return;
      const typed = decimalInput(qty, 3);
      if (line) return dispatch(qtyTyped({ seed: line, qty: typed }));
      const start = startingPrice(it.rowUnit, c.cusPriceLevelId);
      if (start) dispatch(qtyTyped({ seed: soSeedLine(it.rowUnit, c, start), qty: typed }));
    },
    [dispatch, c],
  );
  const onOpen = useCallback((it: ItemUnits<SoUnitRow>) => router.push({ pathname: '/order/item', params: { itemId: it.itemId } }), []);

  const subtitle = [c ? customerName(c) : '', company[0]?.name ?? ''].filter(Boolean).join(' · ');
  const syncedOn = synced[0]?.value;

  return (
    <View style={st.root}>
      <ScreenHeader
        title={t('so.addItems')}
        subtitle={subtitle}
        backLabel={t('so.backToVisit')}
        right={
          <Pressable accessibilityRole="button" accessibilityLabel={t('so.refresh')} accessibilityState={{ busy: refreshing }} disabled={refreshing} onPress={() => void refresh()} style={st.headBtn}>
            {refreshing ? <ActivityIndicator color={colors.onPrimary} /> : <Ionicons name="sync-outline" size={22} color={colors.onPrimary} />}
          </Pressable>
        }
      />

      <View style={st.searchRow}>
        <View style={st.search}>
          <Ionicons name="search" size={20} color={colors.textMuted} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder={t('order.search')}
            placeholderTextColor={colors.textMuted}
            accessibilityLabel={t('order.search')}
            style={st.searchInput}
            autoCorrect={false}
            returnKeyType="search"
          />
          {search ? (
            <Pressable accessibilityRole="button" accessibilityLabel={t('common.clear')} hitSlop={8} onPress={() => setSearch('')}>
              <Ionicons name="close-circle" size={20} color={colors.textMuted} />
            </Pressable>
          ) : null}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('order.filter')}
          accessibilityState={{ selected: filtered }}
          onPress={() => setFilterOpen(true)}
          style={[st.filterBtn, filtered && st.filterOn]}
        >
          <Ionicons name="options-outline" size={22} color={colors.primary} />
        </Pressable>
      </View>
      <View style={st.asOfRow}>
        <Text style={st.asOf}>{syncedOn ? t('so.stockAsOf', { when: asOfText(syncedOn, names, t('so.today')) }) : t('so.notSyncedItems')}</Text>
        <Text style={st.asOf}>{t('so.allGodowns')}</Text>
      </View>
      {result ? (
        <Pressable accessibilityRole="button" accessibilityHint={t('common.close')} onPress={clear} style={[st.result, !result.ok && st.resultBad]}>
          <Text style={[st.resultText, !result.ok && { color: colors.danger }]}>{result.text}</Text>
          <Ionicons name="close" size={16} color={result.ok ? colors.textMuted : colors.danger} />
        </Pressable>
      ) : null}

      <FlatList
        data={shown}
        keyExtractor={(it) => it.itemId}
        contentContainerStyle={st.list}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={12}
        windowSize={7}
        onEndReached={() => more(loadedItems.length, total)}
        onEndReachedThreshold={0.5}
        ListFooterComponent={<LoadMoreFooter shown={loadedItems.length} total={total} />}
        ListEmptyComponent={updatedAt ? <Text style={st.empty}>{searching ? t('order.noMatch') : t('order.noItems')}</Text> : undefined}
        renderItem={({ item }) => (
          <ItemRow it={item} line={byItem.get(item.itemId)} customer={c} note={onOrder.get(item.itemId)} language={i18n.language} onQty={onQty} onOpen={onOpen} />
        )}
      />

      <View style={[st.footer, { paddingBottom: insets.bottom + spacing.lg }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: totals.items === 0 }}
          disabled={totals.items === 0}
          onPress={() => router.push('/order/summary')}
          style={({ pressed }) => [st.proceed, totals.items === 0 && { opacity: 0.5 }, pressed && { opacity: 0.85 }]}
        >
          <View style={{ gap: 1 }}>
            <Text style={st.proceedNote}>{t('so.itemsQty', { count: totals.items, qty: qtyText(totals.qty) })}</Text>
            <Text style={st.proceedTotal}>{formatAmount(totals.totalPaise)}</Text>
          </View>
          <View style={st.proceedRight}>
            <Text style={st.proceedText}>{t('so.reviewOrder')}</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.onPrimary} />
          </View>
        </Pressable>
      </View>

      <ItemFilterSheet visible={filterOpen} value={filter} groups={groups} brands={brands} onApply={setFilter} onClose={() => setFilterOpen(false)} />
    </View>
  );
}

const ItemRow = memo(function ItemRow({
  it,
  line,
  customer,
  note,
  language,
  onQty,
  onOpen,
}: {
  it: ItemUnits<SoUnitRow>;
  line: SoLine | undefined;
  customer: OrderCustomer | undefined;
  note: string | undefined;
  language: string;
  onQty: (it: ItemUnits<SoUnitRow>, line: SoLine | undefined, qty: string) => void;
  onOpen: (it: ItemUnits<SoUnitRow>) => void;
}) {
  const { t } = useTranslation();
  // The line's unit when it is on the order (Order item may have switched it), else the row's.
  const u = (line && it.units.find((x) => x.iucId === line.iucId)) ?? it.rowUnit;
  const name = itemName(u, language);
  const off = !it.priced;
  const qty = num(line?.qty);
  const on = qty > 0;
  const start = customer && !off ? startingPrice(u, customer.cusPriceLevelId) : null;
  const price = toPaise(line?.price ?? start?.price) ?? 0;
  const mrp = toPaise(u.ipmMaxPrice);
  const stock = Number(u.stockQty) || 0;
  const back = backOrderQty(qty, stock);
  const discPaise = line ? soLineAmounts(line).discPaise : 0;

  let meta: string;
  let warn = false;
  if (off) {
    meta = t('so.askOffice');
    warn = true;
  } else if (back > 0) {
    meta = t('so.backOrder', { stock: qtyText(stock), qty: qtyText(back), unit: u.unitName });
    warn = true;
  } else if (stock <= 0) {
    meta = t('so.stockZero', { stock: qtyText(stock) });
    warn = true;
  } else {
    meta = [t('order.stock', { qty: qtyText(stock) }), discPaise > 0 ? t('so.discApplied', { amount: formatAmount(discPaise) }) : null].filter(Boolean).join(' · ');
  }

  return (
    <View style={[st.row, on && st.rowOn]}>
      <Pressable accessibilityRole="button" accessibilityHint={t('order.itemTitle')} disabled={off} onPress={() => onOpen(it)} style={st.rowMain}>
        <Text style={st.rowName}>{name}</Text>
        <View style={st.rateLine}>
          <Text style={st.rate}>{off ? t('so.noPriceToday') : t('so.rateLine', { price: formatAmount(price), unit: u.unitName, gst: GST(u.taxPerc) })}</Text>
          <View style={st.mrp}>
            <Text style={st.mrpText}>{mrp ? t('order.mrp', { price: formatAmount(mrp) }) : t('so.noMrp')}</Text>
          </View>
        </View>
        <Text style={[st.meta, warn && { color: '#92400E' }]}>{meta}</Text>
        {note ? (
          <View style={st.note}>
            <Text style={st.noteText}>{note}</Text>
          </View>
        ) : null}
      </Pressable>
      <View style={st.qtyBox}>
        <TextInput
          value={line?.qty ?? ''}
          onChangeText={(v) => onQty(it, line, v)}
          placeholder={off ? '—' : '0'}
          placeholderTextColor={colors.textMuted}
          keyboardType="decimal-pad"
          editable={!off}
          accessibilityLabel={t('so.qtyIn', { unit: u.unitName, name })}
          selectTextOnFocus
          maxLength={9}
          style={[st.qty, off && st.qtyOff]}
        />
        <Text style={st.unit} numberOfLines={1}>
          {u.unitName}
        </Text>
      </View>
    </View>
  );
});

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  headBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  searchRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.md + 2, paddingBottom: spacing.sm },
  search: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 48,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md + 2,
    paddingHorizontal: spacing.md + 2,
  },
  searchInput: { flex: 1, fontSize: font.md, color: colors.text, padding: 0 },
  filterBtn: {
    width: 48,
    height: 48,
    borderRadius: radius.md + 2,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterOn: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  asOfRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: 6 },
  asOf: { fontSize: 12, color: colors.textMuted },
  result: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.xs,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  resultBad: { backgroundColor: '#FEE2E2', borderColor: '#FCA5A5' },
  resultText: { flex: 1, fontSize: font.sm, color: colors.textLabel },
  list: { paddingHorizontal: spacing.lg, paddingTop: spacing.xs, paddingBottom: spacing.md, gap: spacing.sm },
  empty: { textAlign: 'center', fontSize: font.md, color: colors.textMuted, padding: spacing.xl },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md + 2,
    paddingVertical: 10,
    paddingLeft: spacing.md + 2,
    paddingRight: 10,
  },
  rowOn: { backgroundColor: '#F0FDF4', borderColor: '#86EFAC' },
  rowMain: { flex: 1, gap: 3, minWidth: 0 },
  rowName: { fontSize: font.md, fontWeight: '600', color: colors.text },
  rateLine: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  rate: { fontSize: font.sm, color: colors.textLabel },
  mrp: { backgroundColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 1 },
  mrpText: { fontSize: 11.5, fontWeight: '600', color: colors.textLabel },
  meta: { fontSize: 12, color: colors.textMuted },
  note: { alignSelf: 'flex-start', backgroundColor: '#FEF3C7', borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 1 },
  noteText: { fontSize: 12, fontWeight: '600', color: '#92400E' },
  qtyBox: { alignItems: 'center', gap: 2, width: 64 },
  qty: {
    width: 64,
    height: 48,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: radius.md,
    textAlign: 'center',
    fontSize: font.lg,
    fontWeight: '600',
    color: colors.text,
    backgroundColor: colors.surface,
    padding: 0,
  },
  qtyOff: { backgroundColor: '#EEECE9' },
  unit: { fontSize: 11.5, color: colors.textMuted },
  footer: { paddingTop: spacing.sm, paddingHorizontal: spacing.lg, backgroundColor: colors.bg },
  proceed: {
    minHeight: 56,
    borderRadius: radius.lg,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: spacing.sm,
  },
  proceedNote: { fontSize: font.sm, color: colors.onPrimaryMuted },
  proceedTotal: { fontSize: 16, fontWeight: '700', color: colors.onPrimary },
  proceedRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  proceedText: { fontSize: font.md, fontWeight: '600', color: colors.onPrimary },
});
