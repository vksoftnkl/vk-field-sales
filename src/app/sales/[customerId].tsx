import Ionicons from '@expo/vector-icons/Ionicons';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { router, useLocalSearchParams, usePreventRemove } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/screen-header';
import { useDateNames } from '@/components/use-date-names';
import { metaQuery } from '@/db/meta';
import { ItemFilterSheet, type ItemFilter } from '@/features/orders/item-filter-sheet';
import { filterOrderItems, itemName } from '@/features/orders/order-items';
import { decimalInput, num, orderTotals, qtyText, startingPrice, toPaise } from '@/features/orders/order-math';
import { companyQuery, customerName, itemBrandsQuery, itemGroupsQuery } from '@/features/orders/queries';
import { saleCleared, saleQtyTyped, saleStarted, type SaleLine } from '@/features/sales/sale-draft';
import { overStock, stockLeft } from '@/features/sales/sale-math';
import { billedOnPhoneQuery, saleCustomerQuery, saleItemsQuery, seedSaleLine, type SaleItemRow } from '@/features/sales/queries';
import { formatDay } from '@/lib/date-range';
import { formatAmount } from '@/lib/money';
import { useAppDispatch, useAppSelector } from '@/store';
import { colors, font, radius, spacing } from '@/theme';

interface ListRow {
  row: SaleItemRow;
  /** The price a new line starts at (the customer's level). */
  start: { level: number; price: string };
  /** Free to sell in this unit: the last Sync's stock less this phone's bills. */
  left: number;
  /** Base quantity of the item already on this phone's bills. */
  billedBase: number;
}

/**
 * Select items (the Qt app's SalesEntry.qml), opened by Sales on Customer detail, for the company
 * picked on the phone: every unit the company sells, with the customer's price, MRP and the stock
 * left. Type a quantity on a row, or tap it for price, discount and promotion. Out-of-stock rows
 * can't be billed; asking for more than is left marks the row. Proceed opens the Bill.
 */
export default function SelectItemsScreen() {
  const { customerId, companyId } = useLocalSearchParams<{ customerId: string; companyId: string }>();
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const names = useDateNames();
  const dispatch = useAppDispatch();

  const { data: found } = useLiveQuery(saleCustomerQuery(customerId), [customerId]);
  const { data: company } = useLiveQuery(companyQuery(companyId), [companyId]);
  const { data: rows, updatedAt } = useLiveQuery(saleItemsQuery(companyId), [companyId]);
  const { data: billed } = useLiveQuery(billedOnPhoneQuery(companyId), [companyId]);
  const { data: groups } = useLiveQuery(itemGroupsQuery());
  const { data: brands } = useLiveQuery(itemBrandsQuery());
  const { data: synced } = useLiveQuery(metaQuery('itemsSyncedAt'));
  const c = found[0];
  const lines = useAppSelector((st) => st.saleDraft.lines);

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<ItemFilter>({ groupIds: [], brandIds: [] });
  const [filterOpen, setFilterOpen] = useState(false);

  useEffect(() => {
    dispatch(saleStarted({ customerId, companyId }));
  }, [dispatch, customerId, companyId]);

  // Leaving with items entered asks first. Save bill clears the bill before it closes this
  // screen, so it is not asked then.
  const draftCustomer = useAppSelector((st) => st.saleDraft.customerId);
  const hasItems = draftCustomer === customerId && lines.some((l) => num(l.qty) > 0);
  usePreventRemove(hasItems, ({ repeat }) => {
    Alert.alert(t('sale.discardTitle'), t('sale.discardText', { name: c ? customerName(c) : '' }), [
      { text: t('order.keep'), style: 'cancel' },
      {
        text: t('order.discard'),
        style: 'destructive',
        onPress: () => {
          dispatch(saleCleared());
          repeat();
        },
      },
    ]);
  });

  const billedBy = useMemo(() => new Map(billed.map((b) => [b.itemId, b.base])), [billed]);
  const priced = useMemo<ListRow[]>(
    () =>
      rows.flatMap((row) => {
        const start = startingPrice(row, c?.cusPriceLevelId ?? null);
        const billedBase = billedBy.get(row.itemId) ?? 0;
        return start ? [{ row, start, billedBase, left: stockLeft(row.stockQty, row.factor, billedBase) }] : [];
      }),
    [rows, c?.cusPriceLevelId, billedBy],
  );
  const shown = useMemo(() => {
    const keep = new Set(filterOrderItems(priced.map((p) => p.row), search, filter.groupIds, filter.brandIds).map((r) => r.iucId));
    return priced.filter((p) => keep.has(p.row.iucId));
  }, [priced, search, filter]);
  const byUnit = useMemo(() => new Map(lines.map((l) => [l.iucId, l])), [lines]);
  const short = useMemo(() => overStock(lines), [lines]);
  const totals = orderTotals(lines);
  const filtered = filter.groupIds.length + filter.brandIds.length > 0;

  const onQty = useCallback(
    (p: ListRow, qty: string) => dispatch(saleQtyTyped({ seed: seedSaleLine(p.row, p.start, p.billedBase), qty: decimalInput(qty, 3) })),
    [dispatch],
  );
  const onOpen = useCallback((p: ListRow) => router.push({ pathname: '/sales/item', params: { iucId: p.row.iucId } }), []);

  const subtitle = [c ? customerName(c) : '', company[0]?.name ?? ''].filter(Boolean).join(' · ');
  const syncedOn = synced[0]?.value;

  return (
    <View style={st.root}>
      <ScreenHeader title={t('sale.entryTitle')} subtitle={subtitle} backLabel={t('sale.back')} />

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
      {syncedOn ? <Text style={st.asOf}>{t('order.stockAsOf', { date: formatDay(syncedOn.slice(0, 10), names) })}</Text> : null}

      <FlatList
        data={shown}
        keyExtractor={(p) => p.row.iucId}
        contentContainerStyle={st.list}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={12}
        windowSize={7}
        ListEmptyComponent={updatedAt ? <Text style={st.empty}>{priced.length === 0 ? t('order.noItems') : t('order.noMatch')}</Text> : undefined}
        renderItem={({ item }) => (
          <ItemRow p={item} line={byUnit.get(item.row.iucId)} isShort={short.has(item.row.iucId)} language={i18n.language} onQty={onQty} onOpen={onOpen} />
        )}
      />

      <View style={[st.footer, { paddingBottom: insets.bottom + spacing.lg }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: totals.items === 0 }}
          disabled={totals.items === 0}
          onPress={() => router.push('/sales/bill')}
          style={({ pressed }) => [st.proceed, totals.items === 0 && { opacity: 0.5 }, pressed && { opacity: 0.85 }]}
        >
          <Text style={st.proceedNote}>{t('order.proceedSummary', { items: totals.items, qty: qtyText(totals.qty) })}</Text>
          <View style={st.proceedRight}>
            <Text style={st.proceedText}>{t('sale.proceed')}</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.onPrimary} />
          </View>
        </Pressable>
      </View>

      <ItemFilterSheet visible={filterOpen} value={filter} groups={groups} brands={brands} onApply={setFilter} onClose={() => setFilterOpen(false)} />
    </View>
  );
}

