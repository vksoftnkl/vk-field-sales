import Ionicons from '@expo/vector-icons/Ionicons';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { router } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CalendarDialog } from '@/components/calendar-dialog';
import { ScreenHeader } from '@/components/screen-header';
import { PickerSheet } from '@/components/ui';
import { useDateNames } from '@/components/use-date-names';
import { qtyText } from '@/features/orders/order-math';
import { customerName } from '@/features/orders/queries';
import { returnCleared, returnFieldsSet, returnGodownSet, returnSettleSet } from '@/features/returns/return-draft';
import { defaultSettle, DEBIT_NOTE_MAX, pastWindow, planAdjust, REMARKS_MAX, returnEstimate, type AdjustBill } from '@/features/returns/return-math';
import { useReturnSetup } from '@/features/returns/return-parts';
import { barStyles, returnStyles } from '@/features/returns/return-styles';
import { adjustBillsQuery, saveReturnDraft } from '@/features/returns/queries';
import { saleCustomerQuery } from '@/features/sales/queries';
import { formatDay, parseDMY, toDMY } from '@/lib/date-range';
import { formatAmount, todayISO } from '@/lib/money';
import { store, useAppDispatch, useAppSelector } from '@/store';
import { getDeviceUid } from '@/sync/sync-store';
import { colors, font, radius, spacing } from '@/theme';

/**
 * Review, step 4 (canvas 6b): the credit note as the phone estimates it from the bill lines (VK
 * Nex works the final one out at Sync), Settle by — Adjust (this bill, then oldest; Change the
 * split opens 4a) or Keep as credit note, starting at VK Nex's own default; cash refunds stay in
 * the office — where the goods go, the shop's debit note no. and remarks. The date is today.
 * Save return confirms with the goods to load, keeps it on the phone and shows the slip.
 */
