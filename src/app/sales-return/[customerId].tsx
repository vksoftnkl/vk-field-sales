import Ionicons from '@expo/vector-icons/Ionicons';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { router, useLocalSearchParams, usePreventRemove } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/screen-header';
import { useDateNames } from '@/components/use-date-names';
import { getMeta } from '@/db/meta';
import { branchQuery } from '@/features/company/company';
import { addressLine } from '@/features/customers/customer-list';
import { asOfText } from '@/features/orders/order-status';
import { companyQuery, customerName } from '@/features/orders/queries';
import { returnBillPicked, returnCleared, returnNoBillChosen, returnStarted } from '@/features/returns/return-draft';
import { moneyPaise, pastWindow } from '@/features/returns/return-math';
import { useReturnSetup } from '@/features/returns/return-parts';
import { returnCustomerQuery, shopBillLineCountsQuery, shopReturnBillsQuery } from '@/features/returns/queries';
import { returnStyles } from '@/features/returns/return-styles';
import { formatDay } from '@/lib/date-range';
import { daysBetween, formatAmount, todayISO } from '@/lib/money';
import { useAppDispatch, useAppSelector } from '@/store';
import { colors, font, radius, spacing } from '@/theme';

/**
 * Sales return, step 1–2 (canvas 6b, "Shop and bill"): the shop (Change only until a bill is
 * picked, as the desktop locks the customer then), From a bill (default, as the desktop's
 * "Against: Bill") or No bill, and the shop's posted bills from Sync with how many lines can still
 * come back. Picking a bill opens Return items. Opened by Return on Customer detail, for the
 * company and branch picked in Switch company.
 */
