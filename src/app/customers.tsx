import Ionicons from '@expo/vector-icons/Ionicons';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { router } from 'expo-router';
import type { TFunction } from 'i18next';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppMenu } from '@/components/app-menu';
import { MultiPickSheet, type PickOption } from '@/components/sheet';
import { Chip } from '@/components/ui';
import { metaQuery, setMeta } from '@/db/meta';
import { CompanySheet } from '@/features/company/company-sheet';
import { countByQuickFilter, filterCustomers, visitStatus, type CustomerRow, type QuickFilter } from '@/features/customers/customer-list';
import {
  beatCountsQuery,
  beatsQuery,
  customerListQuery,
  customerTypesQuery,
  pendingUploadQuery,
  typeCountsQuery,
} from '@/features/customers/queries';
import { QuickFilterSheet } from '@/features/customers/quick-filter-sheet';
import { pendingOrdersCountQuery, pendingVisitsCountQuery } from '@/features/orders/queries';
import { pendingReceiptsCountQuery } from '@/features/receipts/queries';
import { daysBetween, formatRupees, todayISO } from '@/lib/money';
import { serializeIdList } from '@/lib/selection';
import { colors, font, radius, spacing, statusColors } from '@/theme';

/** Which overlay is open; one at a time, so the menu closes as Choose company opens. */
type Overlay = 'menu' | 'quick' | 'beat' | 'type' | 'company' | null;

/** "All", the one ticked name, or "2 beats". */
function choiceLabel(ids: readonly string[], rows: readonly { id: string; name: string }[], all: string, many: (n: number) => string) {
  if (ids.length === 0) return all;
  if (ids.length === 1) return rows.find((r) => r.id === ids[0])?.name ?? all;
  return many(ids.length);
}

/**
 * Customer list: the home page after login, like the Qt app's CustomerPage. Shops of the
 * chosen beats with what they owe and what happened there on this trip.
 */
