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
import { contextChosen, lineKey, orderCleared, orderRepeated, qtyTyped, type SoLine } from '@/features/orders/order-draft';
import { itemName, stockLeft } from '@/features/orders/order-items';
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
  soSeedLine,
  soUnitRowCountQuery,
  soUnitRowsUpToQuery,
  soUnitSizesQuery,
  type OrderCustomer,
  type SoUnitRow,
  type SoUnitSize,
} from '@/features/orders/queries';
import { backOrderQty, soLineAmounts, soTotals } from '@/features/orders/so-math';
import { useUnitEquals, useUnitStock } from '@/features/orders/unit-text';
import { useRefreshItems } from '@/features/orders/use-send-now';
import { badgeText, rupees } from '@/features/schemes/offer-text';
import { OfferSheet } from '@/features/schemes/offer-sheet';
import { PromoCode } from '@/features/schemes/scheme-types';
import { useOrderSchemes } from '@/features/schemes/use-order-schemes';
import { daysBetween, formatAmount, todayISO } from '@/lib/money';
import { useAppDispatch, useAppSelector } from '@/store';
import { colors, font, offerColors, radius, spacing } from '@/theme';

const GST = (perc: string | null) => String(Number(num(perc).toFixed(3)));

/** An offer badge on a row, worded for the row's unit. */
interface RowBadge {
  schemeId: string;
  text: string;
  /** Applied now (green), else outlined. */
  on: boolean;
  icon: 'gift-outline' | 'checkmark' | 'pricetag-outline';
}
const NO_BADGES: RowBadge[] = [];
const NO_UNITS: SoUnitSize[] = [];

