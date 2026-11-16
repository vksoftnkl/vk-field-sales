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
import { orderCleared, orderStarted, qtyTyped, type DraftLine } from '@/features/orders/order-draft';
import { filterOrderItems, itemName } from '@/features/orders/order-items';
import { decimalInput, num, orderTotals, qtyText, startingPrice, toPaise } from '@/features/orders/order-math';
import {
  companyQuery,
  customerName,
  itemBrandsQuery,
  itemGroupsQuery,
  orderCustomerQuery,
  orderItemsQuery,
  seedLine,
  type OrderCustomer,
  type OrderItemRow,
} from '@/features/orders/queries';
import { formatDay } from '@/lib/date-range';
import { formatAmount } from '@/lib/money';
import { useAppDispatch, useAppSelector } from '@/store';
import { colors, font, radius, spacing } from '@/theme';

interface ListRow {
  row: OrderItemRow;
  /** The price a new line starts at (the customer's level). */
  start: { level: number; price: string };
}

/**
 * Order entry (the Qt app's OrderEntry.qml): every unit the company sells, with the customer's
 * price, MRP, cooly, freight and stock as of the last Sync. Type a quantity on a row, or tap it for
 * price, discount and promotion. Proceed opens the summary.
 */
export default function OrderEntryScreen() {
  const { customerId, companyId } = useLocalSearchParams<{ customerId: string; companyId: string }>();
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const names = useDateNames();
  const dispatch = useAppDispatch();

  const { data: found } = useLiveQuery(orderCustomerQuery(customerId), [customerId]);
  const { data: company } = useLiveQuery(companyQuery(companyId), [companyId]);
  const { data: rows, updatedAt } = useLiveQuery(orderItemsQuery(companyId), [companyId]);
  const { data: groups } = useLiveQuery(itemGroupsQuery());
  const { data: brands } = useLiveQuery(itemBrandsQuery());
  const { data: synced } = useLiveQuery(metaQuery('itemsSyncedAt'));
  const c = found[0];
  const lines = useAppSelector((st) => st.orderDraft.lines);

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<ItemFilter>({ groupIds: [], brandIds: [] });
  const [filterOpen, setFilterOpen] = useState(false);

  useEffect(() => {
    dispatch(orderStarted({ customerId, companyId }));
  }, [dispatch, customerId, companyId]);

  // Leaving with items entered asks first. Save order clears the draft before it closes this
  // screen, so it is not asked then.
  const draftCustomer = useAppSelector((st) => st.orderDraft.customerId);
  const hasItems = draftCustomer === customerId && lines.some((l) => num(l.qty) > 0);
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

  const priced = useMemo<ListRow[]>(
    () =>
      rows.flatMap((row) => {
        const start = startingPrice(row, c?.cusPriceLevelId ?? null);
        return start ? [{ row, start }] : [];
      }),
    [rows, c?.cusPriceLevelId],
  );
  const shown = useMemo(() => {
    const keep = new Set(filterOrderItems(priced.map((p) => p.row), search, filter.groupIds, filter.brandIds).map((r) => r.iucId));
    return priced.filter((p) => keep.has(p.row.iucId));
  }, [priced, search, filter]);
  const byUnit = useMemo(() => new Map(lines.map((l) => [l.iucId, l])), [lines]);
  const totals = orderTotals(lines);
  const filtered = filter.groupIds.length + filter.brandIds.length > 0;

  const onQty = useCallback(
    (p: ListRow, qty: string) => {
      if (!c) return;
      dispatch(qtyTyped({ seed: seedLine(p.row, c, p.start), qty: decimalInput(qty, 3) }));
    },
    [dispatch, c],
  );
  const onOpen = useCallback((p: ListRow) => router.push({ pathname: '/order/item', params: { iucId: p.row.iucId } }), []);

  const subtitle = [c ? customerName(c) : '', company[0]?.name ?? ''].filter(Boolean).join(' · ');
  const syncedOn = synced[0]?.value;

  return (
    <View style={st.root}>
      <ScreenHeader title={t('order.entryTitle')} subtitle={subtitle} backLabel={t('order.back')} />

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
          <ItemRow p={item} line={byUnit.get(item.row.iucId)} customer={c} language={i18n.language} onQty={onQty} onOpen={onOpen} />
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
          <Text style={st.proceedNote}>{t('order.proceedSummary', { items: totals.items, qty: qtyText(totals.qty) })}</Text>
          <View style={st.proceedRight}>
            <Text style={st.proceedText}>{t('order.proceed')}</Text>
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
  customer,
  language,
  onQty,
  onOpen,
}: {
  p: ListRow;
  line: DraftLine | undefined;
  customer: OrderCustomer | undefined;
  language: string;
  onQty: (p: ListRow, qty: string) => void;
  onOpen: (p: ListRow) => void;
}) {
  const { t } = useTranslation();
  const r = p.row;
  const name = itemName(r, language);
  const on = num(line?.qty) > 0;
  const price = toPaise(line?.price ?? p.start.price) ?? 0;
  const cooly = customer?.cusLoadingCharge && r.itemAllowLoading ? toPaise(r.ipmLoadingCharge) : null;
  const freight = customer?.cusFreightCharge && r.itemAllowFreight ? toPaise(r.ipmFreightCharge) : null;
  const meta = [
    cooly ? t('order.cooly', { amount: formatAmount(cooly) }) : null,
    freight ? t('order.freight', { amount: formatAmount(freight) }) : null,
    t('order.stock', { qty: qtyText(Number(r.stockQty) || 0) }),
  ].filter(Boolean);
  const mrp = toPaise(r.ipmMaxPrice);

  return (
    <View style={[st.row, on && st.rowOn]}>
      <Pressable accessibilityRole="button" accessibilityHint={t('order.itemTitle')} onPress={() => onOpen(p)} style={st.rowMain}>
        <Text style={st.rowName}>{name}</Text>
        <View style={st.rateLine}>
          <Text style={st.rate}>{t('order.rate', { unit: r.unitName, price: formatAmount(price) })}</Text>
          {mrp ? (
            <View style={st.mrp}>
              <Text style={st.mrpText}>{t('order.mrp', { price: formatAmount(mrp) })}</Text>
            </View>
          ) : null}
        </View>
        <Text style={st.meta}>{meta.join(' · ')}</Text>
      </Pressable>
      <TextInput
        value={line?.qty ?? ''}
        onChangeText={(v) => onQty(p, v)}
        placeholder="0"
        placeholderTextColor={colors.textMuted}
        keyboardType="decimal-pad"
        accessibilityLabel={t('order.qtyFor', { name })}
        selectTextOnFocus
        maxLength={9}
        style={st.qty}
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
  rowMain: { flex: 1, gap: 4, minWidth: 0 },
  rowName: { fontSize: font.md, fontWeight: '600', color: colors.text },
  rateLine: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  rate: { fontSize: font.sm, color: colors.textLabel },
  mrp: { backgroundColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 1 },
  mrpText: { fontSize: 11.5, fontWeight: '600', color: colors.textLabel },
  meta: { fontSize: 12, color: colors.textMuted },
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
