import Ionicons from '@expo/vector-icons/Ionicons';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/screen-header';
import { companiesQuery } from '@/features/company/company';
import { customerName, orderCustomerQuery } from '@/features/orders/queries';
import { NoCollectionButton } from '@/features/receipts/no-collection-button';
import { billsNow, openBillsQuery, unsentReceiptsQuery } from '@/features/receipts/queries';
import { formatAmount } from '@/lib/money';
import { colors, font, radius, spacing } from '@/theme';

/**
 * Receipt · choose company (the Qt app's ReceiptCompany.qml), opened by Receipt on Customer
 * detail when the phone has more than one company: VK Nex takes a receipt for one company, so
 * the salesman picks which one, seeing each company's open bills as of the last Sync.
 */
export default function ReceiptCompanyScreen() {
  const { customerId } = useLocalSearchParams<{ customerId: string }>();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { data: found } = useLiveQuery(orderCustomerQuery(customerId), [customerId]);
  const { data: list } = useLiveQuery(companiesQuery());
  const { data: bills } = useLiveQuery(openBillsQuery(customerId), [customerId]);
  const { data: unsent } = useLiveQuery(unsentReceiptsQuery(customerId), [customerId]);
  const c = found[0];

  const rows = useMemo(
    () =>
      list
        .map((co) => {
          // As the Receipt screen works them out, so the two always agree.
          const open = billsNow(bills, unsent, co.id).filter((b) => b.pendingPaise > 0);
          return { id: co.id, name: co.name, bills: open.length, pendingPaise: open.reduce((s, b) => s + b.pendingPaise, 0) };
        })
        // Companies with bills first, in the phone's company order.
        .sort((a, b) => Number(b.bills > 0) - Number(a.bills > 0)),
    [list, bills, unsent],
  );
  const totalPaise = rows.reduce((s, r) => s + r.pendingPaise, 0);
  const totalBills = rows.reduce((s, r) => s + r.bills, 0);

  return (
    <View style={st.root}>
      <ScreenHeader
        title={t('receipt.companyTitle')}
        subtitle={c ? customerName(c) : undefined}
        backLabel={t('receipt.back')}
        right={<NoCollectionButton customerId={customerId} />}
      />
      <ScrollView contentContainerStyle={[st.body, { paddingBottom: insets.bottom + spacing.xl }]}>
        <View style={st.cards}>
          <View style={st.card} accessible accessibilityLabel={`${t('receipt.totalBalance')}: ${formatAmount(totalPaise)}`}>
            <Text style={st.cardLabel}>{t('receipt.totalBalance')}</Text>
            <Text style={[st.cardValue, { color: colors.primary }]}>{formatAmount(totalPaise)}</Text>
          </View>
          <View style={st.card} accessible accessibilityLabel={`${t('receipt.totalBills')}: ${totalBills}`}>
            <Text style={st.cardLabel}>{t('receipt.totalBills')}</Text>
            <Text style={st.cardValue}>{totalBills}</Text>
          </View>
        </View>
        <Text style={st.heading} accessibilityRole="header">
          {t('receipt.pickCompany')}
        </Text>
        {rows.map((r) => (
          <Pressable
            key={r.id}
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/receipt/[customerId]', params: { customerId, companyId: r.id } })}
            style={({ pressed }) => [st.row, pressed && { opacity: 0.85 }]}
          >
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={st.rowName}>{r.name}</Text>
              <Text style={st.rowNote}>{r.bills > 0 ? t('receipt.pendingBills', { n: r.bills }) : t('receipt.noBills')}</Text>
            </View>
            <Text style={st.rowAmount}>{formatAmount(r.pendingPaise)}</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { padding: spacing.lg, gap: 10 },
  cards: { flexDirection: 'row', gap: 10 },
  card: { flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md + 2, gap: 2 },
  cardLabel: { fontSize: 12, color: colors.textMuted },
  cardValue: { fontSize: 20, fontWeight: '700', color: colors.text },
  heading: { marginTop: spacing.sm, fontSize: font.md, fontWeight: '600', color: colors.text },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 68,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md + 2,
    paddingVertical: 10,
    paddingLeft: spacing.md + 2,
    paddingRight: spacing.md,
  },
  rowName: { fontSize: font.md, fontWeight: '600', color: colors.text },
  rowNote: { fontSize: font.sm, color: colors.textMuted },
  rowAmount: { fontSize: font.md, fontWeight: '600', color: colors.text },
});