export default function CustomersScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  // Opens with no beat or type ticked (all shops); the salesman picks the beat and taps Apply.
  // Each login clears the saved beat, so nothing carries over from the last trip.
  const [beatIds, setBeatIds] = useState<string[]>([]);
  const [typeIds, setTypeIds] = useState<string[]>([]);
  const [quick, setQuick] = useState<QuickFilter>('all');
  const [query, setQuery] = useState('');
  const [overlay, setOverlay] = useState<Overlay>(null);
  const close = () => setOverlay(null);
  const beatKey = serializeIdList(beatIds);
  const typeKey = serializeIdList(typeIds);

  const { data: beatRows } = useLiveQuery(beatsQuery());
  const { data: typeRows } = useLiveQuery(customerTypesQuery());
  // The amounts come from the ledgers Sync saves after the customers: read again when it does.
  const { data: ledgerMark } = useLiveQuery(metaQuery('ledgerSyncedAt'));
  const ledgerKey = ledgerMark[0]?.value ?? '';
  const { data: rows, updatedAt, error: listError } = useLiveQuery(customerListQuery(beatIds, typeIds), [beatKey, typeKey, ledgerKey]);
  const { data: beatCounts } = useLiveQuery(beatCountsQuery());
  const { data: typeCounts } = useLiveQuery(typeCountsQuery(beatIds), [beatKey]);
  const { data: pendingRows } = useLiveQuery(pendingUploadQuery());
  const { data: pendingOrders } = useLiveQuery(pendingOrdersCountQuery());
  const { data: pendingVisits } = useLiveQuery(pendingVisitsCountQuery());
  const { data: pendingReceipts } = useLiveQuery(pendingReceiptsCountQuery());
  // Shops, edits, orders, check-ins and receipts still to send (each table is watched on its own).
  const pending = (pendingRows[0]?.n ?? 0) + (pendingOrders[0]?.n ?? 0) + (pendingVisits[0]?.n ?? 0) + (pendingReceipts[0]?.n ?? 0);

  const shown = useMemo(() => filterCustomers(rows, query, quick), [rows, query, quick]);
  // Counts in the filter sheet: shops of these beats and types, before the search box narrows them.
  const quickCounts = useMemo(() => countByQuickFilter(rows), [rows]);
  const today = todayISO();

  const shopsLabel = (n: number) => (n === 1 ? t('customers.oneShop') : t('customers.nShops', { n }));
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
  const beatTitle = beatIds.length === 0 ? t('customers.allBeats') : beatChoice;

  // Saved so New customer and the sales return's customer list start in today's beat.
  const applyBeats = (ids: string[]) => {
    setBeatIds(ids);
    setMeta('lastBeatIds', serializeIdList(ids));
  };

  const filtered = beatIds.length > 0 || typeIds.length > 0 || quick !== 'all' || query.trim() !== '';

  return (
    <View style={st.root}>
      {/* Maroon header: menu, title with beat and shop count, Upload */}
      <View style={[st.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('customers.menu')} hitSlop={8} onPress={() => setOverlay('menu')} style={st.menuBtn}>
          <Ionicons name="menu" size={26} color={colors.onPrimary} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={st.title} numberOfLines={1}>
            {t('customers.title')}
          </Text>
          {/* A blank line until the first read, rather than a flash of "0 shops". */}
          <Text style={st.subtitle} numberOfLines={1}>
            {updatedAt ? `${beatTitle} · ${shopsLabel(rows.length)}` : ' '}
          </Text>
        </View>
        <Pressable accessibilityRole="button" onPress={() => router.push('/sync')} style={({ pressed }) => [st.upload, pressed && { opacity: 0.85 }]}>
          <Ionicons name="share-outline" size={18} color={colors.text} />
          <Text style={st.uploadText}>{pending > 0 ? `${t('customers.upload')} · ${pending}` : t('customers.upload')}</Text>
        </Pressable>
      </View>

      {/* Search + quick filter */}
      <View style={st.searchRow}>
        <View style={st.search}>
          <Ionicons name="search" size={20} color={colors.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t('customers.searchPlaceholder')}
            placeholderTextColor={colors.textMuted}
            accessibilityLabel={t('common.search')}
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
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('customers.quickTitle')}
          accessibilityValue={{ text: t(`customers.quick.${quick}`) }}
          onPress={() => setOverlay('quick')}
          style={({ pressed }) => [st.filterBtn, quick !== 'all' && st.filterBtnActive, pressed && { opacity: 0.8 }]}
        >
          <Ionicons name="filter" size={22} color={colors.primary} />
        </Pressable>
      </View>

      {/* Beat and type */}
      <View style={st.chips}>
        <Chip label={`${t('customers.beat')}: ${beatChoice}`} active={beatIds.length > 0} onPress={() => setOverlay('beat')} />
        <Chip label={`${t('customers.type')}: ${typeChoice}`} active={typeIds.length > 0} onPress={() => setOverlay('type')} />
      </View>

      <FlatList
        data={shown}
        keyExtractor={(c) => c.cusId}
        renderItem={({ item }) => <CustomerCard c={item} today={today} />}
        ItemSeparatorComponent={Gap}
        contentContainerStyle={[st.list, { paddingBottom: insets.bottom + FAB_CLEARANCE }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        ListEmptyComponent={
          // A failed read says why instead of looking like an empty list. Otherwise nothing until
          // the first read finishes, so an empty message never flashes on open.
          listError ? (
            <Text style={[st.empty, { color: colors.danger }]}>{t('customers.readError', { message: listError.message })}</Text>
          ) : updatedAt ? (
            <Text style={st.empty}>{filtered ? t('customers.noMatches') : t('customers.empty')}</Text>
          ) : undefined
        }
      />

      <Pressable
        accessibilityRole="button"
        onPress={() => router.push('/customer/new')}
        style={({ pressed }) => [st.fab, { bottom: insets.bottom + spacing.lg }, pressed && { opacity: 0.9 }]}
      >
        <Ionicons name="add" size={24} color={colors.onPrimary} />
        <Text style={st.fabText}>{t('customers.newCustomer')}</Text>
      </Pressable>

      <QuickFilterSheet visible={overlay === 'quick'} value={quick} counts={quickCounts} onApply={setQuick} onClose={close} />
      <MultiPickSheet
        visible={overlay === 'beat'}
        title={t('customers.chooseBeat')}
        options={beatOptions}
        onApply={applyBeats}
        onClose={close}
      />
      <MultiPickSheet
        visible={overlay === 'type'}
        title={t('customers.chooseType')}
        options={typeOptions}
        onApply={setTypeIds}
        onClose={close}
      />
      <AppMenu
        visible={overlay === 'menu'}
        onClose={close}
        onSwitchCompany={() => setOverlay('company')}
        onSync={() => {
          close();
          router.push('/sync');
        }}
        onMyOrders={() => {
          close();
          router.push('/orders');
        }}
      />
      <CompanySheet visible={overlay === 'company'} onClose={close} />
    </View>
  );
}

function Gap() {
  return <View style={{ height: spacing.sm }} />;
}

/**
 * "4 bills · oldest 65 days", "1 bill · 3 days" or "No unpaid bills". Nothing when the phone has
 * no bills but VK Nex's balance says the customer owes (bills don't come from VK Nex yet).
 */
function billLine(t: TFunction, c: CustomerRow, today: string): string {
  if (c.billCount === 0 || !c.oldestBillDate) return c.outstandingPaise > 0 ? '' : t('customers.noBills');
  const d = daysBetween(c.oldestBillDate, today);
  const age = d === 0 ? t('customers.today') : d === 1 ? t('customers.oneDay') : t('customers.nDays', { n: d });
  if (c.billCount === 1) return `${t('customers.oneBill')} · ${age}`;
  return `${t('customers.nBills', { n: c.billCount })} · ${t('customers.oldest', { age })}`;
}

const CustomerCard = memo(function CustomerCard({ c, today }: { c: CustomerRow; today: string }) {
  const { t } = useTranslation();
  const status = visitStatus(c);
  const chip = statusColors[status];
  const bills = billLine(t, c, today);
  const amount = formatRupees(c.outstandingPaise);
  const statusText = t(`customers.status.${status}`);
  // VK Nex allows a customer without a name; fall back to the short name or code.
  const name = c.cusName ?? c.cusShort ?? c.cusCode ?? '';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[name, amount, bills, statusText].filter(Boolean).join(', ')}
      onPress={() => router.push({ pathname: '/customer/[id]', params: { id: c.cusId } })}
      style={({ pressed }) => [st.card, pressed && { backgroundColor: colors.bg }]}
    >
      <View style={st.cardLeft}>
        <Text style={st.name} numberOfLines={2}>
          {name}
        </Text>
        {bills ? (
          <Text style={st.meta} numberOfLines={1}>
            {bills}
          </Text>
        ) : null}
      </View>
      <View style={st.cardRight}>
        <Text style={st.amount}>{amount}</Text>
        <View style={[st.chip, { backgroundColor: chip.bg }]}>
          <Text style={[st.chipText, { color: chip.fg }]} numberOfLines={1}>
            {statusText}
          </Text>
        </View>
      </View>
    </Pressable>
  );
});