const ItemRow = memo(function ItemRow({
  p,
  line,
  isShort,
  language,
  onQty,
  onOpen,
}: {
  p: ListRow;
  line: SaleLine | undefined;
  isShort: boolean;
  language: string;
  onQty: (p: ListRow, qty: string) => void;
  onOpen: (p: ListRow) => void;
}) {
  const { t } = useTranslation();
  const r = p.row;
  const name = itemName(r, language);
  const on = num(line?.qty) > 0;
  // An item already on the bill stays editable even if its stock ran out meanwhile.
  const out = p.left <= 0 && !line;
  const price = toPaise(line?.price ?? p.start.price) ?? 0;
  const mrp = toPaise(r.ipmMaxPrice);
  const left = qtyText(Math.max(0, p.left));
  const meta = out ? t('sale.outOfStock') : isShort ? t('sale.shortStock', { qty: left }) : t('order.stock', { qty: left });

  return (
    <View style={[st.row, on && st.rowOn, isShort && st.rowShort]}>
      <Pressable
        accessibilityRole="button"
        accessibilityHint={t('sale.itemTitle')}
        accessibilityState={{ disabled: out }}
        disabled={out}
        onPress={() => onOpen(p)}
        style={st.rowMain}
      >
        <Text style={st.rowName}>{name}</Text>
        <View style={st.rateLine}>
          <Text style={st.rate}>{t('sale.lineMeta', { unit: r.unitName, price: formatAmount(price) })}</Text>
          {mrp ? (
            <View style={st.mrp}>
              <Text style={st.mrpText}>{t('order.mrp', { price: formatAmount(mrp) })}</Text>
            </View>
          ) : null}
        </View>
        <Text style={[st.meta, (out || isShort) && st.metaBad]}>{meta}</Text>
      </Pressable>
      <TextInput
        value={line?.qty ?? ''}
        onChangeText={(v) => onQty(p, v)}
        placeholder={out ? '—' : '0'}
        placeholderTextColor={colors.textMuted}
        keyboardType="decimal-pad"
        accessibilityLabel={t('order.qtyFor', { name })}
        accessibilityState={{ disabled: out }}
        editable={!out}
        selectTextOnFocus
        maxLength={9}
        style={[st.qty, out && st.qtyOff, isShort && { borderColor: colors.danger }]}
      />
    </View>
  );
});

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  searchRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.md + 2, paddingBottom: 6 },
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
  asOf: { paddingHorizontal: spacing.lg, fontSize: 12, color: colors.textMuted },
  list: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md, gap: spacing.sm },
  empty: { textAlign: 'center', fontSize: font.md, color: colors.textMuted, padding: spacing.xl },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md + 2,
    paddingVertical: spacing.md,
    paddingLeft: spacing.md + 2,
    paddingRight: spacing.md,
  },
  rowOn: { backgroundColor: '#F0FDF4', borderColor: '#86EFAC' },
  rowShort: { backgroundColor: '#FEF2F2', borderColor: '#FCA5A5' },
  rowMain: { flex: 1, gap: 4, minWidth: 0 },
  rowName: { fontSize: font.md, fontWeight: '600', color: colors.text },
  rateLine: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  rate: { fontSize: font.sm, color: colors.textLabel },
  mrp: { backgroundColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 1 },
  mrpText: { fontSize: 11.5, fontWeight: '600', color: colors.textLabel },
  meta: { fontSize: 12, color: colors.textMuted },
  metaBad: { color: colors.danger },
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
  footer: { paddingTop: spacing.sm, paddingHorizontal: spacing.lg, backgroundColor: colors.bg },
  proceed: {
    minHeight: 56,
    borderRadius: radius.lg,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
  },
  proceedNote: { fontSize: 14, color: colors.onPrimaryMuted },
  proceedRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  proceedText: { fontSize: font.md, fontWeight: '600', color: colors.onPrimary },
});
