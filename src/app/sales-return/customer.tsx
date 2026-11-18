import Ionicons from '@expo/vector-icons/Ionicons';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { router } from 'expo-router';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/screen-header';
import { MultiPickSheet, type PickOption } from '@/components/sheet';
import { Chip } from '@/components/ui';
import { getMeta } from '@/db/meta';
import { addressLine, searchCustomers } from '@/features/customers/customer-list';
import { beatCountsQuery, beatsQuery, customerTypesQuery, existingBeatIds, pickCustomersQuery, typeCountsQuery } from '@/features/customers/queries';
import { customerName } from '@/features/orders/queries';
import { returnCustomerChanged } from '@/features/returns/return-draft';
import { parseIdList, serializeIdList } from '@/lib/selection';
import { useAppDispatch, useAppSelector } from '@/store';
import { colors, font, radius, spacing } from '@/theme';

type Row = ReturnType<ReturnType<typeof pickCustomersQuery>['all']>[number];

/** "All", the one ticked name, or "2 beats" (as on Home). */
function choiceLabel(ids: readonly string[], rows: readonly { id: string; name: string }[], all: string, many: (n: number) => string) {
  if (ids.length === 0) return all;
  if (ids.length === 1) return rows.find((r) => r.id === ids[0])?.name ?? all;
  return many(ids.length);
}

/**
 * Choose customer for a sales return (the Qt app's CustomerSelection.qml), from Change on Sales
 * return: Home's search and Beat / Type chips, starting on the beats ticked on Home; the shop the
 * return is for is marked Current. Picking a shop keeps the products already entered.
 */
export default function ReturnCustomerScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const dispatch = useAppDispatch();
  const current = useAppSelector((st) => st.returnDraft.customerId);

  // Ticking beats here does not change Home's beats.
  const [beatIds, setBeatIds] = useState<string[]>(() => existingBeatIds(parseIdList(getMeta('lastBeatIds'))));
  const [typeIds, setTypeIds] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [sheet, setSheet] = useState<'beat' | 'type' | null>(null);
  const beatKey = serializeIdList(beatIds);
  const typeKey = serializeIdList(typeIds);

  const { data: beatRows } = useLiveQuery(beatsQuery());
  const { data: typeRows } = useLiveQuery(customerTypesQuery());
  const { data: rows, updatedAt } = useLiveQuery(pickCustomersQuery(beatIds, typeIds), [beatKey, typeKey]);
  const { data: beatCounts } = useLiveQuery(beatCountsQuery());
  const { data: typeCounts } = useLiveQuery(typeCountsQuery(beatIds), [beatKey]);
  const shown = useMemo(() => searchCustomers(rows, query), [rows, query]);

  const beatOptions: PickOption[] = useMemo(() => {
    const counts = new Map(beatCounts.map((c) => [c.id, c.n]));
    return beatRows.map((b) => {
      const n = counts.get(b.id) ?? 0;
      return { value: b.id, label: b.name, count: n === 1 ? t('customers.oneShop') : t('customers.nShops', { n }) };
    });
  }, [beatRows, beatCounts, t]);
  const typeOptions: PickOption[] = useMemo(() => {
    const counts = new Map(typeCounts.map((c) => [c.id, c.n]));
    return typeRows.map((ty) => ({ value: ty.id, label: ty.name, count: String(counts.get(ty.id) ?? 0) }));
  }, [typeRows, typeCounts]);
  const beatChoice = choiceLabel(beatIds, beatRows, t('customers.all'), (n) => t('customers.nBeats', { n }));
  const typeChoice = choiceLabel(typeIds, typeRows, t('customers.all'), (n) => t('customers.nTypes', { n }));
  const filtered = beatIds.length > 0 || typeIds.length > 0 || query.trim() !== '';

  const pick = (id: string) => {
    dispatch(returnCustomerChanged(id));
    router.back();
  };

  return (
    <View style={st.root}>
      <ScreenHeader title={t('salesReturn.chooseCustomer')} subtitle={t('salesReturn.chooseSubtitle')} backLabel={t('salesReturn.back')} />

      <View style={st.search}>
        <Ionicons name="search" size={20} color={colors.textMuted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t('salesReturn.searchCustomer')}
          placeholderTextColor={colors.textMuted}
          accessibilityLabel={t('salesReturn.searchCustomer')}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          style={st.searchInput}
        />
        {query ? (
          <Pressable accessibilityRole="button" accessibilityLabel={t('customers.clearSearch')} hitSlop={12} onPress={() => setQuery('')}>
            <Ionicons name="close-circle" size={20} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </View>

      <View style={st.chips}>
        <Chip label={`${t('customers.beat')}: ${beatChoice}`} active={beatIds.length > 0} onPress={() => setSheet('beat')} />
        <Chip label={`${t('customers.type')}: ${typeChoice}`} active={typeIds.length > 0} onPress={() => setSheet('type')} />
      </View>

      <FlatList
        data={shown}
        keyExtractor={(c) => c.cusId}
        renderItem={({ item }) => <CustomerRow c={item} current={item.cusId === current} onPick={pick} />}
        contentContainerStyle={[st.list, { paddingBottom: insets.bottom + spacing.lg }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        initialNumToRender={12}
        ListEmptyComponent={updatedAt ? <Text style={st.empty}>{filtered ? t('customers.noMatches') : t('customers.empty')}</Text> : undefined}
      />

      <MultiPickSheet
        visible={sheet === 'beat'}
        title={t('customers.chooseBeat')}
        options={beatOptions}
        onApply={setBeatIds}
        onClose={() => setSheet(null)}
      />
      <MultiPickSheet
        visible={sheet === 'type'}
        title={t('customers.chooseType')}
        options={typeOptions}
        onApply={setTypeIds}
        onClose={() => setSheet(null)}
      />
    </View>
  );
}

const CustomerRow = memo(function CustomerRow({ c, current, onPick }: { c: Row; current: boolean; onPick: (id: string) => void }) {
  const { t } = useTranslation();
  const address = addressLine(c);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: current }}
      onPress={() => onPick(c.cusId)}
      style={({ pressed }) => [st.row, current && st.rowCurrent, pressed && { opacity: 0.85 }]}
    >
      <View style={st.rowText}>
        <Text style={st.rowName}>{customerName(c)}</Text>
        {address ? <Text style={st.rowAddress}>{address}</Text> : null}
      </View>
      {current ? <Text style={st.currentTag}>{t('salesReturn.current')}</Text> : null}
    </Pressable>
  );
});

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  search: {
    marginTop: spacing.md + 2,
    marginHorizontal: spacing.lg,
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
  chips: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: 10, paddingBottom: spacing.xs },
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
    paddingHorizontal: spacing.md + 2,
  },
  rowCurrent: { backgroundColor: colors.primarySoft, borderColor: colors.primary, borderWidth: 2 },
  rowText: { flex: 1, gap: 3, minWidth: 0 },
  rowName: { fontSize: font.md, fontWeight: '600', color: colors.text },
  rowAddress: { fontSize: font.sm, color: colors.textMuted },
  currentTag: { fontSize: 12, fontWeight: '600', color: colors.primary },
});