export default function ReturnStartScreen() {
  const { customerId: openedFor, companyId } = useLocalSearchParams<{ customerId: string; companyId: string }>();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const names = useDateNames();
  const dispatch = useAppDispatch();
  const draft = useAppSelector((st) => st.returnDraft);
  const [query, setQuery] = useState('');
  const [showReturned, setShowReturned] = useState(false);
  const today = todayISO();

  useEffect(() => {
    dispatch(returnStarted({ customerId: openedFor, companyId, branchId: getMeta('branchId') }));
  }, [dispatch, openedFor, companyId]);

  const customerId = draft.customerId ?? openedFor;
  const { data: shop } = useLiveQuery(returnCustomerQuery(customerId), [customerId]);
  const { data: company } = useLiveQuery(companyQuery(companyId), [companyId]);
  const { data: branch } = useLiveQuery(branchQuery(draft.branchId ?? ''), [draft.branchId]);
  const { settings, ready } = useReturnSetup(companyId);
  const { data: bills } = useLiveQuery(shopReturnBillsQuery(customerId, companyId), [customerId, companyId]);
  const { data: counts } = useLiveQuery(shopBillLineCountsQuery(customerId, companyId), [customerId, companyId]);
  const c = shop[0];
  const name = c ? customerName(c) : '';
  const windowDays = settings?.returnWindowDays ?? 0;
  const freeAllowed = settings?.freeReturnAllowed !== false;

  const rows = useMemo(() => {
    const byBill = new Map(counts.map((k) => [`${k.sbId}|${k.accYear}`, k]));
    const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return bills
      .map((b) => {
        const k = byBill.get(`${b.sbId}|${b.accYear}`);
        return { ...b, lines: k?.lines ?? 0, open: k?.open ?? 0, itemNames: k?.itemNames ?? '' };
      })
      .filter((b) => {
        if (!words.length) return true;
        const hay = `${b.refno} ${b.billAmount} ${b.itemNames}`.toLocaleLowerCase();
        return words.every((w) => hay.includes(w));
      });
  }, [bills, counts, query]);
  const fullyReturned = rows.filter((b) => b.open === 0);
  const shown = showReturned ? rows : rows.filter((b) => b.open > 0);

  // Leaving with lines typed asks first (Save return clears the return before it closes).
  usePreventRemove(draft.parts.length > 0 && !draft.editingId, ({ repeat }) => {
    Alert.alert(t('sr.discardTitle'), t('sr.discardText', { name }), [
      { text: t('order.keep'), style: 'cancel' },
      {
        text: t('order.discard'),
        style: 'destructive',
        onPress: () => {
          dispatch(returnCleared());
          repeat();
        },
      },
    ]);
  });

  const pick = (b: (typeof rows)[number]) => {
    if (b.open === 0) return Alert.alert(t('sr.start.fullyReturnedTitle'), t('sr.start.fullyReturnedText', { bill: b.refno }));
    const change = draft.parts.length > 0 && !!draft.bill && (draft.bill.sbId !== b.sbId || draft.bill.accYear !== b.accYear);
    const go = () => {
      dispatch(returnBillPicked({ sbId: b.sbId, accYear: b.accYear, refno: b.refno, date: b.billDate }));
      router.push('/sales-return/items');
    };
    if (!change) return go();
    Alert.alert(t('sr.start.switchTitle'), t('sr.start.switchText', { from: draft.bill?.refno ?? '', to: b.refno }), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('sr.start.switch', { to: b.refno }), onPress: go },
    ]);
  };
  const noBill = () => {
    if (!freeAllowed) return Alert.alert(t('sr.start.noBillOffTitle'), t('sr.start.noBillOffText'));
    dispatch(returnNoBillChosen());
    router.push('/sales-return/no-bill');
  };
  const canChangeShop = !draft.bill && draft.parts.length === 0 && !draft.editingId;
  const asOf = settings?.billsAsOf ? asOfText(settings.billsAsOf, names, t('so.today')) : null;

  return (
    <View style={st.root}>
      <ScreenHeader
        title={t('sr.title')}
        subtitle={[company[0]?.name, branch[0]?.name].filter(Boolean).join(' · ')}
        backLabel={t('sr.back')}
      />
      <ScrollView contentContainerStyle={[st.body, { paddingBottom: insets.bottom + spacing.xl }]} keyboardShouldPersistTaps="handled">
        {!ready ? (
          <View style={st.warn}>
            <Ionicons name="cloud-download-outline" size={18} color="#78350F" />
            <Text style={st.warnText}>{t('sr.start.syncFirst')}</Text>
          </View>
        ) : null}

        <View style={st.card}>
          <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
            <Text style={st.shopName} numberOfLines={1}>
              {name}
            </Text>
            {c ? (
              <Text style={st.small} numberOfLines={1}>
                {[c.beatName, addressLine(c)].filter(Boolean).join(' · ')}
              </Text>
            ) : null}
          </View>
          {canChangeShop ? (
            <Pressable accessibilityRole="button" onPress={() => router.push('/sales-return/customer')} style={st.linkBtn}>
              <Text style={st.link}>{t('sr.start.change')}</Text>
            </Pressable>
          ) : null}
        </View>
        {canChangeShop ? <Text style={st.hint}>{t('sr.start.changeHint')}</Text> : null}

        <View style={st.segment} accessibilityRole="radiogroup">
          <Pressable accessibilityRole="radio" accessibilityState={{ checked: !draft.noBill }} style={[st.segBtn, !draft.noBill && st.segOn]}>
            <Text style={[st.segText, !draft.noBill && st.segTextOn]}>{t('sr.start.fromBill')}</Text>
          </Pressable>
          <Pressable accessibilityRole="radio" accessibilityState={{ checked: draft.noBill }} onPress={noBill} style={[st.segBtn, draft.noBill && st.segOn]}>
            <Text style={[st.segText, draft.noBill && st.segTextOn]}>{t('sr.start.noBill')}</Text>
          </Pressable>
        </View>

        <View style={st.search}>
          <Ionicons name="search" size={18} color={colors.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t('sr.start.search')}
            placeholderTextColor={colors.textMuted}
            accessibilityLabel={t('sr.start.search')}
            style={st.searchInput}
          />
        </View>
        <Text style={st.hint}>{asOf ? t('sr.start.billsAsOf', { days: settings?.billDays ?? 90, when: asOf }) : t('sr.start.billsNone')}</Text>

        {shown.map((b) => {
          const on = draft.bill?.sbId === b.sbId && draft.bill?.accYear === b.accYear;
          const days = daysBetween(b.billDate, today);
          const late = pastWindow(b.billDate, today, windowDays);
          const duePaise = moneyPaise(b.due);
          const returnedPaise = moneyPaise(b.returnedAmt);
          return (
            <Pressable
              key={`${b.sbId}|${b.accYear}`}
              accessibilityRole="button"
              onPress={() => pick(b)}
              style={({ pressed }) => [st.bill, on && st.billOn, b.open === 0 && { opacity: 0.6 }, pressed && { backgroundColor: colors.bg }]}
            >
              <View style={st.between}>
                <Text style={st.billNo}>{b.refno}</Text>
                <Text style={st.billNo}>{formatAmount(moneyPaise(b.billAmount))}</Text>
              </View>
              <Text style={st.small}>
                {[
                  formatDay(b.billDate, names).replace(/ \d{4}$/, ''),
                  t('sr.start.days', { count: days }),
                  b.payMode ? b.payMode.toLocaleLowerCase() : null,
                  duePaise > 0 ? t('sr.start.due', { amount: formatAmount(duePaise) }) : t('sr.start.paid'),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
              <View style={st.chips}>
                {b.open > 0 ? (
                  <Text style={[st.chip, st.chipOk]}>{t('sr.start.linesOpen', { open: b.open, lines: b.lines })}</Text>
                ) : (
                  <Text style={[st.chip, st.chipGrey]}>{t('sr.start.allBack')}</Text>
                )}
                {returnedPaise > 0 ? <Text style={[st.chip, st.chipWarn]}>{t('sr.start.returnedBefore', { amount: formatAmount(returnedPaise) })}</Text> : null}
                {late ? <Text style={[st.chip, st.chipWarn]}>{t('sr.start.pastWindow', { days: windowDays })}</Text> : null}
              </View>
            </Pressable>
          );
        })}
        {ready && shown.length === 0 ? <Text style={st.empty}>{query ? t('sr.start.noMatch') : t('sr.start.noBills')}</Text> : null}

        {fullyReturned.length > 0 ? (
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: showReturned }}
            onPress={() => setShowReturned((v) => !v)}
            style={st.check}
          >
            <Ionicons name={showReturned ? 'checkbox' : 'square-outline'} size={22} color={colors.primary} />
            <Text style={st.checkText}>{t('sr.start.showReturned', { n: fullyReturned.length })}</Text>
          </Pressable>
        ) : null}

        {freeAllowed ? (
          <Pressable accessibilityRole="button" onPress={noBill} style={({ pressed }) => [st.noBillCard, pressed && { backgroundColor: colors.bg }]}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={st.noBillTitle}>{t('sr.start.notOnBills')}</Text>
              <Text style={st.small}>{t('sr.start.notOnBillsHint')}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}


const st = StyleSheet.create({
  ...returnStyles,
  shopName: { fontSize: 16, fontWeight: '600', color: colors.text },
  linkBtn: { minHeight: 44, paddingHorizontal: spacing.sm, justifyContent: 'center' },
  link: { fontSize: font.sm, fontWeight: '600', color: colors.primary },
  segment: { flexDirection: 'row', backgroundColor: colors.border, borderRadius: radius.md + 2, padding: 3, gap: 3 },
  segBtn: { flex: 1, minHeight: 42, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  segOn: { backgroundColor: colors.surface },
  segText: { fontSize: 14, color: colors.textLabel },
  segTextOn: { fontWeight: '600', color: colors.primary },
  search: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, height: 46, borderWidth: 1, borderColor: colors.inputBorder, borderRadius: radius.md + 2, paddingHorizontal: spacing.md, backgroundColor: colors.surface },
  searchInput: { flex: 1, fontSize: font.md, color: colors.text, paddingVertical: 0 },
  bill: { gap: 5, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md + 2, paddingVertical: 10, paddingHorizontal: spacing.md + 2 },
  billOn: { borderColor: colors.primary, borderWidth: 1.5 },
  billNo: { fontSize: font.md, fontWeight: '600', color: colors.text },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  empty: { textAlign: 'center', fontSize: font.md, color: colors.textMuted, padding: spacing.xl },
  check: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  checkText: { fontSize: 14, color: colors.textLabel },
  noBillCard: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surface, borderWidth: 1, borderStyle: 'dashed', borderColor: '#A8A29E', borderRadius: radius.md + 2, padding: spacing.md + 2 },
  noBillTitle: { fontSize: 14, fontWeight: '600', color: colors.text },
});
