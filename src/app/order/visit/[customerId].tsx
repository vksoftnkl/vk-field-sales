import Ionicons from '@expo/vector-icons/Ionicons';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { router, useLocalSearchParams, usePreventRemove } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/screen-header';
import { useDateNames } from '@/components/use-date-names';
import { branchQuery, companiesQuery, currentCompanyQuery, currentContext } from '@/features/company/company';
import { CompanySheet } from '@/features/company/company-sheet';
import { addressLine } from '@/features/customers/customer-list';
import { customerDetailQuery } from '@/features/customers/queries';
import { currentBalance } from '@/features/ledger/ledger';
import { ledgerYearsQuery } from '@/features/ledger/queries';
import { LocationCard, useLocate } from '@/features/orders/check-in-location';
import { creditView } from '@/features/orders/credit';
import { contextChosen, fixFound, orderCleared, resumesVisit, visitStarted } from '@/features/orders/order-draft';
import { num, toPaise } from '@/features/orders/order-math';
import { isRecentOpen, SO_TONES, soState, type SoState } from '@/features/orders/order-status';
import { companyQuery, isGstRegistered, oldestOpenBillQuery, orderRef, shopOrderLinesQuery, visitCustomerQuery } from '@/features/orders/queries';
import { formatDay } from '@/lib/date-range';
import { formatAmount, todayISO } from '@/lib/money';
import { store, useAppDispatch, useAppSelector } from '@/store';
import { colors, font, radius, spacing } from '@/theme';

/**
 * Visit (canvas 3b, steps 1–2): opening an order checks the salesman in — the time at once, and a
 * GPS fix, offline too. The shop, its credit (outstanding against the limit, the oldest unpaid
 * bill) and its open orders show before ordering. "Order for" shows, read only, the company and
 * branch picked in Switch company: the order is saved for them. With none picked yet, Switch
 * company opens first (and again on Take order). No order and Take order are the two ways on.
 * Replaces Choose company and the separate Check in.
 */
