import Ionicons from '@expo/vector-icons/Ionicons';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, type ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useDateNames } from '@/components/use-date-names';
import { getMeta } from '@/db/meta';
import { addressLine } from '@/features/customers/customer-list';
import { ensureCurrentCompany } from '@/features/company/company';
import { sideOf } from '@/features/customers/customer-figures';
import { customerDetailQuery, customerFiguresQuery } from '@/features/customers/queries';
import { usePhoneChanges } from '@/features/customers/use-phone-changes';
import { currentBalance, recentBills, type LedgerRow } from '@/features/ledger/ledger';
import { openReceipt } from '@/features/receipts/open-receipt';
import { ledgerRowsQuery, ledgerYearsQuery } from '@/features/ledger/queries';
import { formatDay } from '@/lib/date-range';
import { formatAmount } from '@/lib/money';
import { colors, font, radius, spacing } from '@/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

/**
 * Customer detail (the Qt app's Option.qml), opened from a shop on the customer list: who the
 * customer is, what they owe as of the last Sync, the actions, and their recent bills.
 */
export default function CustomerDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const names = useDateNames();

  const { data: found, updatedAt } = useLiveQuery(customerDetailQuery(id), [id]);
  const { data: years } = useLiveQuery(ledgerYearsQuery(id), [id]);
  const { data: rows } = useLiveQuery(ledgerRowsQuery(id), [id]);
  const c = found[0];
  const bills = useMemo(() => recentBills(rows as LedgerRow[], years), [rows, years]);
  // From ledger_years' own live query: the detail query's balance would not re-read after a Sync.
  const balance = currentBalance(years);
  const hasLedger = balance !== null;
  const syncedOn = years.reduce<string | null>((latest, y) => (latest && latest > y.syncedOn ? latest : y.syncedOn), null);
  // Balance and outstanding as the Customer list shows them: VK Nex's at Sync plus this phone's since.
  const { data: figRows } = useLiveQuery(customerFiguresQuery(id), [id]);
  const { shown: figuresOf, syncedOn: figuresSyncedOn } = usePhoneChanges();
  const synced = figRows[0];

  const call = (n: string | null | undefined) => {
    if (n) void Linking.openURL(`tel:${n}`);
  };
  /**
   * Order and Check in both open the Visit (canvas 3b): it checks the salesman in, then offers
   * Take order or No order, with the company choice there when there are several.
   */
  const startVisit = () => router.push({ pathname: '/order/visit/[customerId]', params: { customerId: id } });
  /** Receipt: for the company picked in Switch company, as bills are. */
  const startReceipt = () => openReceipt(t, id);
  /** Sales: bills are made for the company picked on the phone (Choose company), as in the Qt app. */
  const startSale = () => {
    ensureCurrentCompany();
    const companyId = getMeta('companyId');
    if (!companyId) return Alert.alert(t('order.noCompaniesTitle'), t('order.noCompaniesText'));
    router.push({ pathname: '/sales/[customerId]', params: { customerId: id, companyId } });
  };
  /** Return: a credit note for the company picked on the phone, as bills are. */
  const startReturn = () => {
    ensureCurrentCompany();
    const companyId = getMeta('companyId');
    if (!companyId) return Alert.alert(t('order.noCompaniesTitle'), t('order.noCompaniesText'));
    router.push({ pathname: '/sales-return/[customerId]', params: { customerId: id, companyId } });
  };

  const header = (
    <View style={[st.header, { paddingTop: insets.top + spacing.sm }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('customerDetail.back')} onPress={() => router.back()} style={st.iconBtn}>
        <Ionicons name="chevron-back" size={24} color={colors.onPrimary} />
      </Pressable>
      <Text style={st.title} accessibilityRole="header" numberOfLines={1}>
        {t('customerDetail.title')}
      </Text>
      {c ? (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('customerDetail.edit')}
            onPress={() => router.push({ pathname: '/customer/edit/[id]', params: { id } })}
            style={st.iconBtn}
          >
            <Ionicons name="create-outline" size={22} color={colors.onPrimary} />
          </Pressable>
          <CallButton n={1} label={t('customerDetail.call1')} number={c.cusPhone1} onPress={() => call(c.cusPhone1)} />
          <CallButton n={2} label={t('customerDetail.call2')} number={c.cusPhone2} onPress={() => call(c.cusPhone2)} />
        </>
      ) : null}
    </View>
  );

  if (!c) {
    return (
      <View style={st.root}>
        {header}
        {updatedAt ? <Text style={st.empty}>{t('customerDetail.notFound')}</Text> : null}
      </View>
    );
  }

  const name = c.cusName ?? c.cusShort ?? c.cusCode ?? '';
  const fig = figuresOf({
    cusId: id,
    newOnPhone: c.appPendingUpload,
    synced: synced ? { balancePaise: synced.balancePaise, outstandingPaise: synced.outstandingPaise, billCount: synced.billCount, oldestBillDate: synced.oldestBillDate } : null,
  });
  // Without Sync figures (an older VK Nex), the ledger's closing as before.
  const owes = fig.balancePaise ?? balance ?? c.outstandingPaise;
  const owesSide = sideOf(owes).side;
  const owesText = `${formatAmount(Math.abs(owes))}${owesSide ? ` ${t(`customers.${owesSide === 'Dr' ? 'dr' : 'cr'}`)}` : ''}`;
  const dueText = fig.outstandingPaise === null ? '—' : formatAmount(fig.outstandingPaise);
  const figuresNote = figuresSyncedOn && synced
    ? t('customerDetail.asOfSync', { date: formatDay(figuresSyncedOn.slice(0, 10), names) })
    : hasLedger && syncedOn
      ? t('customerDetail.asOfSync', { date: formatDay(syncedOn.slice(0, 10), names) })
      : t('customerDetail.noLedgerYet');
  const address = addressLine(c);
  const mobiles = [
    c.cusPhone1 ? `${t('customerDetail.mobile1')} ${c.cusPhone1}` : null,
    c.cusPhone2 ? `${t('customerDetail.mobile2')} ${c.cusPhone2}` : null,
  ].filter(Boolean);
  const yesNo = (v: boolean) => (v ? t('customerDetail.yes') : t('customerDetail.no'));
  const facts: [string, string][] = [
    [t('customerDetail.type'), c.typeName ?? '—'],
    [t('customerDetail.price'), c.priceLevelName ?? '—'],
    [t('customerDetail.freight'), yesNo(c.cusFreightCharge)],
    [t('customerDetail.cooly'), yesNo(c.cusLoadingCharge)],
  ];

  const actions: { key: string; label: string; icon: IconName; primary?: boolean; onPress: () => void }[] = [
    { key: 'order', label: t('customerDetail.order'), icon: 'clipboard-outline', onPress: startVisit },
    { key: 'sales', label: t('customerDetail.sales'), icon: 'cart-outline', primary: true, onPress: startSale },
    { key: 'checkIn', label: t('customerDetail.checkIn'), icon: 'location-outline', onPress: startVisit },
    // Shown to every login: one without the Post right on Receipt (menu 99) is warned on Dues.
    { key: 'receipt', label: t('customerDetail.receipt'), icon: 'receipt-outline', onPress: startReceipt },
    { key: 'return', label: t('customerDetail.return'), icon: 'return-up-back-outline', onPress: startReturn },
    {
      key: 'ledger',
      label: t('customerDetail.ledger'),
      icon: 'document-text-outline',
      onPress: () => router.push({ pathname: '/customer/ledger/[id]', params: { id } }),
    },
    // This shop's receipts on this phone: waiting, sent back, posted (canvas 5b, step 8).
    { key: 'receipts', label: t('customerDetail.receiptList'), icon: 'list-outline', onPress: () => router.push({ pathname: '/receipts', params: { customerId: id } }) },
    // This shop's returns on this phone: waiting, with the office, sent back, posted (canvas 6b, step 8).
    { key: 'returns', label: t('customerDetail.returnList'), icon: 'file-tray-stacked-outline', onPress: () => router.push({ pathname: '/returns', params: { customerId: id } }) },
  ];

  return (
    <View style={st.root}>
      {header}
      <ScrollView contentContainerStyle={[st.body, { paddingBottom: insets.bottom + spacing.xl }]}>
        <View style={st.card}>
          <View style={{ gap: spacing.xs }}>
            <Text style={st.name}>{name}</Text>
            {address ? <Text style={st.muted}>{address}</Text> : null}
            {mobiles.length ? <Text style={st.muted}>{mobiles.join(' · ')}</Text> : null}
          </View>
          <View style={st.facts}>
            {facts.map(([label, value]) => (
              <View key={label} style={st.fact} accessible accessibilityLabel={`${label}: ${value}`}>
                <Text style={st.factLabel}>{label}</Text>
                <Text style={st.factValue} numberOfLines={2}>
                  {value}
                </Text>
              </View>
            ))}
          </View>
          <View
            style={st.owes}
            accessible
            accessibilityLabel={`${t('customerDetail.balance')}: ${owesText}. ${t('customerDetail.outstanding')}: ${dueText}. ${figuresNote}`}
          >
            <View style={st.owesRow}>
              <Text style={st.owesLabel}>{t('customerDetail.balance')}</Text>
              <Text style={[st.owesAmount, owesSide === 'Cr' && { color: colors.success }]}>{owesText}</Text>
            </View>
            <View style={st.owesRow}>
              <Text style={st.owesLabel}>{t('customerDetail.outstanding')}</Text>
              <Text style={st.dueAmount}>{dueText}</Text>
            </View>
            <Text style={st.owesNote}>{fig.changedOnPhone ? `${figuresNote} ${t('customerDetail.changedOnPhone')}` : figuresNote}</Text>
          </View>
        </View>

        {c.appSyncError ? (
          <Banner tone="danger" icon="alert-circle-outline" text={t('customerDetail.refused', { error: c.appSyncError })} />
        ) : c.appPendingUpload || c.appPendingUpdate ? (
          <Banner
            tone="info"
            icon="cloud-upload-outline"
            text={c.appPendingUpload ? t('customerDetail.waitingNew') : t('customerDetail.waitingEdit')}
          />
        ) : null}

        <View style={st.actions} accessibilityLabel={t('customerDetail.actions')}>
          {actions.map((a) => (
            <Pressable
              key={a.key}
              accessibilityRole="button"
              onPress={a.onPress}
              style={({ pressed }) => [st.action, a.primary && st.actionPrimary, pressed && { opacity: 0.85 }]}
            >
              <Ionicons name={a.icon} size={24} color={a.primary ? colors.onPrimary : colors.primary} />
              <Text style={[st.actionText, a.primary && st.actionTextPrimary]}>{a.label}</Text>
            </Pressable>
          ))}
        </View>

        <View style={st.bills}>
          <Text style={st.billsTitle} accessibilityRole="header">
            {t('customerDetail.recentBills')}
          </Text>
          <View style={[st.billRow, st.billHead]} importantForAccessibility="no-hide-descendants">
            <Text style={[st.billCell, st.billHeadText]}>{t('customerDetail.date')}</Text>
            <Text style={[st.billCell, st.billHeadText, { textAlign: 'center' }]}>{t('customerDetail.billNo')}</Text>
            <Text style={[st.billCell, st.billHeadText, { textAlign: 'right' }]}>{t('customerDetail.amount')}</Text>
          </View>
          {bills.length === 0 ? (
            <Text style={st.billsEmpty}>{hasLedger ? t('customerDetail.noBills') : t('customerDetail.noLedgerYet')}</Text>
          ) : (
            bills.map((b) => {
              const date = formatDay(b.date, names);
              const amount = formatAmount(b.debitPaise);
              return (
                <View key={b.voucherId} style={st.billRow} accessible accessibilityLabel={`${date}, ${b.voucherNo ?? ''}, ${amount}`}>
                  <Text style={st.billCell}>{date}</Text>
                  <Text style={[st.billCell, { textAlign: 'center' }]} numberOfLines={1}>
                    {b.voucherNo ?? '—'}
                  </Text>
                  <Text style={[st.billCell, { textAlign: 'right', fontWeight: '600' }]}>{amount}</Text>
                </View>
              );
            })
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function CallButton({ n, label, number, onPress }: { n: number; label: string; number: string | null; onPress: () => void }) {
  const off = !number;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={number ? `${label}, ${number}` : label}
      accessibilityState={{ disabled: off }}
      disabled={off}
      onPress={onPress}
      style={[st.iconBtn, off && { opacity: 0.4 }]}
    >
      <Ionicons name="call-outline" size={20} color={colors.onPrimary} />
      <Text style={st.callNo}>{n}</Text>
    </Pressable>
  );
}

function Banner({ tone, icon, text }: { tone: 'info' | 'danger'; icon: IconName; text: string }) {
  const c = tone === 'info' ? { bg: '#DBEAFE', fg: '#1E40AF' } : { bg: '#FEE2E2', fg: colors.danger };
  return (
    <View style={[st.banner, { backgroundColor: c.bg }]} accessibilityRole="alert">
      <Ionicons name={icon} size={18} color={c.fg} />
      <Text style={[st.bannerText, { color: c.fg }]}>{text}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: colors.primary, paddingLeft: spacing.sm, paddingRight: spacing.sm, paddingBottom: spacing.md },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  callNo: { position: 'absolute', right: 6, bottom: 6, fontSize: 10, fontWeight: '700', color: colors.onPrimary },
  title: { flex: 1, fontSize: 19, fontWeight: '600', color: colors.onPrimary },
  body: { padding: spacing.lg, gap: spacing.md },
  empty: { textAlign: 'center', fontSize: font.md, color: colors.textMuted, padding: spacing.xxl },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: spacing.lg, gap: spacing.md },
  name: { fontSize: 19, fontWeight: '600', color: colors.text },
  muted: { fontSize: font.sm, color: colors.textMuted },
  facts: { flexDirection: 'row', gap: spacing.sm, borderTopWidth: 1, borderTopColor: '#F1EDE4', paddingTop: spacing.md },
  fact: { flex: 1, gap: 2 },
  factLabel: { fontSize: 12, color: colors.textMuted },
  factValue: { fontSize: 14, fontWeight: '600', color: colors.text },
  owes: { backgroundColor: colors.primarySoft, borderRadius: radius.lg - 2, paddingHorizontal: spacing.md + 2, paddingVertical: spacing.md, gap: 2 },
  owesRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: spacing.sm },
  owesLabel: { fontSize: 14, fontWeight: '500', color: colors.primary },
  owesAmount: { fontSize: 22, fontWeight: '700', color: colors.primary },
  dueAmount: { fontSize: 17, fontWeight: '700', color: colors.primary },
  owesNote: { fontSize: 12, color: colors.textMuted },
  banner: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm + 2, borderRadius: radius.lg - 2, paddingHorizontal: spacing.md + 2, paddingVertical: spacing.md },
  bannerText: { flex: 1, fontSize: font.sm, lineHeight: 18 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md - 2 },
  action: {
    width: '31.5%',
    flexGrow: 1,
    height: 84,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
  },
  actionPrimary: { backgroundColor: colors.primary, borderColor: colors.primary },
  actionText: { fontSize: 14, fontWeight: '500', color: colors.text },
  actionTextPrimary: { color: colors.onPrimary, fontWeight: '600' },
  bills: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, overflow: 'hidden' },
  billsTitle: { paddingHorizontal: spacing.md + 2, paddingTop: spacing.md, paddingBottom: spacing.sm, fontSize: font.md, fontWeight: '600', color: colors.text },
  billRow: { flexDirection: 'row', paddingHorizontal: spacing.md + 2, paddingVertical: spacing.sm + 2, borderTopWidth: 1, borderTopColor: '#F1EDE4' },
  billHead: { backgroundColor: colors.bg, paddingVertical: spacing.sm, borderTopWidth: 0 },
  billHeadText: { fontSize: 12, fontWeight: '600', color: colors.textMuted },
  billCell: { flex: 1, fontSize: 14, color: colors.text },
  billsEmpty: { paddingHorizontal: spacing.md + 2, paddingVertical: spacing.md, fontSize: font.sm, color: colors.textMuted },
});