export default function ReturnReviewScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const names = useDateNames();
  const dispatch = useAppDispatch();
  const d = useAppSelector((st) => st.returnDraft);
  const userId = useAppSelector((st) => st.session.session?.userId ?? '');
  const companyId = d.companyId ?? '';
  const custId = d.customerId ?? '';
  const [godownOpen, setGodownOpen] = useState(false);
  const [calendar, setCalendar] = useState(false);
  const [saving, setSaving] = useState(false);
  const saved = useRef(false);
  const today = todayISO();

  const { settings, reasons, godowns } = useReturnSetup(companyId);
  const { data: shop } = useLiveQuery(saleCustomerQuery(custId), [custId]);
  const { data: open } = useLiveQuery(adjustBillsQuery(custId, companyId), [custId, companyId]);
  const reason = reasons.find((r) => r.reasonId === d.reasonId);
  const est = returnEstimate(d.parts);

  const bills: AdjustBill[] = useMemo(
    () => open.map((b) => ({ billId: b.billId, billAccYear: b.billAccYear, refno: b.refno, pendingPaise: b.pendingPaise, isThisBill: !!d.bill && b.refno === d.bill.refno })),
    [open, d.bill],
  );
  const thisBill = bills.find((b) => b.isThisBill);
  const mode = d.settleMode ?? defaultSettle(settings?.settleDefault, !!d.bill, thisBill?.pendingPaise ?? 0);
  const typed = useMemo(() => (d.adjust ? new Map(d.adjust.map((r) => [`${r.billId}|${r.billAccYear}`, r.amountPaise])) : undefined), [d.adjust]);
  const plan = planAdjust(est.totalPaise, bills, typed);
  const firstRow = plan.rows.find((r) => r.amountPaise > 0);
  const firstBill = firstRow ? bills.find((b) => b.billId === firstRow.billId && b.billAccYear === firstRow.billAccYear) : undefined;
  const godown = godowns.find((g) => g.godownId === d.godownId);
  const late = !!d.bill && pastWindow(d.bill.date, today, settings?.returnWindowDays ?? 0);
  const office = [
    !d.bill ? t('sr.review.officeNoBill') : null,
    late ? t('sr.review.officeWindow', { days: settings?.returnWindowDays ?? 0 }) : null,
    settings?.canPost === false ? t('sr.review.officeNoRight') : null,
  ].filter((x): x is string => !!x);

  const doSave = () => {
    if (saved.current) return;
    const draft = store.getState().returnDraft;
    const c = saleCustomerQuery(custId).get();
    if (!c) return Alert.alert(t('common.error'));
    setSaving(true);
    try {
      const edited = !!draft.editingId;
      const { srId } = saveReturnDraft(draft, c, {
        userId,
        deviceUid: getDeviceUid(),
        reasonName: reason?.name ?? null,
        settleMode: mode,
        adjust: mode === 'ADJUST' ? draft.adjust : null,
      });
      saved.current = true;
      dispatch(returnCleared());
      router.dismissTo({ pathname: '/customer/[id]', params: { id: custId } });
      if (edited) router.push({ pathname: '/returns', params: { customerId: custId } });
      router.push({ pathname: '/sales-return/saved/[id]', params: { id: srId } });
    } catch (e) {
      const code = e instanceof Error ? e.message : '';
      Alert.alert(t('common.error'), code === 'RETURN_NOT_EDITABLE' ? t('sr.review.notEditable') : code === 'RETURN_NO_REASON' ? t('sr.items.reasonNeeded') : '');
    } finally {
      setSaving(false);
    }
  };
  const save = () => {
    if (!d.reasonId) return Alert.alert(t('sr.items.reasonNeededTitle'), t('sr.items.reasonNeeded'));
    if (est.parts === 0) return Alert.alert(t('sr.items.nothingTitle'), t('sr.items.nothing'));
    if (d.usrRefdate.trim() && !parseDMY(d.usrRefdate)) return Alert.alert(t('sr.review.badDateTitle'), t('sr.line.badDate'));
    const name = shop[0] ? customerName(shop[0]) : '';
    const text = [
      t(mode === 'ADJUST' ? 'sr.review.confirmAdjust' : 'sr.review.confirmCredit', { amount: formatAmount(est.totalPaise), name, bill: firstBill?.refno ?? d.bill?.refno ?? '' }),
      '',
      t('sr.review.confirmLoad'),
      t('sr.review.confirmGood', { qty: qtyText(est.goodQty) }),
      t('sr.review.confirmOther', { qty: qtyText(est.qty - est.goodQty) }),
      '',
      t('sr.review.confirmNote'),
    ].join('\n');
    Alert.alert(t('sr.review.confirmTitle'), text, [
      { text: t('sr.review.keepEditing'), style: 'cancel' },
      { text: t('sr.review.save'), onPress: doSave },
    ]);
  };

  const gstText = est.igstPaise > 0 ? t('sr.review.igst', { igst: formatAmount(est.igstPaise) }) : t('sr.review.cgstSgst', { cgst: formatAmount(est.cgstPaise), sgst: formatAmount(est.sgstPaise) });

  return (
    <View style={st.root}>
      <ScreenHeader title={t('sr.review.title')} subtitle={`${shop[0] ? customerName(shop[0]) : ''} · ${t('sr.review.today', { date: formatDay(today, names).replace(/ \d{4}$/, '') })}`} backLabel={t('sr.back')} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView contentContainerStyle={st.body} keyboardShouldPersistTaps="handled">
          {office.length ? (
            <View style={st.held}>
              <Ionicons name="people-outline" size={18} color="#5B21B6" />
              <Text style={st.heldText}>{[t('sr.review.officeHead'), ...office.map((o) => `• ${o}`)].join('\n')}</Text>
            </View>
          ) : null}

          <View style={st.creditCard}>
            <View style={st.between}>
              <Text style={st.cardLabel}>{t('sr.review.creditEstimate')}</Text>
              <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={6}>
                <Text style={st.link}>{t('sr.review.lines', { lines: est.lines, qty: qtyText(est.qty) })}</Text>
              </Pressable>
            </View>
            <Text style={st.big}>{formatAmount(est.totalPaise)}</Text>
            <Row label={t('sr.review.goods')} value={formatAmount(est.taxablePaise)} />
            <Row label={gstText} value={formatAmount(est.taxPaise)} />
            {est.roundOffPaise !== 0 ? <Row label={t('sr.review.roundOff')} value={`${est.roundOffPaise > 0 ? '+' : ''}${formatAmount(est.roundOffPaise)}`} /> : null}
            {reason?.refundCharges ? <Text style={st.small}>{t('sr.review.chargesBack')}</Text> : null}
            <Text style={st.small}>
              {[d.bill ? t('sr.review.against', { bill: d.bill.refno }) : t('sr.items.noBill'), reason ? t('sr.review.reason', { reason: reason.name }) : null].filter(Boolean).join(' · ')}. {t('sr.review.vkWorksItOut')}
            </Text>
          </View>

          <Text style={st.h2}>{t('sr.review.settleBy')}</Text>
          <View style={{ gap: 8 }} accessibilityRole="radiogroup">
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ checked: mode === 'ADJUST', disabled: !d.bill }}
              disabled={!d.bill}
              onPress={() => dispatch(returnSettleSet('ADJUST'))}
              style={[st.option, mode === 'ADJUST' && st.optionOn, !d.bill && st.optionOff]}
            >
              <View style={st.optionHead}>
                <Ionicons name={mode === 'ADJUST' ? 'radio-button-on' : 'radio-button-off'} size={20} color={d.bill ? colors.primary : colors.textMuted} />
                <Text style={st.optionTitle}>{t('sr.review.adjust')}</Text>
              </View>
              {!d.bill ? (
                <Text style={st.optionText}>{t('sr.review.adjustNeedsBill')}</Text>
              ) : bills.length === 0 ? (
                <Text style={st.optionText}>{t('sr.review.noOpenBills')}</Text>
              ) : (
                <>
                  <Text style={st.optionText}>
                    {plan.rows
                      .filter((r) => r.amountPaise > 0)
                      .map((r) => {
                        const b = bills.find((x) => x.billId === r.billId && x.billAccYear === r.billAccYear);
                        return t('sr.review.adjustRow', { bill: r.refno, from: formatAmount(b?.pendingPaise ?? 0), to: formatAmount((b?.pendingPaise ?? 0) - r.amountPaise) });
                      })
                      .join('\n')}
                    {plan.leftPaise > 0 ? `\n${t('sr.review.creditLeft', { amount: formatAmount(plan.leftPaise) })}` : ''}
                  </Text>
                  {mode === 'ADJUST' ? (
                    <Pressable accessibilityRole="button" onPress={() => router.push('/sales-return/adjust')} style={st.linkBtn}>
                      <Text style={st.link}>{d.adjust ? t('sr.review.changedSplit') : t('sr.review.changeSplit')}</Text>
                    </Pressable>
                  ) : null}
                </>
              )}
            </Pressable>
            <Pressable accessibilityRole="radio" accessibilityState={{ checked: mode === 'ADVANCE' }} onPress={() => dispatch(returnSettleSet('ADVANCE'))} style={[st.option, mode === 'ADVANCE' && st.optionOn]}>
              <View style={st.optionHead}>
                <Ionicons name={mode === 'ADVANCE' ? 'radio-button-on' : 'radio-button-off'} size={20} color={colors.primary} />
                <Text style={st.optionTitle}>{t('sr.review.keepCredit')}</Text>
              </View>
              <Text style={st.optionText}>{t('sr.review.keepCreditText', { amount: formatAmount(est.totalPaise) })}</Text>
            </Pressable>
            <View style={[st.option, st.optionOff, { borderStyle: 'dashed' }]}>
              <Text style={[st.optionTitle, { color: colors.textMuted }]}>{t('sr.review.cashOffice')}</Text>
              <Text style={st.optionText}>{t('sr.review.cashOfficeText')}</Text>
            </View>
          </View>

          <Pressable accessibilityRole="button" onPress={() => setGodownOpen(true)} style={st.select}>
            <View style={{ flex: 1, gap: 1 }}>
              <Text style={st.small}>{t('sr.review.goodsInto')}</Text>
              <Text style={st.selectText} numberOfLines={1}>
                {godown ? godown.name : d.bill ? t('sr.review.billGodown') : t('sr.review.branchGodown')}
              </Text>
            </View>
            <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
          </Pressable>

          <View style={st.twoCols}>
            <View style={{ flex: 1, gap: 6 }}>
              <Text style={st.label}>{t('sr.review.debitNote')}</Text>
              <TextInput value={d.usrRefno} onChangeText={(v) => dispatch(returnFieldsSet({ usrRefno: v.slice(0, DEBIT_NOTE_MAX) }))} placeholder={t('sr.review.optional')} placeholderTextColor={colors.textMuted} style={st.input} />
            </View>
            <View style={{ width: 140, gap: 6 }}>
              <Text style={st.label}>{t('sr.review.itsDate')}</Text>
              <View style={[st.input, st.dateBox]}>
                <TextInput value={d.usrRefdate} onChangeText={(v) => dispatch(returnFieldsSet({ usrRefdate: v }))} placeholder="dd-mm-yyyy" placeholderTextColor={colors.textMuted} style={{ flex: 1, fontSize: font.md, padding: 0 }} />
                <Pressable accessibilityRole="button" accessibilityLabel={t('sr.line.pickDate')} onPress={() => setCalendar(true)} hitSlop={8}>
                  <Ionicons name="calendar-outline" size={20} color={colors.primary} />
                </Pressable>
              </View>
            </View>
          </View>
          <View style={{ gap: 6 }}>
            <Text style={st.label}>{t('sr.review.remarks')}</Text>
            <TextInput value={d.remarks} onChangeText={(v) => dispatch(returnFieldsSet({ remarks: v.slice(0, REMARKS_MAX) }))} multiline style={[st.input, { minHeight: 64, textAlignVertical: 'top', paddingTop: 10 }]} />
          </View>
        </ScrollView>

        <View style={[barStyles.bar, { paddingBottom: insets.bottom + spacing.lg }]}>
          <View style={{ flex: 1, gap: 1 }}>
            <Text style={barStyles.barSmall}>
              {mode === 'ADJUST' && d.bill ? t('sr.review.barAdjust', { adjusted: formatAmount(plan.adjustedPaise), left: formatAmount(plan.leftPaise) }) : t('sr.review.barCredit')}
            </Text>
            <Text style={barStyles.barTotal}>{formatAmount(est.totalPaise)}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityState={{ busy: saving }} disabled={saving} onPress={save} style={({ pressed }) => [barStyles.barBtn, pressed && { opacity: 0.85 }]}>
            <Text style={barStyles.barBtnText}>{t('sr.review.save')}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      <PickerSheet
        visible={godownOpen}
        title={t('sr.review.goodsInto')}
        value={d.godownId ?? ''}
        options={[{ value: '', label: d.bill ? t('sr.review.billGodown') : t('sr.review.branchGodown') }, ...godowns.map((g) => ({ value: g.godownId, label: g.isDefault ? `${g.name} · ${t('sr.review.default')}` : g.name }))]}
        onPick={(v) => {
          dispatch(returnGodownSet(v || null));
          setGodownOpen(false);
        }}
        onClose={() => setGodownOpen(false)}
      />
      <CalendarDialog
        visible={calendar}
        value={parseDMY(d.usrRefdate)}
        today={today}
        onPick={(iso) => {
          dispatch(returnFieldsSet({ usrRefdate: toDMY(iso) }));
          setCalendar(false);
        }}
        onCancel={() => setCalendar(false)}
      />
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={st.between} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={[st.small, { flex: 1, fontSize: 13.5 }]}>{label}</Text>
      <Text style={{ fontSize: 13.5, color: colors.text }}>{value}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  ...returnStyles,
  held: { flexDirection: 'row', gap: 10, backgroundColor: '#F5F3FF', borderWidth: 1, borderColor: '#C4B5FD', borderRadius: radius.md + 2, padding: spacing.md },
  heldText: { flex: 1, fontSize: font.sm, lineHeight: 19, color: '#4C1D95' },
  creditCard: { gap: 5, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md + 2 },
  cardLabel: { fontSize: 12, fontWeight: '600', letterSpacing: 0.5, color: colors.textMuted },
  big: { fontSize: 26, fontWeight: '700', color: colors.text },
  link: { fontSize: font.sm, fontWeight: '600', color: colors.primary },
  linkBtn: { alignSelf: 'flex-start', minHeight: 36, justifyContent: 'center', marginLeft: 28 },
  h2: { fontSize: font.md, fontWeight: '600', color: colors.text, marginTop: 2 },
  option: { gap: 4, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.inputBorder, borderRadius: radius.md + 2, padding: spacing.md },
  optionOn: { borderColor: colors.primary, borderWidth: 2 },
  optionOff: { backgroundColor: '#F5F5F4' },
  optionHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  optionTitle: { fontSize: font.md, fontWeight: '600', color: colors.text },
  optionText: { fontSize: 12.5, lineHeight: 18, color: colors.textLabel, marginLeft: 28 },
  select: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 54, paddingHorizontal: spacing.md + 2, borderWidth: 1, borderColor: colors.inputBorder, borderRadius: radius.md + 2, backgroundColor: colors.surface },
  selectText: { fontSize: font.md, fontWeight: '600', color: colors.text },
  twoCols: { flexDirection: 'row', gap: spacing.sm },
  label: { fontSize: font.sm, fontWeight: '500', color: colors.textLabel },
  input: { minHeight: 46, borderWidth: 1, borderColor: colors.inputBorder, borderRadius: radius.md + 2, paddingHorizontal: spacing.md, fontSize: font.md, color: colors.text, backgroundColor: colors.surface },
  dateBox: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});
