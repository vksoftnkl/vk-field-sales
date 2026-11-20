import Ionicons from '@expo/vector-icons/Ionicons';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/screen-header';
import { useDateNames } from '@/components/use-date-names';
import { num, qtyText } from '@/features/orders/order-math';
import { asOfText, hhmm } from '@/features/orders/order-status';
import { customerName, orderCustomerQuery } from '@/features/orders/queries';
import { useSendReturns } from '@/features/returns/return-parts';
import { noteOf } from '@/features/returns/return-slip';
import { returnStyles, STATUS_TONES } from '@/features/returns/return-styles';
import { lastReturnSentQuery, pendingReturnsCountQuery, phoneReturnsQuery, returnQtyByConditionQuery, vanGoodsQuery } from '@/features/returns/queries';
import { formatDay, rangeFor, type RangeKey } from '@/lib/date-range';
import { formatAmount, todayISO } from '@/lib/money';
import { colors, font, radius, spacing } from '@/theme';

const TABS: readonly RangeKey[] = ['today', 'thisWeek', 'thisMonth'];

/**
 * Return list, step 8 (canvas 6b; replaces the old Return list report): a shop's returns on this
 * phone (opened from Customer detail), Today / This week / This month, each with where it stands —
 * Waiting to send, With the office, Sent back, Posted, Cancelled — from VK Nex at each Sync, and the
 * goods still in the van, good apart from the rest. Send now sends what is waiting.
 */
