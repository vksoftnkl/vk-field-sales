import Ionicons from '@expo/vector-icons/Ionicons';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { router } from 'expo-router';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/screen-header';
import { ItemFilterSheet, type ItemFilter } from '@/features/orders/item-filter-sheet';
import { filterOrderItems, itemName } from '@/features/orders/order-items';
import { startingPrice, toPaise } from '@/features/orders/order-math';
import { itemBrandsQuery, itemGroupsQuery } from '@/features/orders/queries';
import { returnCustomerQuery } from '@/features/returns/queries';
import { saleItemsQuery, type SaleItemRow } from '@/features/sales/queries';
import { formatAmount } from '@/lib/money';
import { useAppSelector } from '@/store';
import { colors, font, radius, spacing } from '@/theme';

interface ListRow {
  row: SaleItemRow;
  /** The return price a new line starts at: the customer's price level, as on a bill. */
  price: string;
}

/**
 * Product list for a sales return (the Qt app's ReturnItemSelection.qml): every unit the company
 * sells, at the customer's price, with MRP. Search by code, name or Tamil name; filter by group
 * or brand. Tapping one opens Return item for a new line.
 */
export default function ReturnProductsScreen() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const companyId = useAppSelector((st) => st.returnDraft.companyId) ?? '';
  const customerId = useAppSelector((st) => st.returnDraft.customerId) ?? '';

  const { data: rows, updatedAt } = useLiveQuery(saleItemsQuery(companyId), [companyId]);
  const { data: found } = useLiveQuery(returnCustomerQuery(customerId), [customerId]);
  const { data: groups } = useLiveQuery(itemGroupsQuery());
  const { data: brands } = useLiveQuery(itemBrandsQuery());
  const level = found[0]?.cusPriceLevelId ?? null;

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<ItemFilter>({ groupIds: [], brandIds: [] });
  const [filterOpen, setFilterOpen] = useState(false);

  const priced = useMemo<ListRow[]>(
    () =>
      rows.flatMap((row) => {
        const start = startingPrice(row, level);
        return start ? [{ row, price: start.price }] : [];
      }),
    [rows, level],
  );
  const shown = useMemo(() => {
    const keep = new Set(filterOrderItems(priced.map((p) => p.row), search, filter.groupIds, filter.brandIds).map((r) => r.iucId));
    return priced.filter((p) => keep.has(p.row.iucId));
  }, [priced, search, filter]);
  const filtered = filter.groupIds.length + filter.brandIds.length > 0;

  const onOpen = useCallback((p: ListRow) => router.push({ pathname: '/sales-return/item', params: { iucId: p.row.iucId } }), []);

  return (
    <View style={st.root}>
      <ScreenHeader title={t('salesReturn.productsTitle')} subtitle={t('salesReturn.productsSubtitle')} backLabel={t('salesReturn.back')} />

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

      <FlatList
        data={shown}
        keyExtractor={(p) => p.row.iucId}
        contentContainerStyle={[st.list, { paddingBottom: insets.bottom + spacing.lg }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        initialNumToRender={12}
        windowSize={7}
        ListEmptyComponent={updatedAt ? <Text style={st.empty}>{priced.length === 0 ? t('order.noItems') : t('order.noMatch')}</Text> : undefined}
        renderItem={({ item }) => <ProductRow p={item} language={i18n.language} onOpen={onOpen} />}
      />

      <ItemFilterSheet visible={filterOpen} value={filter} groups={groups} brands={brands} onApply={setFilter} onClose={() => setFilterOpen(false)} />
    </View>
  );
}

const ProductRow = memo(function ProductRow({ p, language, onOpen }: { p: ListRow; language: string; onOpen: (p: ListRow) => void }) {
  const { t } = useTranslation();
  const mrp = toPaise(p.row.ipmMaxPrice);
  return (
    <Pressable accessibilityRole="button" onPress={() => onOpen(p)} style={({ pressed }) => [st.row, pressed && { opacity: 0.85 }]}>
      <View style={st.rowMain}>
        <Text style={st.rowName}>{itemName(p.row, language)}</Text>
        <View style={st.rateLine}>
          <Text style={st.rate}>{t('order.rate', { unit: p.row.unitName, price: formatAmount(toPaise(p.price) ?? 0) })}</Text>
          {mrp ? (
            <View style={st.mrp}>
              <Text style={st.mrpText}>{t('order.mrp', { price: formatAmount(mrp) })}</Text>
            </View>
          ) : null}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </Pressable>
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
  list: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, gap: spacing.sm },
  empty: { textAlign: 'center', fontSize: font.md, color: colors.textMuted, padding: spacing.xl },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 64,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md + 2,
    paddingVertical: 10,
    paddingLeft: spacing.md + 2,
    paddingRight: spacing.md,
  },
  rowMain: { flex: 1, gap: 4, minWidth: 0 },
  rowName: { fontSize: font.md, fontWeight: '600', color: colors.text },
  rateLine: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  rate: { fontSize: font.sm, color: colors.textLabel },
  mrp: { backgroundColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 1 },
  mrpText: { fontSize: 11.5, fontWeight: '600', color: colors.textLabel },
});
