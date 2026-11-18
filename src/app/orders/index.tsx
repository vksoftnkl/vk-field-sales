import Ionicons from '@expo/vector-icons/Ionicons';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/screen-header';
import { useDateNames } from '@/components/use-date-names';
import { CustomDatesDialog } from '@/features/ledger/custom-dates-dialog';
import { choiceRange, DateRangeSheet, type RangeChoice } from '@/features/ledger/date-range-sheet';
import { asOfText, hhmm, inFilter, SO_FILTERS, SO_TONES, soState, type SoFilter } from '@/features/orders/order-status';
import { toPaise } from '@/features/orders/order-math';
import { lastSentQuery, myOrdersQuery, orderRef, pendingOrdersCountQuery, pendingVisitsCountQuery } from '@/features/orders/queries';
import { useSendNow } from '@/features/orders/use-send-now';
import { formatDay, formatRangeShort } from '@/lib/date-range';
import { formatAmount, todayISO } from '@/lib/money';
import { colors, font, radius, spacing } from '@/theme';

/**
 * My orders (canvas 3b, step 7; was Reports → Order list): the phone's orders in a date range with
 * where each stands — Waiting to send, Sent back, or VK Nex's status as of its last answer — one
 * colour per status. The strip on top says what is waiting and sends it (Send now).
 */
