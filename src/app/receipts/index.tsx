import Ionicons from '@expo/vector-icons/Ionicons';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/screen-header';
import { useDateNames } from '@/components/use-date-names';
import { asOfText, hhmm } from '@/features/orders/order-status';
import { customerName, orderCustomerQuery } from '@/features/orders/queries';
import { collectionLinesQuery, lastReceiptSentQuery, myReceiptsQuery, pendingReceiptsCountQuery } from '@/features/receipts/queries';
import { amountPaise } from '@/features/receipts/receipt-math';
import { collectionTotals, RC_TONES, rcState } from '@/features/receipts/receipt-status';
import { useSendReceipts } from '@/features/receipts/use-send-receipts';
import { formatDay, rangeFor, type RangeKey } from '@/lib/date-range';
import { formatAmount, todayISO } from '@/lib/money';
import { colors, font, radius, spacing } from '@/theme';

const TABS: readonly RangeKey[] = ['today', 'yesterday', 'thisWeek'];
/** One shop's receipts: a shop is visited every week or so, so the tabs reach further back. */
const SHOP_TABS: readonly RangeKey[] = ['today', 'thisWeek', 'thisMonth'];

/**
 * My receipts (canvas 5b, step 8): this phone's receipts for a day or the week, with what the
 * salesman holds for the handover by mode (cash in hand, cheques, UPI), what waits to be sent
 * (Send now), and where each receipt stands: Waiting, Sent back, Posted or Cancelled (VK Nex's
 * states come at each Sync). Opened from Customer detail (Receipt list) with `customerId`: that
 * shop's receipts only.
 */
export default function MyReceiptsScreen() {
  const { customerId } = useLocalSearchParams<{ customerId?: string }>();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const names = useDateNames();
  const today = todayISO();
  const tabs = customerId ? SHOP_TABS : TABS;
  const [tab, setTab] = useState<RangeKey>(customerId ? 'thisMonth' : 'today');
  const range = rangeFor(tab, today);

  const { data: shop } = useLiveQuery(orderCustomerQuery(customerId ?? ''), [customerId]);
  const { data: rows, updatedAt } = useLiveQuery(myReceiptsQuery(range.from, range.to, customerId), [range.from, range.to, customerId]);
  const { data: lines } = useLiveQuery(collectionLinesQuery(range.from, range.to, customerId), [range.from, range.to, customerId]);
  const { data: waiting } = useLiveQuery(pendingReceiptsCountQuery());
  const { data: lastSent } = useLiveQuery(lastReceiptSentQuery());
  const { sending, result, send } = useSendReceipts();

  const list = useMemo(
    () => rows.map((r) => ({ ...r, state: rcState({ appPendingUpload: r.pending, appSyncError: r.syncError, avhVoucherStatus: r.status, appCancelledOn: r.cancelledOn }) })),
    [rows],
  );
  const modesOf = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const l of lines) m.set(l.receiptId, [...(m.get(l.receiptId) ?? []), l.name]);
    return m;
  }, [lines]);
  const totals = useMemo(
    () =>
      collectionTotals(
        list.filter((r) => r.state !== 'cancelled').map((r) => r.id),
        lines.map((l) => ({ receiptId: l.receiptId, typeId: l.typeId, amount: l.amount, surcharge: l.surcharge })),
      ),
    [list, lines],
  );
  const nWaiting = waiting[0]?.n ?? 0;
  const sentAt = lastSent[0]?.at ?? null;
  const asOf = sentAt ? asOfText(sentAt, names, t('so.today')) : null;

  return (
    <View style={st.root}>
      <ScreenHeader
        title={customerId ? t('receipt.shopReceipts') : t('receipt.myReceipts')}
        subtitle={customerId ? (shop[0] ? customerName(shop[0]) : undefined) : t('receipt.thisPhone')}
        backLabel={t('receipt.back')}
      />

      <View style={st.tabs} accessibilityRole="tablist">
        {tabs.map((k) => {
          const on = tab === k;
          return (
            <Pressable key={k} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => setTab(k)} style={[st.tab, on && st.tabOn]}>
              <Text style={[st.tabText, on && st.tabTextOn]}>{t(`dateRange.ranges.${k}`)}</Text>
            </Pressable>
          );
        })}
      </View>

      <FlatList
        data={list}
        keyExtractor={(r) => r.id}
        contentContainerStyle={[st.list, { paddingBottom: insets.bottom + spacing.lg }]}
        ListHeaderComponent={
          <View style={{ gap: spacing.sm, marginBottom: spacing.xs }}>
            <View style={st.card}>
              <View style={st.cardTop}>
                <Text style={st.cardTitle}>{t('receipt.collected', { range: t(`dateRange.ranges.${tab}`).toLocaleLowerCase(), count: totals.receipts })}</Text>
                <Text style={st.cardTotal}>{formatAmount(totals.totalPaise)}</Text>
              </View>
              <Mode label={t('receipt.cashInHand')} paise={totals.cashPaise} />
              <Mode label={t('receipt.cheques')} paise={totals.chequePaise} />
              <Mode label={t('receipt.upi')} paise={totals.upiPaise} />
              {totals.otherPaise > 0 ? <Mode label={t('receipt.otherModes')} paise={totals.otherPaise} /> : null}
            </View>
            <View style={st.strip}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={st.stripTitle}>{nWaiting > 0 ? t('receipt.nWaiting', { count: nWaiting }) : t('receipt.noneWaiting')}</Text>
                <Text style={[st.small, result && !result.ok && { color: colors.danger }]} accessibilityLiveRegion="polite">
                  {result ? result.text : asOf ? t('so.lastSent', { when: asOf }) : t('so.notSentYet')}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: sending || nWaiting === 0, busy: sending }}
                disabled={sending || nWaiting === 0}
                onPress={() => void send()}
                style={({ pressed }) => [st.sendBtn, nWaiting === 0 && { opacity: 0.5 }, pressed && { opacity: 0.85 }]}
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
          </View>
        }
        ListEmptyComponent={updatedAt ? <Text style={st.empty}>{t('receipt.noReceipts')}</Text> : undefined}
        ListFooterComponent={list.length ? <Text style={st.footNote}>{t('receipt.statesNote')}</Text> : undefined}
        renderItem={({ item: r }) => {
          const tone = RC_TONES[r.state];
          const when = r.date === today ? hhmm(r.createdOn) : `${formatDay(r.date, names).replace(/ \d{4}$/, '')}, ${hhmm(r.createdOn)}`;
          return (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push({ pathname: '/receipts/[id]', params: { id: r.id } })}
              style={({ pressed }) => [st.row, r.state === 'sentBack' && { borderColor: '#FCA5A5' }, pressed && { backgroundColor: colors.bg }]}
            >
              <View style={{ flex: 1, gap: 3, minWidth: 0 }}>
                <Text style={st.rowName} numberOfLines={1}>
                  {r.customerName}
                </Text>
                <Text style={st.small} numberOfLines={1}>
                  {[r.voucherRefno ?? r.refNo, when, (modesOf.get(r.id) ?? []).join(', ')].filter(Boolean).join(' · ')}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 5 }}>
                <Text style={[st.amount, r.state === 'cancelled' && st.struck]}>{formatAmount(amountPaise(r.amount))}</Text>
                <View style={[st.status, { backgroundColor: tone.bg }]}>
                  <Text style={[st.statusText, { color: tone.fg }]}>{t(`receipt.state.${r.state}`)}</Text>
                </View>
              </View>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