export default function ReturnListScreen() {
  const { customerId } = useLocalSearchParams<{ customerId?: string }>();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const names = useDateNames();
  const today = todayISO();
  const [tab, setTab] = useState<RangeKey>('thisMonth');
  const range = rangeFor(tab, today);
  const cust = customerId ?? null;

  const { data: shop } = useLiveQuery(orderCustomerQuery(customerId ?? ''), [customerId]);
  const { data: rows, updatedAt } = useLiveQuery(phoneReturnsQuery(cust, range.from, range.to), [cust, range.from, range.to]);
  const ids = rows.map((r) => r.srId);
  const { data: qtys } = useLiveQuery(returnQtyByConditionQuery(ids), [ids.join(',')]);
  const { data: van } = useLiveQuery(vanGoodsQuery(cust), [cust]);
  const { data: waiting } = useLiveQuery(pendingReturnsCountQuery());
  const { data: lastSent } = useLiveQuery(lastReturnSentQuery());
  const { sending, result, send } = useSendReturns();

  const qtyOf = useMemo(() => {
    const m = new Map<string, { good: number; other: number }>();
    for (const q of qtys) {
      const v = m.get(q.id) ?? { good: 0, other: 0 };
      if (q.condition === 'RESTOCK') v.good += num(q.qty);
      else v.other += num(q.qty);
      m.set(q.id, v);
    }
    return m;
  }, [qtys]);
  const vanGood = van.filter((v) => v.condition === 'RESTOCK').reduce((s, v) => s + num(v.qty), 0);
  const vanOther = van.filter((v) => v.condition !== 'RESTOCK').reduce((s, v) => s + num(v.qty), 0);
  const nWaiting = waiting[0]?.n ?? 0;
  const sentAt = lastSent[0]?.at ?? null;

  return (
    <View style={st.root}>
      <ScreenHeader title={t('sr.list.title')} subtitle={customerId ? (shop[0] ? customerName(shop[0]) : undefined) : t('sr.list.allShops')} backLabel={t('sr.back')} />
      <View style={st.tabs} accessibilityRole="tablist">
        {TABS.map((k) => {
          const on = tab === k;
          return (
            <Pressable key={k} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => setTab(k)} style={[st.tab, on && st.tabOn]}>
              <Text style={[st.tabText, on && st.tabTextOn]}>{t(`dateRange.ranges.${k}`)}</Text>
            </Pressable>
          );
        })}
      </View>
      <FlatList
        data={rows}
        keyExtractor={(r) => r.srId}
        contentContainerStyle={[st.list, { paddingBottom: insets.bottom + spacing.lg }]}
        ListHeaderComponent={
          <View style={st.strip}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={st.stripTitle}>{nWaiting > 0 ? t('sr.list.nWaiting', { count: nWaiting }) : t('sr.list.noneWaiting')}</Text>
              <Text style={[st.small, result && !result.ok && { color: colors.danger }]} accessibilityLiveRegion="polite">
                {result ? result.text : sentAt ? t('so.lastSent', { when: asOfText(sentAt, names, t('so.today')) }) : t('so.notSentYet')}
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
        }
        ListEmptyComponent={updatedAt ? <Text style={st.empty}>{t('sr.list.none')}</Text> : undefined}
        ListFooterComponent={
          van.length ? (
            <View style={st.van}>
              <Text style={st.vanTitle}>{t('sr.list.vanTitle')}</Text>
              <View style={st.between}>
                <Text style={st.vanText}>{t('sr.list.vanGood')}</Text>
                <Text style={st.vanQty}>{qtyText(vanGood)}</Text>
              </View>
              <View style={st.between}>
                <Text style={st.vanText}>{t('sr.list.vanOther')}</Text>
                <Text style={st.vanQty}>{qtyText(vanOther)}</Text>
              </View>
            </View>
          ) : undefined
        }
        renderItem={({ item: r }) => {
          const tone = STATUS_TONES[r.appStatus] ?? STATUS_TONES.WAITING!;
          const q = qtyOf.get(r.srId) ?? { good: 0, other: 0 };
          const when = r.srReturnDate === today ? hhmm(r.srReturnDatetime) : formatDay(r.srReturnDate, names).replace(/ \d{4}$/, '');
          const note = noteOf(r.appVkNote);
          const amount = r.appVkAmt ?? r.srReturnAmt;
          const statusText =
            r.appStatus === 'HELD' && note?.code
              ? `${t('sr.status.HELD')} · ${note.code}`
              : r.appStatus === 'POSTED' && r.srSettleMode === 'ADJUST'
                ? t('sr.list.postedAdjusted')
                : t(`sr.status.${r.appStatus}`);
          return (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push({ pathname: '/returns/[id]', params: { id: r.srId } })}
              style={({ pressed }) => [st.row, tone.border ? { borderColor: tone.border } : null, pressed && { backgroundColor: colors.bg }]}
            >
              <View style={st.between}>
                <Text style={[st.rowNo, r.appStatus === 'CANCELLED' && st.struck]} numberOfLines={1}>
                  {r.appVkRefno ?? r.srReturnRefno}
                </Text>
                <Text style={[st.rowNo, r.appStatus === 'CANCELLED' && st.struck]}>{formatAmount(Math.round(num(amount) * 100))}</Text>
              </View>
              <Text style={st.small} numberOfLines={1}>
                {[customerId ? null : r.srCustName, when, r.appBillRefno ?? t('sr.items.noBill'), t('sr.list.qty', { good: qtyText(q.good), other: qtyText(q.other) })].filter(Boolean).join(' · ')}
              </Text>
              <Text style={[st.status, { backgroundColor: tone.bg, color: tone.fg }]}>{statusText}</Text>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const st = StyleSheet.create({
  ...returnStyles,
  tabs: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  tab: { flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  tabOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabText: { fontSize: font.sm, color: colors.textLabel },
  tabTextOn: { color: colors.onPrimary, fontWeight: '600' },
  list: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.sm },
  strip: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, paddingVertical: 10, paddingLeft: spacing.md + 2, paddingRight: 10, marginBottom: spacing.xs },
  stripTitle: { fontSize: 14, fontWeight: '600', color: colors.text },
  sendBtn: { minHeight: 44, minWidth: 104, paddingHorizontal: spacing.lg, borderRadius: radius.md, backgroundColor: colors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  sendText: { fontSize: 14, fontWeight: '600', color: colors.onPrimary },
  empty: { textAlign: 'center', fontSize: font.md, color: colors.textMuted, padding: spacing.xl },
  row: { gap: 5, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md + 2, paddingVertical: 10, paddingHorizontal: spacing.md + 2 },
  rowNo: { fontSize: font.md, fontWeight: '600', color: colors.text, flexShrink: 1 },
  struck: { textDecorationLine: 'line-through', color: colors.textMuted },
  status: { alignSelf: 'flex-start', fontSize: 12, fontWeight: '600', paddingHorizontal: 8, paddingVertical: 1, borderRadius: 6, overflow: 'hidden' },
  van: { gap: 6, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md + 2, marginTop: spacing.xs },
  vanTitle: { fontSize: 14, fontWeight: '600', color: colors.text },
  vanText: { fontSize: 13.5, color: colors.textLabel },
  vanQty: { fontSize: 13.5, fontWeight: '600', color: colors.text },
});