export default function MyOrdersScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const names = useDateNames();
  const today = todayISO();
  const [choice, setChoice] = useState<RangeChoice>({ key: 'last30' });
  const [overlay, setOverlay] = useState<'range' | 'custom' | null>(null);
  const [filter, setFilter] = useState<SoFilter>('all');
  const range = choiceRange(choice, today);

  const { data: rows, updatedAt } = useLiveQuery(myOrdersQuery(range.from, range.to), [range.from, range.to]);
  const { data: waitingOrders } = useLiveQuery(pendingOrdersCountQuery());
  const { data: waitingVisits } = useLiveQuery(pendingVisitsCountQuery());
  const { data: lastSent } = useLiveQuery(lastSentQuery());
  const { sending, result, send } = useSendNow();

  const orders = useMemo(() => rows.map((r) => ({ ...r, state: soState(r) })), [rows]);
  const counts = useMemo(() => Object.fromEntries(SO_FILTERS.map((f) => [f, orders.filter((o) => inFilter(o.state, f)).length])) as Record<SoFilter, number>, [orders]);
  const shown = orders.filter((o) => inFilter(o.state, filter));

  const nOrders = waitingOrders[0]?.n ?? 0;
  const nVisits = waitingVisits[0]?.n ?? 0;
  const sentAt = lastSent[0]?.at ?? null;
  const asOf = sentAt ? asOfText(sentAt, names, t('so.today')) : null;
  const subtitle = [formatRangeShort(range, names), asOf ? t('so.statusAsOf', { when: asOf }) : null].filter(Boolean).join(' · ');

  return (
    <View style={st.root}>
      <ScreenHeader
        title={t('so.myOrders')}
        subtitle={subtitle}
        backLabel={t('so.back')}
        right={
          <Pressable accessibilityRole="button" accessibilityLabel={t('so.pickDates')} onPress={() => setOverlay('range')} style={st.headBtn}>
            <Ionicons name="calendar-outline" size={22} color={colors.onPrimary} />
          </Pressable>
        }
      />

      <View style={st.strip}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={st.stripTitle}>
            {nOrders + nVisits > 0 ? t('so.waitingStrip', { orders: t('so.nOrders', { count: nOrders }), visits: t('so.nVisits', { count: nVisits }) }) : t('so.nothingWaiting')}
          </Text>
          <Text style={[st.small, result && !result.ok && { color: colors.danger }]} accessibilityLiveRegion="polite">
            {result ? result.text : asOf ? t('so.lastSent', { when: asOf }) : t('so.notSentYet')}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: sending || nOrders + nVisits === 0, busy: sending }}
          disabled={sending || nOrders + nVisits === 0}
          onPress={() => void send()}
          style={({ pressed }) => [st.sendBtn, nOrders + nVisits === 0 && { opacity: 0.5 }, pressed && { opacity: 0.85 }]}
        >
          {sending ? (
            <ActivityIndicator color={colors.onPrimary} />
          ) : (
            <>
              <Ionicons name="arrow-up" size={16} color={colors.onPrimary} />
              <Text style={st.sendText}>{t('so.sendNow')}</Text>
            </>
          )}
        </Pressable>
      </View>

      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.chips} accessibilityRole="tablist">
          {SO_FILTERS.map((f) => {
            const on = filter === f;
            return (
              <Pressable key={f} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => setFilter(f)} style={[st.chip, on && st.chipOn]}>
                <Text style={[st.chipText, on && st.chipTextOn]}>{t(`so.filters.${f}`, { count: counts[f] })}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <FlatList
        data={shown}
        keyExtractor={(o) => o.soId}
        contentContainerStyle={[st.list, { paddingBottom: insets.bottom + spacing.lg }]}
        ListEmptyComponent={updatedAt ? <Text style={st.empty}>{t('so.noOrders')}</Text> : undefined}
        renderItem={({ item: o }) => {
          const tone = SO_TONES[o.state];
          const when = o.soOrderDate === today ? hhmm(o.soOrderDatetime) : formatDay(o.soOrderDate, names).replace(/ \d{4}$/, '');
          return (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push({ pathname: '/orders/[soId]', params: { soId: o.soId } })}
              style={({ pressed }) => [st.row, o.state === 'sentBack' && { borderColor: '#FCA5A5' }, pressed && { backgroundColor: colors.bg }]}
            >
              <View style={{ flex: 1, gap: 3, minWidth: 0 }}>
                <Text style={st.rowName} numberOfLines={1}>
                  {o.soCustName}
                </Text>
                <Text style={st.small} numberOfLines={1}>
                  {[orderRef(o), when, t('so.nItems', { count: o.soTotItems })].join(' · ')}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 5 }}>
                <Text style={st.amount}>{formatAmount(toPaise(o.soOrderAmt) ?? 0)}</Text>
                <View style={[st.status, { backgroundColor: tone.bg }]}>
                  <Text style={[st.statusText, { color: tone.fg }]}>{t(`so.status.${o.state}`)}</Text>
                </View>
              </View>
            </Pressable>
          );
        }}
      />

      <DateRangeSheet
        visible={overlay === 'range'}
        value={choice}
        today={today}
        onPick={(key) => {
          setChoice({ key });
          setOverlay(null);
        }}
        onCustom={() => setOverlay('custom')}
        onClose={() => setOverlay(null)}
      />
      <CustomDatesDialog
        visible={overlay === 'custom'}
        initial={range}
        today={today}
        onCancel={() => setOverlay('range')}
        onSearch={(r) => {
          setChoice({ key: 'custom', range: r });
          setOverlay(null);
        }}
      />
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  headBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.md,
    marginHorizontal: spacing.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingVertical: 10,
    paddingLeft: spacing.md + 2,
    paddingRight: 10,
  },
  stripTitle: { fontSize: 14, fontWeight: '600', color: colors.text },
  small: { fontSize: 12.5, color: colors.textMuted },
  sendBtn: {
    minHeight: 44,
    minWidth: 104,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  sendText: { fontSize: 14, fontWeight: '600', color: colors.onPrimary },
  chips: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xs },
  chip: { minHeight: 36, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: font.sm, color: colors.textLabel },
  chipTextOn: { color: colors.onPrimary, fontWeight: '600' },
  list: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, gap: spacing.sm },
  empty: { textAlign: 'center', fontSize: font.md, color: colors.textMuted, padding: spacing.xl },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md + 2,
    paddingVertical: 10,
    paddingLeft: spacing.md + 2,
    paddingRight: 10,
  },
  rowName: { fontSize: font.md, fontWeight: '600', color: colors.text },
  amount: { fontSize: font.md, fontWeight: '600', color: colors.text },
  status: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 2 },
  statusText: { fontSize: 12, fontWeight: '600' },
});
