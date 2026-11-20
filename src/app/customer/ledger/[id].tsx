import Ionicons from '@expo/vector-icons/Ionicons';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { router, useLocalSearchParams } from 'expo-router';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useDateNames } from '@/components/use-date-names';
import { customerDetailQuery } from '@/features/customers/queries';
import { CustomDatesDialog } from '@/features/ledger/custom-dates-dialog';
import { choiceRange, DateRangeSheet, type RangeChoice } from '@/features/ledger/date-range-sheet';
import { netPaise, statement, type LedgerRow } from '@/features/ledger/ledger';
import { ledgerRowsQuery, ledgerYearsQuery } from '@/features/ledger/queries';
import { openReceipt } from '@/features/receipts/open-receipt';
import { openItemsQuery } from '@/features/receipts/queries';
import { itemKey } from '@/features/receipts/receipt-plan';
import { DEFAULT_RANGE, formatDay, formatRangeLong, type DateNames } from '@/lib/date-range';
import { formatAmount, todayISO } from '@/lib/money';
import { colors, font, radius, spacing } from '@/theme';

const PLUS = '#166534';

/**
 * Ledger statement (the Qt app's CustomerLedgerStatement.qml), from the copy Sync brought:
 * opening balance, every voucher in the chosen dates with VK Nex's running balance, closing
 * balance. Opens on this week. Works with no network.
 */