function Mode({ label, paise }: { label: string; paise: number }) {
  return (
    <View style={st.mode} accessible accessibilityLabel={`${label}: ${formatAmount(paise)}`}>
      <Text style={st.modeLabel}>{label}</Text>
      <Text style={st.modeValue}>{formatAmount(paise)}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  tabs: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  tab: { flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  tabOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabText: { fontSize: font.sm, color: colors.textLabel },
  tabTextOn: { color: colors.onPrimary, fontWeight: '600' },
  list: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.sm },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md + 2, gap: 6 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: spacing.sm, marginBottom: 2 },
  cardTitle: { fontSize: font.sm, fontWeight: '600', color: colors.text, flexShrink: 1 },
  cardTotal: { fontSize: font.lg, fontWeight: '700', color: colors.primary },
  mode: { flexDirection: 'row', justifyContent: 'space-between' },
  modeLabel: { fontSize: font.sm, color: colors.textLabel },
  modeValue: { fontSize: font.sm, fontWeight: '600', color: colors.text },
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
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
  sendBtn: { minHeight: 44, minWidth: 104, paddingHorizontal: spacing.lg, borderRadius: radius.md, backgroundColor: colors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  sendText: { fontSize: 14, fontWeight: '600', color: colors.onPrimary },
  empty: { textAlign: 'center', fontSize: font.md, color: colors.textMuted, padding: spacing.xl },
  footNote: { fontSize: 12, color: colors.textMuted, textAlign: 'center', paddingTop: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md + 2, paddingVertical: 10, paddingLeft: spacing.md + 2, paddingRight: 10 },
  rowName: { fontSize: font.md, fontWeight: '600', color: colors.text },
  amount: { fontSize: font.md, fontWeight: '600', color: colors.text },
  struck: { textDecorationLine: 'line-through', color: colors.textMuted },
  status: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 2 },
  statusText: { fontSize: 12, fontWeight: '600' },
});