export default function VisitScreen() {
  const { customerId } = useLocalSearchParams<{ customerId: string }>();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const names = useDateNames();
  const dispatch = useAppDispatch();
  const today = todayISO();

  const { data: companies } = useLiveQuery(companiesQuery());
  const draft = useAppSelector((st) => st.orderDraft);
  const ours = draft.customerId === customerId && !draft.editingSoId;

  // Check in: kept in the draft, so coming back to this screen shows the same time and place.
  const [startedAt] = useState(() => new Date().toISOString());
  // A new order takes Switch company's company and branch; one in progress keeps its own.
  useEffect(() => {
    const ctx = currentContext();
    dispatch(visitStarted({ customerId, companyId: ctx?.companyId ?? currentCompanyQuery().get()?.id ?? null, branchId: ctx?.branchId ?? null, at: startedAt }));
  }, [dispatch, customerId, startedAt]);
  // No company and branch picked yet: Switch company opens before an order can be taken.
  const [picking, setPicking] = useState(() => !currentContext() && companiesQuery().all().length > 0);
  // Read before visitStarted runs: the fix of an order in progress is kept, else a new one is read.
  const [resumedFix] = useState(() => (resumesVisit(draft, customerId) ? (draft.checkIn?.fix ?? null) : null));
  const { loc, locate } = useLocate(resumedFix);
  useEffect(() => {
    if (loc.kind === 'fix') dispatch(fixFound(loc.fix));
  }, [dispatch, loc]);

  const companyId = (ours ? draft.companyId : null) ?? '';
  const branchId = (ours ? draft.branchId : null) ?? '';
  const { data: company } = useLiveQuery(companyQuery(companyId), [companyId]);
  const { data: branch } = useLiveQuery(branchQuery(branchId), [branchId]);
  const needsContext = !companyId || !branchId;
  const { data: found, updatedAt } = useLiveQuery(customerDetailQuery(customerId), [customerId]);
  const { data: extra } = useLiveQuery(visitCustomerQuery(customerId), [customerId]);
  const { data: years } = useLiveQuery(ledgerYearsQuery(customerId), [customerId]);
  const { data: oldest } = useLiveQuery(oldestOpenBillQuery(customerId, companyId), [customerId, companyId]);
  const { data: shopLines } = useLiveQuery(shopOrderLinesQuery(customerId, companyId, today), [customerId, companyId, today]);
  const c = found[0];
  const x = extra[0];

  const balance = currentBalance(years);
  const outstanding = balance ?? c?.outstandingPaise ?? 0;
  const syncedOn = years.reduce<string | null>((latest, y) => (latest && latest > y.syncedOn ? latest : y.syncedOn), null);
  const credit = creditView({
    outstandingPaise: outstanding,
    limitPaise: toPaise(x?.cusCreditAmtLimit) ?? 0,
    creditDays: x?.cusCreditDays ?? 0,
    oldestBillDate: oldest[0]?.date ?? null,
    today,
  });

  const seen = new Map<string, { soId: string; ref: string; date: string; amount: string; items: number; state: SoState }>();
  for (const r of shopLines) {
    if (seen.has(r.soId)) continue;
    const state = soState(r);
    if (!isRecentOpen({ state, soOrderDate: r.soOrderDate }, today)) continue;
    seen.set(r.soId, { soId: r.soId, ref: orderRef(r), date: r.soOrderDate, amount: r.soOrderAmt, items: r.soTotItems, state });
  }
  const openOrders = [...seen.values()];

  const hasItems = ours && draft.entry === 'visit' && draft.lines.some((l) => num(l.qty) > 0);
  usePreventRemove(hasItems, ({ repeat }) => {
    Alert.alert(t('order.discardTitle'), t('order.discardText', { name: c?.cusName ?? '' }), [
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

  // Picked in Switch company: an order that had no company or branch yet takes them.
  const onSwitched = () => {
    const ctx = currentContext();
    const d = store.getState().orderDraft;
    if (ctx && d.customerId === customerId && !d.editingSoId && (!d.companyId || !d.branchId)) dispatch(contextChosen(ctx));
  };
  const takeOrder = () => {
    if (needsContext) return setPicking(true);
    router.push({ pathname: '/order/[customerId]', params: { customerId, companyId } });
  };

  const name = c ? (c.cusName ?? c.cusShort ?? c.cusCode ?? '') : '';
  const address = c ? addressLine(c) : '';
  const place = [address, x?.beatName ? t('so.beat', { name: x.beatName }) : ''].filter(Boolean).join(' · ');
  const facts: [string, string][] = [
    [t('so.type'), c?.typeName ?? '—'],
    [t('so.priceLevel'), c?.priceLevelName ?? '—'],
    [t('so.gst'), x ? (isGstRegistered(x) ? t('so.gstRegistered') : t('so.gstUnregistered')) : '—'],
  ];
  const barColor = credit.usedPerc >= 100 ? colors.danger : credit.usedPerc >= 75 ? '#B45309' : colors.success;
  const noCompany = companies.length === 0;

  return (
    <View style={st.root}>
      <ScreenHeader title={t('so.visitTitle')} subtitle={name ? t('so.visitSubtitle', { name }) : undefined} backLabel={t('customerDetail.back')} />
      <ScrollView contentContainerStyle={st.body}>
        <LocationCard loc={loc} onRetry={() => void locate()} checkedInAt={(ours ? draft.checkIn?.at : null) ?? startedAt} note={t('so.worksOffline')} />

        {c ? (
          <View style={st.card}>
            <View style={{ gap: 3 }}>
              <Text style={st.shop}>{name}</Text>
              {place ? <Text style={st.muted}>{place}</Text> : null}
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
          </View>
        ) : updatedAt ? (
          <Text style={st.empty}>{t('customerDetail.notFound')}</Text>
        ) : null}

        <View style={st.card} accessibilityLabel={t('so.credit')}>
          <View style={st.owesRow} accessible accessibilityLabel={`${t('so.outstanding')}: ${formatAmount(outstanding)}`}>
            <Text style={st.muted}>{t('so.outstanding')}</Text>
            <Text style={st.owes}>{formatAmount(outstanding)}</Text>
          </View>
          {credit.hasLimit ? (
            <>
              <View style={st.bar} accessible accessibilityRole="progressbar" accessibilityLabel={t('so.creditUsed', { perc: credit.usedPerc })}>
                <View style={[st.barFill, { width: `${credit.usedPerc}%`, backgroundColor: barColor }]} />
              </View>
              <View style={st.owesRow}>
                <Text style={st.small}>{t('so.creditLimit', { amount: formatAmount(toPaise(x?.cusCreditAmtLimit) ?? 0) })}</Text>
                <Text style={[st.small, credit.leftPaise < 0 && { color: colors.danger, fontWeight: '600' }]}>
                  {credit.leftPaise >= 0 ? t('so.creditLeft', { amount: formatAmount(credit.leftPaise) }) : t('so.creditOver', { amount: formatAmount(-credit.leftPaise) })}
                </Text>
              </View>
            </>
          ) : (
            <Text style={st.small}>{t('so.noLimit')}</Text>
          )}
          {credit.oldestDays !== null ? (
            <View style={[st.note, credit.overdue ? st.noteWarn : st.noteInfo]}>
              <Ionicons name="time-outline" size={16} color={credit.overdue ? '#92400E' : colors.textMuted} />
              <Text style={[st.noteText, { color: credit.overdue ? '#92400E' : colors.textLabel }]}>{t('so.oldestBill', { days: credit.oldestDays })}</Text>
            </View>
          ) : null}
          <Text style={st.asOf}>{balance !== null && syncedOn ? t('customerDetail.asOfSync', { date: formatDay(syncedOn.slice(0, 10), names) }) : t('customerDetail.noLedgerYet')}</Text>
        </View>

        {noCompany ? (
          <Text style={st.muted}>{t('order.noCompaniesText')}</Text>
        ) : needsContext ? (
          <Pressable accessibilityRole="button" onPress={() => setPicking(true)} style={({ pressed }) => [st.card, st.pickCard, pressed && { opacity: 0.85 }]}>
            <Ionicons name="business-outline" size={20} color={colors.primary} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={st.pickText}>{t('so.pickCompany')}</Text>
              <Text style={st.small}>{t('so.pickCompanyNote')}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.primary} />
          </Pressable>
        ) : (
          <View style={st.card} accessible accessibilityLabel={`${t('so.orderFor')}: ${company[0]?.name ?? ''}, ${t('so.orderForBranch')}: ${branch[0]?.name ?? ''}`}>
            <View style={st.ctxRow}>
              <View style={st.fact}>
                <Text style={st.factLabel}>{t('so.orderFor')}</Text>
                <Text style={st.factValue} numberOfLines={2}>
                  {company[0]?.name ?? '—'}
                </Text>
              </View>
              <View style={st.fact}>
                <Text style={st.factLabel}>{t('so.orderForBranch')}</Text>
                <Text style={st.factValue} numberOfLines={2}>
                  {branch[0]?.name ?? '—'}
                </Text>
              </View>
            </View>
            <Text style={st.asOf}>{t('so.changeInMenu')}</Text>
          </View>
        )}

        {openOrders.map((o) => {
          const tone = SO_TONES[o.state];
          return (
            <Pressable
              key={o.soId}
              accessibilityRole="button"
              onPress={() => router.push({ pathname: '/orders/[soId]', params: { soId: o.soId } })}
              style={({ pressed }) => [st.open, pressed && { backgroundColor: colors.bg }]}
            >
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={st.openTitle}>{t('so.openOrder', { ref: o.ref })}</Text>
                <Text style={st.small}>{t('so.openOrderMeta', { date: formatDay(o.date, names), amount: formatAmount(toPaise(o.amount) ?? 0), count: o.items })}</Text>
              </View>
              <View style={[st.chip, { backgroundColor: tone.bg }]}>
                <Text style={[st.chipText, { color: tone.fg }]}>{t(`so.status.${o.state}`)}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={[st.footer, { paddingBottom: insets.bottom + spacing.lg }]}>
        <Pressable accessibilityRole="button" onPress={() => router.push('/order/no-order')} style={({ pressed }) => [st.btn, st.btnOutline, pressed && { opacity: 0.85 }]}>
          <Text style={[st.btnText, { color: colors.primary }]}>{t('so.noOrder')}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: noCompany }}
          disabled={noCompany}
          onPress={takeOrder}
          style={({ pressed }) => [st.btn, st.btnPrimary, noCompany && { opacity: 0.5 }, pressed && { opacity: 0.85 }]}
        >
          <Text style={[st.btnText, { color: colors.onPrimary }]}>{draft.lines.length && ours ? t('so.takeOrderN', { count: draft.lines.length }) : t('so.takeOrder')}</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.onPrimary} />
        </Pressable>
      </View>

      <CompanySheet visible={picking} onClose={() => setPicking(false)} onSwitched={onSwitched} />
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { padding: spacing.lg, paddingTop: spacing.md + 2, gap: 10 },
  empty: { textAlign: 'center', fontSize: font.md, color: colors.textMuted, padding: spacing.xl },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md + 2, gap: 10 },
  shop: { fontSize: font.lg, fontWeight: '600', color: colors.text },
  muted: { fontSize: font.sm, color: colors.textMuted },
  small: { fontSize: font.sm, color: colors.textLabel },
  facts: { flexDirection: 'row', gap: spacing.sm, borderTopWidth: 1, borderTopColor: '#F1EDE4', paddingTop: 10 },
  fact: { flex: 1, gap: 2 },
  factLabel: { fontSize: 12, color: colors.textMuted },
  factValue: { fontSize: 14, fontWeight: '600', color: colors.text },
  owesRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: spacing.sm },
  owes: { fontSize: 19, fontWeight: '700', color: colors.primary },
  bar: { height: 8, borderRadius: 999, backgroundColor: '#EEECE9', overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 999 },
  note: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderRadius: radius.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
  noteWarn: { backgroundColor: '#FEF3C7' },
  noteInfo: { backgroundColor: colors.bg },
  noteText: { flex: 1, fontSize: font.sm },
  asOf: { fontSize: 12, color: colors.textMuted },
  ctxRow: { flexDirection: 'row', gap: spacing.sm },
  pickCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderColor: colors.primary, borderStyle: 'dashed' },
  pickText: { fontSize: font.md, fontWeight: '600', color: colors.primary },
  open: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 60,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md + 2,
    paddingVertical: spacing.sm,
    paddingLeft: spacing.md + 2,
    paddingRight: spacing.md,
  },
  openTitle: { fontSize: 14, fontWeight: '600', color: colors.text },
  chip: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 2 },
  chipText: { fontSize: 12, fontWeight: '600' },
  footer: { flexDirection: 'row', gap: 10, paddingTop: spacing.md, paddingHorizontal: spacing.lg, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
  btn: { flex: 1, minHeight: 52, borderRadius: radius.md + 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  btnOutline: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.inputBorder },
  btnPrimary: { backgroundColor: colors.primary },
  btnText: { fontSize: font.md, fontWeight: '600' },
});