export default function LedgerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const names = useDateNames();
  const today = todayISO();

  const [choice, setChoice] = useState<RangeChoice>({ key: DEFAULT_RANGE });
  const [overlay, setOverlay] = useState<'range' | 'custom' | null>(null);
  const range = choiceRange(choice, today);

  const { data: found } = useLiveQuery(customerDetailQuery(id), [id]);
  const { data: years, updatedAt } = useLiveQuery(ledgerYearsQuery(id), [id]);
  const { data: rows } = useLiveQuery(ledgerRowsQuery(id), [id]);
  const s = useMemo(() => statement(years, rows as LedgerRow[], range), [years, rows, range.from, range.to]); // eslint-disable-line react-hooks/exhaustive-deps

  // A bill still open on the phone offers Collect (canvas 5b, step 1): Receipt for its company,
  // with that bill's adjustment open. Matched by its number; a number open in two companies gets
  // no link.
  const { data: openItems } = useLiveQuery(openItemsQuery(id), [id]);
  const openByNo = useMemo(() => {
    const m = new Map<string, OpenBill | null>();
    for (const b of openItems) {
      if (b.kind !== 'BILL' || b.pendingPaise <= 0) continue;
      m.set(b.docRefno, m.has(b.docRefno) ? null : { companyId: b.companyId, key: itemKey(b), pendingPaise: b.pendingPaise });
    }
    return m;
  }, [openItems]);
  const collect = (b: OpenBill) => openReceipt(t, id, b.companyId, b.key);

  const c = found[0];
  const name = c ? (c.cusName ?? c.cusShort ?? c.cusCode ?? '') : '';
  const syncedOn = years.reduce<string | null>((latest, y) => (latest && latest > y.syncedOn ? latest : y.syncedOn), null);
  const label = choice.key === 'custom' ? t('dateRange.customLabel') : t(`dateRange.ranges.${choice.key}`);
  const dates = formatRangeLong(range, names);

  let message: string | null = null;
  if (updatedAt && !s.ok) {
    message = s.reason === 'noLedger' ? t('ledger.noLedger') : t('ledger.notOnPhone', { years: s.years.join(', ') });
  }

  return (
    <View style={st.root}>
      <View style={[st.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('ledger.back')} onPress={() => router.back()} style={st.back}>
          <Ionicons name="chevron-back" size={24} color={colors.onPrimary} />
        </Pressable>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={st.title} accessibilityRole="header">
            {t('ledger.title')}
          </Text>
          <Text style={st.subtitle} numberOfLines={1}>
            {syncedOn ? t('ledger.asOfSync', { name, date: formatDay(syncedOn.slice(0, 10), names) }) : name}
          </Text>
        </View>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('ledger.rangeButton', { label, dates })}
        onPress={() => setOverlay('range')}
        style={({ pressed }) => [st.rangeBtn, pressed && { opacity: 0.85 }]}
      >
        <Ionicons name="calendar-outline" size={20} color={colors.primary} />
        <View style={{ flex: 1 }}>
          <Text style={st.rangeLabel}>{label}</Text>
          <Text style={st.rangeDates}>{dates}</Text>
        </View>
        <Text style={st.change}>{t('ledger.change')}</Text>
      </Pressable>

      {message ? (
        <Text style={st.message}>{message}</Text>
      ) : s.ok ? (
        <>
          <FlatList
            data={s.rows}
            keyExtractor={(r) => r.voucherId}
            contentContainerStyle={st.list}
            ItemSeparatorComponent={Gap}
            ListHeaderComponent={
              <View style={st.opening}>
                <Text style={st.openingLabel}>{t('ledger.opening', { date: formatDay(range.from, names) })}</Text>
                <Text style={st.openingAmount}>{formatAmount(s.openingPaise)}</Text>
              </View>
            }
            ListEmptyComponent={<Text style={st.noRows}>{t('ledger.noRows')}</Text>}
            ListFooterComponent={s.to < range.to ? <Text style={st.cut}>{t('ledger.cutAt', { date: formatDay(s.to, names) })}</Text> : undefined}
            renderItem={({ item }) => <Entry r={item} names={names} open={item.voucherNo ? (openByNo.get(item.voucherNo) ?? undefined) : undefined} onCollect={collect} />}
          />
          <View style={[st.closing, { paddingBottom: insets.bottom + spacing.lg }]} accessible accessibilityLabel={`${t('ledger.closing')}: ${formatAmount(s.closingPaise)}`}>
            <Text style={st.closingLabel}>{t('ledger.closing')}</Text>
            <Text style={st.closingAmount}>{formatAmount(s.closingPaise)}</Text>
          </View>
        </>
      ) : null}

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

function Gap() {
  return <View style={{ height: spacing.sm }} />;
}

interface OpenBill {
  companyId: string;
  key: string;
  pendingPaise: number;
}

/**
 * One voucher: reference and amount (+ raises what the customer owes), date | type, balance after
 * it, details; a bill still open on the phone also shows what is pending and Collect.
 */
const Entry = memo(function Entry({ r, names, open, onCollect }: { r: LedgerRow; names: DateNames; open?: OpenBill; onCollect: (b: OpenBill) => void }) {
  const { t } = useTranslation();
  const net = netPaise(r);
  const amount = `${net > 0 ? '+' : net < 0 ? '−' : ''}${formatAmount(Math.abs(net))}`;
  const ref = r.voucherNo ?? r.voucherTypeName ?? '';
  const details = [r.particulars, r.narration, ...r.billRefs].filter((x): x is string => !!x && x.trim() !== '');
  const kind = r.rowKind === 'CANCELLED' ? t('ledger.cancelled') : r.rowKind === 'REVERSAL' ? t('ledger.reversal') : null;
  const dateType = [formatDay(r.date, names), r.voucherTypeName].filter(Boolean).join(' | ');
  const bal = t('ledger.bal', { amount: formatAmount(r.balancePaise) });
  const pending = open ? t('ledger.pendingNow', { amount: formatAmount(open.pendingPaise) }) : '';
  return (
    <View style={st.entry}>
      <View style={st.entryBody} accessible accessibilityLabel={[ref, amount, dateType, bal, kind, ...details].filter(Boolean).join(', ')}>
        <View style={st.entryTop}>
          <Text style={st.entryRef} numberOfLines={1}>
            {ref}
          </Text>
          <Text style={[st.entryAmount, { color: net > 0 ? PLUS : net < 0 ? colors.danger : colors.text }]}>{amount}</Text>
        </View>
        <View style={st.entryMid}>
          <Text style={st.entryMeta} numberOfLines={1}>
            {dateType}
          </Text>
          <Text style={st.entryMeta}>{bal}</Text>
        </View>
        {kind || details.length ? (
          <Text style={st.entryNote} numberOfLines={2}>
            {kind ? `${kind} · ` : ''}
            {details.length ? `(${details.join(' | ')})` : ''}
          </Text>
        ) : null}
      </View>
      {open ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`${pending}, ${t('ledger.collect')}`} onPress={() => onCollect(open)} style={({ pressed }) => [st.collect, pressed && { opacity: 0.85 }]}>
          <Text style={st.collectPending}>{pending}</Text>
          <Text style={st.collectText}>{t('ledger.collect')}</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.primary} />
        </Pressable>
      ) : null}
    </View>
  );
});

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: colors.primary, paddingLeft: spacing.sm, paddingRight: spacing.md, paddingBottom: spacing.md + 2 },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 19, fontWeight: '600', color: colors.onPrimary },
  subtitle: { marginTop: 2, fontSize: font.sm, color: colors.onPrimaryMuted },
  rangeBtn: {
    marginTop: spacing.md + 2,
    marginHorizontal: spacing.lg,
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg - 2,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.sm,
  },
  rangeLabel: { fontSize: 12, color: colors.textMuted },
  rangeDates: { fontSize: font.md, fontWeight: '600', color: colors.text },
  change: { fontSize: 14, fontWeight: '600', color: colors.primary },
  message: { textAlign: 'center', fontSize: font.md, color: colors.textMuted, padding: spacing.xxl, lineHeight: 22 },
  list: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  opening: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm, paddingHorizontal: spacing.md + 2, paddingVertical: spacing.sm + 2, backgroundColor: '#EEECE9', borderRadius: radius.lg - 2, marginBottom: spacing.sm },
  openingLabel: { flex: 1, fontSize: 14, fontWeight: '500', color: colors.text },
  openingAmount: { fontSize: 14, fontWeight: '600', color: colors.text },
  noRows: { textAlign: 'center', fontSize: font.sm, color: colors.textMuted, paddingVertical: spacing.xl },
  cut: { textAlign: 'center', fontSize: 12, color: colors.textMuted, paddingTop: spacing.md },
  entry: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg - 2, paddingHorizontal: spacing.md + 2, paddingVertical: spacing.md, gap: spacing.xs },
  entryTop: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  entryRef: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.text },
  entryAmount: { fontSize: font.md, fontWeight: '700' },
  entryMid: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  entryMeta: { fontSize: font.sm, color: colors.textMuted, flexShrink: 1 },
  entryNote: { fontSize: 12, color: colors.textMuted },
  entryBody: { gap: spacing.xs },
  collect: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: 40, borderTopWidth: 1, borderTopColor: '#F1EDE4', paddingTop: spacing.xs },
  collectPending: { flex: 1, fontSize: 12.5, color: '#92400E' },
  collectText: { fontSize: 14, fontWeight: '600', color: colors.primary },
  closing: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingTop: spacing.lg, paddingHorizontal: spacing.xl - 4, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
  closingLabel: { fontSize: font.md, fontWeight: '600', color: colors.text },
  closingAmount: { fontSize: 22, fontWeight: '700', color: colors.primary },
});
