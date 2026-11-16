import Ionicons from '@expo/vector-icons/Ionicons';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/screen-header';
import { companiesQuery } from '@/features/company/company';
import { currentBalance } from '@/features/ledger/ledger';
import { ledgerYearsQuery } from '@/features/ledger/queries';
import { customerName, orderCustomerQuery } from '@/features/orders/queries';
import { formatAmount } from '@/lib/money';
import { colors, font, radius, spacing } from '@/theme';

/**
 * Order · choose company (the Qt app's OrderCompany.qml), shown when the phone has more than one
 * company: the shop's balance, then the companies to order for. The balance is the one Sync
 * brought (VK Nex's ledger for the sign-in company); VK Nex sends no balance per company yet.
 */
export default function OrderCompanyScreen() {
  const { customerId } = useLocalSearchParams<{ customerId: string }>();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { data: found } = useLiveQuery(orderCustomerQuery(customerId), [customerId]);
  const { data: years } = useLiveQuery(ledgerYearsQuery(customerId), [customerId]);
  const { data: list } = useLiveQuery(companiesQuery());
  const c = found[0];
  const balance = currentBalance(years);

  return (
    <View style={st.root}>
      <ScreenHeader title={t('order.companyTitle')} subtitle={c ? customerName(c) : undefined} backLabel={t('customerDetail.back')} />
      <ScrollView contentContainerStyle={[st.body, { paddingBottom: insets.bottom + spacing.xl }]}>
        <View style={st.tile} accessible accessibilityLabel={`${t('order.totalBalance')}: ${balance === null ? t('order.noLedger') : formatAmount(balance)}`}>
          <Text style={st.tileLabel}>{t('order.totalBalance')}</Text>
          <Text style={st.tileValue}>{balance === null ? '—' : formatAmount(balance)}</Text>
          <Text style={st.tileNote}>{balance === null ? t('order.noLedger') : t('order.balanceNote')}</Text>
        </View>

        <Text style={st.heading} accessibilityRole="header">
          {t('order.pickCompany')}
        </Text>
        {list.length === 0 ? <Text style={st.note}>{t('order.noCompaniesText')}</Text> : null}
        {list.map((co) => (
          <Pressable
            key={co.id}
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/order/[customerId]', params: { customerId, companyId: co.id } })}
            style={({ pressed }) => [st.row, pressed && { backgroundColor: colors.bg }]}
          >
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={st.rowName}>{co.name}</Text>
              {co.place ? <Text style={st.rowDetail}>{co.place}</Text> : null}
            </View>
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
  tile: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md + 2, gap: 2 },
  tileLabel: { fontSize: 12, color: colors.textMuted },
  tileValue: { fontSize: 20, fontWeight: '700', color: colors.primary },
  tileNote: { fontSize: 12, color: colors.textMuted },
  heading: { marginTop: spacing.sm, fontSize: font.md, fontWeight: '600', color: colors.text },
  note: { fontSize: font.sm, color: colors.textMuted },
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
  rowDetail: { fontSize: font.sm, color: colors.textMuted },
});