/**
 * Add items (canvas 3b, step 3; was Order entry): one row per unit of each item since 2026-11-20
 * ("Sugar 1kg – Pcs", "Sugar 1kg – Box"), each with its own rate, GST and MRP, its size in the
 * item's base unit, its stock as of the last Sync (in that unit) and the offers for that unit. Type
 * a quantity on a row to order that unit, or tap the row to open it on Order item; the same item
 * may be on the order in two units. An item with no price today shows one greyed row and can't be
 * ordered. Low stock warns (a back-order), never blocks. Review order opens the review.
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
  const { data: schemesSynced } = useLiveQuery(metaQuery('schemesSyncedOn'));
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

  // 50 unit rows at first and 50 more as the list is scrolled to its end, searched and filtered in
  // the database; another search, filter or company starts again from the first 50.
  const listFilter = useMemo(() => ({ search, groupIds: filter.groupIds, brandIds: filter.brandIds }), [search, filter]);
  const listKey = `${companyId}|${itemFilterKey(listFilter)}`;
  const { limit, more } = useLoadMore(listKey);
  const { data: counted, updatedAt } = useLiveQuery(soUnitRowCountQuery(companyId, listFilter), [listKey]);
  const total = counted[0]?.n ?? 0;
  const { data: rows } = useLiveQuery(soUnitRowsUpToQuery(companyId, listFilter, limit), [listKey, limit]);
  // Every unit of the items loaded (priced or not), for "1 Box = 12 Pcs" against the base unit.
  const itemIds = useMemo(() => [...new Set(rows.map((r) => r.itemId))], [rows]);
  const idsKey = itemIds.join(',');
  const { data: sizeRows } = useLiveQuery(soUnitSizesQuery(companyId, itemIds), [companyId, idsKey]);
  const sizes = useMemo(() => {
    const m = new Map<string, SoUnitSize[]>();
    for (const r of sizeRows) {
      const list = m.get(r.itemId);
      if (list) list.push(r);
      else m.set(r.itemId, [r]);
    }
    return m;
  }, [sizeRows]);
  const searching = search.trim() !== '' || filter.groupIds.length + filter.brandIds.length > 0;
  const byUnit = useMemo(() => new Map(lines.map((l) => [lineKey(l), l])), [lines]);

  // "Already on sor00042: 4 Bag": on the row of that unit, from the first open order of this shop holding it.
  const onOrder = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of shopLines) {
      if (r.soId === draft.editingSoId || m.has(r.iucId)) continue;
      if (!isRecentOpen({ state: soState(r), soOrderDate: r.soOrderDate }, today)) continue;
      m.set(r.iucId, t('so.alreadyOn', { ref: orderRef(r), qty: qtyText(num(r.qty)), unit: r.unitName ?? '' }).trim());
    }
    return m;
  }, [shopLines, draft.editingSoId, today, t]);

  // The offers on the order (derived from the draft) and each row's badges, for its own unit: an
  // offer naming the item in another unit shows on that unit's row only.
  const { order, applyOffers } = useOrderSchemes({ extraItemIds: itemIds });
  const badges = useMemo(() => {
    const out: Record<string, RowBadge[]> = {};
    const byRow = order.unitBadges(rows);
    for (const u of rows) {
      const list = byRow[u.iucId] ?? [];
      out[u.iucId] = list.length
        ? list.flatMap((b) => {
            const s = order.scheme(b.schemeId);
            if (!s) return [];
            // Green = applied now, outlined = not reached yet; a gift for free goods, else a tick or a tag.
            const icon: RowBadge['icon'] = s.benefit === PromoCode.FreeItem ? 'gift-outline' : b.applied ? 'checkmark' : 'pricetag-outline';
            return [{ schemeId: b.schemeId, text: badgeText(s, b, u.unitName, t), on: b.applied, icon }];
          })
        : NO_BADGES;
    }
    return out;
  }, [order, rows, t]);
  const orderOffers = useMemo(() => (applyOffers ? order.orderOffers() : []), [order, applyOffers]);
  const [sheet, setSheet] = useState<{ schemeId: string; itemId: string | null; iucId?: string; unit: string } | null>(null);
  const sheetScheme = sheet ? (order.scheme(sheet.schemeId) ?? null) : null;
  const sheetOffer = sheet ? (sheet.itemId ? order.explain(sheet.itemId, sheet.iucId) : order.orderOffers()).find((o) => o.schemeId === sheet.schemeId) : undefined;
  const onBadge = useCallback((schemeId: string, u: SoUnitRow) => setSheet({ schemeId, itemId: u.itemId, iucId: u.iucId, unit: u.unitName }), []);

  const totals = soTotals(order.priced);
  const filtered = filter.groupIds.length + filter.brandIds.length > 0;

  // A quantity typed on a row not on the order starts a line in that row's unit.
  const onQty = useCallback(
    (u: SoUnitRow, line: SoLine | undefined, qty: string) => {
      if (!c) return;
      const typed = decimalInput(qty, 3);
      if (line) return dispatch(qtyTyped({ seed: line, qty: typed }));
      const start = startingPrice(u, c.cusPriceLevelId);
      if (start) dispatch(qtyTyped({ seed: soSeedLine(u, c, start), qty: typed }));
    },
    [dispatch, c],
  );
  const onOpen = useCallback((u: SoUnitRow) => router.push({ pathname: '/order/item', params: { itemId: u.itemId, iucId: u.iucId } }), []);

  const subtitle = [c ? customerName(c) : '', company[0]?.name ?? ''].filter(Boolean).join(' · ');
  // "Prices, stock and offers as of …": the older of the two Syncs; amber after 3 days.
  const itemsOn = synced[0]?.value;
  const offersAt = schemesSynced[0]?.value;
  const syncedOn = itemsOn && offersAt ? (itemsOn < offersAt ? itemsOn : offersAt) : itemsOn;
  const stale = !!syncedOn && daysBetween(todayISO(new Date(syncedOn)), today) > 3;

  return (
    <View style={st.root}>
      <ScreenHeader
        title={t('so.addItems')}
        subtitle={subtitle}
        backLabel={t('so.backToVisit')}
        right={
          <Pressable accessibilityRole="button" accessibilityLabel={t('so.refresh')} accessibilityState={{ busy: refreshing }} disabled={refreshing} onPress={() => void refresh()} style={st.headBtn}>
            {refreshing ? <ActivityIndicator color={colors.onPrimary} /> : <Ionicons name="refresh" size={22} color={colors.onPrimary} />}
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
        <Text style={[st.asOf, stale && st.asOfOld]}>
          {syncedOn ? t(offersAt ? 'offers.asOf' : 'so.stockAsOf', { when: asOfText(syncedOn, names, t('so.today')) }) : t('so.notSyncedItems')}
        </Text>
        <Text style={st.asOf}>{t('so.allGodowns')}</Text>
      </View>
      {result ? (
        <Pressable accessibilityRole="button" accessibilityHint={t('common.close')} onPress={clear} style={[st.result, !result.ok && st.resultBad]}>
          <Text style={[st.resultText, !result.ok && { color: colors.danger }]}>{result.text}</Text>
          <Ionicons name="close" size={16} color={result.ok ? colors.textMuted : colors.danger} />
        </Pressable>
      ) : null}

      {orderOffers.map((o) => {
        const more = o.nextBand?.more ?? 0;
        const gap = o.applied ? '' : o.unit === 'money' ? (more > 0 ? t('offers.moreMoney', { amount: rupees(more) }) : o.minBillShort > 0 ? t('offers.moreMoney', { amount: rupees(o.minBillShort) }) : '') : more > 0 ? t('offers.moreQty', { qty: qtyText(more) }) : '';
        if (!o.applied && !gap) return null;
        return (
          <Pressable
            key={o.schemeId}
            accessibilityRole="button"
            accessibilityHint={t('offers.badgeHint')}
            onPress={() => setSheet({ schemeId: o.schemeId, itemId: null, unit: '' })}
            style={({ pressed }) => [st.banner, o.applied && st.bannerOn, pressed && { opacity: 0.85 }]}
          >
            <Ionicons name={o.applied ? 'checkmark-circle-outline' : 'pricetag-outline'} size={22} color={o.applied ? offerColors.okText : colors.primary} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[st.bannerTitle, o.applied && { color: offerColors.okText }]}>{t(o.applied ? 'offers.orderApplied' : 'offers.orderOffer', { name: o.name })}</Text>
              {gap ? <Text style={st.bannerGap}>{gap}</Text> : null}
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </Pressable>
        );
      })}

      <FlatList
        data={rows}
        keyExtractor={(u) => u.iucId}
        contentContainerStyle={st.list}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        windowSize={7}
        onEndReached={() => more(rows.length, total)}
        onEndReachedThreshold={0.5}
        ListFooterComponent={<LoadMoreFooter shown={rows.length} total={total} />}
        ListEmptyComponent={updatedAt ? <Text style={st.empty}>{searching ? t('order.noMatch') : t('order.noItems')}</Text> : undefined}
        renderItem={({ item }) => (
          <UnitRow
            u={item}
            units={sizes.get(item.itemId) ?? NO_UNITS}
            line={byUnit.get(item.iucId)}
            // The item's lines in other units ahead of this one draw on the same stock.
            stockLeft={stockLeft(lines, item, Number(item.stockQty) || 0)}
            customer={c}
            note={onOrder.get(item.iucId)}
            language={i18n.language}
            badges={badges[item.iucId] ?? NO_BADGES}
            onQty={onQty}
            onOpen={onOpen}
            onBadge={onBadge}
          />
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
            <Text style={st.proceedNote}>
              {t('so.itemsQty', { count: totals.items, qty: qtyText(totals.qty) })}
              {order.freeQty > 0 ? ` + ${t('offers.plusFree', { qty: qtyText(order.freeQty) })}` : ''}
            </Text>
            <Text style={st.proceedTotal}>{formatAmount(totals.totalPaise)}</Text>
          </View>
          <View style={st.proceedRight}>
            <Text style={st.proceedText}>{t('so.reviewOrder')}</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.onPrimary} />
          </View>
        </Pressable>
      </View>

      <OfferSheet scheme={sheetScheme} offer={sheetOffer} unit={sheet?.unit ?? ''} syncedOn={offersAt ?? null} companyName={company[0]?.name} onClose={() => setSheet(null)} />
      <ItemFilterSheet visible={filterOpen} value={filter} groups={groups} brands={brands} onApply={setFilter} onClose={() => setFilterOpen(false)} />
    </View>
  );
}

/** One unit of an item: "Sugar 1kg – Box", its rate, size, offers and stock, and the quantity box. */
const UnitRow = memo(function UnitRow({
  u,
  units,
  line,
  stockLeft: left,
  customer,
  note,
  language,
  badges,
  onQty,
  onOpen,
  onBadge,
}: {
  u: SoUnitRow;
  /** Every unit of the item, for its size against the base unit. */
  units: readonly SoUnitSize[];
  line: SoLine | undefined;
  /** The stock this unit may still draw after the item's lines in other units. */
  stockLeft: number;
  customer: OrderCustomer | undefined;
  note: string | undefined;
  language: string;
  badges: RowBadge[];
  onQty: (u: SoUnitRow, line: SoLine | undefined, qty: string) => void;
  onOpen: (u: SoUnitRow) => void;
  onBadge: (schemeId: string, u: SoUnitRow) => void;
}) {
  const { t } = useTranslation();
  const unitEquals = useUnitEquals();
  const unitStock = useUnitStock();
  const equals = unitEquals(u, units);
  const name = itemName(u, language);
  // Only an item with no priced unit has an unpriced row (greyed, "ask the office").
  const off = !u.appPriced;
  const qty = num(line?.qty);
  const on = qty > 0;
  const start = customer && !off ? startingPrice(u, customer.cusPriceLevelId) : null;
  const price = toPaise(line?.price ?? start?.price) ?? 0;
  const mrp = toPaise(u.ipmMaxPrice);
  const back = backOrderQty(qty, left);
  const discPaise = line ? soLineAmounts(line).discPaise : 0;

  let meta: string;
  let warn = false;
  if (off) {
    meta = t('so.askOffice');
    warn = true;
  } else if (back > 0) {
    meta = t('so.backOrder', { stock: qtyText(Math.max(0, left)), qty: qtyText(back), unit: u.unitName });
    warn = true;
  } else if (left <= 0) {
    meta = t('so.stockZero', { stock: qtyText(Math.max(0, left)) });
    warn = true;
  } else {
    meta = [unitStock(u, units), discPaise > 0 ? t('so.discApplied', { amount: formatAmount(discPaise) }) : null].filter(Boolean).join(' · ');
  }

  return (
    <View style={[st.row, on && st.rowOn]}>
      <Pressable accessibilityRole="button" accessibilityHint={t('order.itemTitle')} disabled={off} onPress={() => onOpen(u)} style={st.rowMain}>
        <Text style={st.rowName}>{t('so.itemUnit', { name, unit: u.unitName })}</Text>
        <View style={st.rateLine}>
          <Text style={st.rate}>{off ? t('so.noPriceToday') : t('so.rateLine', { price: formatAmount(price), unit: u.unitName, gst: GST(u.taxPerc) })}</Text>
          <View style={st.mrp}>
            <Text style={st.mrpText}>{mrp ? t('order.mrp', { price: formatAmount(mrp) }) : t('so.noMrp')}</Text>
          </View>
          {equals ? <Text style={st.conv}>{equals}</Text> : null}
        </View>
        {badges.length > 0 ? (
          <View style={st.badges}>
            {badges.map((b) => (
              <Pressable
                key={b.schemeId}
                accessibilityRole="button"
                accessibilityLabel={`${b.text}. ${t('offers.badgeHint')}`}
                hitSlop={6}
                onPress={() => onBadge(b.schemeId, u)}
                style={({ pressed }) => [st.badge, b.on && st.badgeOn, pressed && { opacity: 0.7 }]}
              >
                <Ionicons name={b.icon} size={13} color={b.on ? offerColors.okText : colors.primary} />
                <Text style={[st.badgeText, b.on && { color: offerColors.okText }]} numberOfLines={1}>
                  {b.text}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        <Text style={[st.meta, warn && { color: offerColors.warn }]}>{meta}</Text>
        {note ? (
          <View style={st.note}>
            <Text style={st.noteText}>{note}</Text>
          </View>
        ) : null}
      </Pressable>
      <View style={st.qtyBox}>
        <TextInput
          value={line?.qty ?? ''}
          onChangeText={(v) => onQty(u, line, v)}
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
    gap: spacing.sm,
    height: 46,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
  },
  searchInput: { flex: 1, fontSize: font.md, color: colors.text, padding: 0 },
  filterBtn: {
    width: 46,
    height: 46,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterOn: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  asOfRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: 6 },
  asOf: { fontSize: 12.5, color: colors.textMuted },
  asOfOld: { color: offerColors.warn, fontWeight: '600' },
  // An order offer still to reach: white, dashed maroon; reached: green.
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.xs,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: offerColors.bannerBorder,
    borderRadius: radius.md + 2,
    paddingVertical: 9,
    paddingHorizontal: spacing.md,
  },
  bannerOn: { backgroundColor: offerColors.okBg, borderColor: offerColors.okBorder, borderStyle: 'solid' },
  bannerTitle: { fontSize: 13.5, fontWeight: '700', color: colors.text },
  bannerGap: { fontSize: 12.5, fontWeight: '600', color: offerColors.warn },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 3 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    maxWidth: '100%',
    minHeight: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: offerColors.badgeBorder,
    backgroundColor: colors.surface,
    paddingHorizontal: 9,
  },
  badgeOn: { backgroundColor: offerColors.okBg, borderColor: offerColors.okBorder },
  badgeText: { flexShrink: 1, fontSize: 12, fontWeight: '700', color: colors.primary },
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
  rowOn: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  rowMain: { flex: 1, gap: 3, minWidth: 0 },
  rowName: { fontSize: font.md, fontWeight: '700', color: colors.text },
  rateLine: { flexDirection: 'row', alignItems: 'center', columnGap: spacing.sm, rowGap: 3, flexWrap: 'wrap' },
  rate: { fontSize: font.sm, color: colors.textMuted },
  mrp: { backgroundColor: offerColors.mrpBg, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 7, paddingVertical: 1 },
  mrpText: { fontSize: 12, fontWeight: '600', color: colors.textLabel },
  meta: { marginTop: 1, fontSize: 12.5, color: colors.textMuted },
  note: { alignSelf: 'flex-start', backgroundColor: '#FEF3C7', borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 1 },
  noteText: { fontSize: 12, fontWeight: '600', color: '#92400E' },
  qtyBox: { alignItems: 'center', gap: 3, width: 64 },
  qty: {
    width: 62,
    height: 44,
    borderWidth: 1.5,
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
  unit: { fontSize: 11.5, fontWeight: '600', color: colors.textMuted },
  conv: { fontSize: 11.5, color: colors.textMuted },
  footer: { paddingTop: spacing.sm, paddingHorizontal: spacing.lg, backgroundColor: colors.bg },
  proceed: {
    minHeight: 54,
    borderRadius: radius.md + 2,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  proceedNote: { fontSize: font.sm, color: colors.onPrimaryMuted },
  proceedTotal: { fontSize: 16, fontWeight: '700', color: colors.onPrimary },
  proceedRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  proceedText: { fontSize: 16, fontWeight: '700', color: colors.onPrimary },
});