/** Room under the last card so the New customer button never hides it. */
const FAB_CLEARANCE = 88;

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  menuBtn: { width: 32, alignItems: 'flex-start' },
  title: { fontSize: 20, fontWeight: '700', color: colors.onPrimary },
  subtitle: { marginTop: 2, fontSize: font.sm, color: colors.onPrimaryMuted },
  upload: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 44,
    paddingHorizontal: spacing.md + 2,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
  },
  uploadText: { fontSize: font.md, fontWeight: '700', color: colors.text },
  searchRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  search: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    height: 50,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg - 2,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  searchInput: { flex: 1, height: '100%', fontSize: font.md, color: colors.text, padding: 0 },
  filterBtn: {
    width: 50,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.lg - 2,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  filterBtnActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  list: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  empty: { textAlign: 'center', fontSize: font.md, color: colors.textMuted, paddingVertical: spacing.xxl },
  card: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.lg - 2,
    paddingVertical: spacing.md + 2,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  cardLeft: { flex: 1, justifyContent: 'center' },
  cardRight: { alignItems: 'flex-end', justifyContent: 'space-between', gap: spacing.xs + 2 },
  name: { fontSize: font.md, fontWeight: '700', color: colors.text },
  meta: { marginTop: spacing.xs, fontSize: font.sm, color: colors.textMuted },
  amount: { fontSize: font.md + 1, fontWeight: '700', color: colors.text },
  chip: { borderRadius: radius.sm + 2, paddingHorizontal: spacing.sm + 2, paddingVertical: 2 },
  chipText: { fontSize: 12, fontWeight: '700' },
  fab: {
    position: 'absolute',
    right: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 56,
    paddingHorizontal: spacing.xl - 4,
    borderRadius: radius.lg + 2,
    backgroundColor: colors.primary,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  fabText: { fontSize: font.md + 1, fontWeight: '700', color: colors.onPrimary },
});
