import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/screen-header';
import { useDateNames } from '@/components/use-date-names';
import { num, qtyText } from '@/features/orders/order-math';
import { useStopText } from '@/features/orders/use-send-now';
import { companyQuery } from '@/features/orders/queries';
import { returnLoaded } from '@/features/returns/return-draft';
import { useSendReturns } from '@/features/returns/return-parts';
import { noteOf, returnSlipLines } from '@/features/returns/return-slip';
import { returnStyles, STATUS_TONES } from '@/features/returns/return-styles';
import { deleteLocalReturn, draftOfSaved, queueReturnAgain, returnItemsQuery, returnRowQuery } from '@/features/returns/queries';
import { formatDay } from '@/lib/date-range';
import { formatAmount } from '@/lib/money';
import { useAppDispatch, useAppSelector } from '@/store';
import { deleteReturnOnServer } from '@/sync/run-sync';
import { colors, font, radius, spacing } from '@/theme';

const paise = (v: string | number | null | undefined) => Math.round(num(v === null || v === undefined ? '' : String(v)) * 100);

/**
 * Return detail, steps 6b and 9 (canvas 6b): one return as it stands. Waiting: edit or delete
 * until it is sent. With the office: VK Nex holds it as a draft for an approver (nothing to do
 * here). Sent back: VK Nex's words and code, what to do, then Edit, Send again (into the same
 * draft) or Delete (the draft goes from VK Nex too). Posted: VK Nex's number and credit note beside
 * the phone's estimate, the bills it was set against and the stock it took back. Posted returns
 * change only in the office.
 */
export default function ReturnDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const names = useDateNames();
  const dispatch = useAppDispatch();
  const stopText = useStopText();
  const salesman = useAppSelector((st) => st.session.session?.username ?? '');
  const { data: head } = useLiveQuery(returnRowQuery(id), [id]);
  const { data: items } = useLiveQuery(returnItemsQuery(id), [id]);
  const h = head[0];
  const { data: company } = useLiveQuery(companyQuery(h?.srCompanyId ?? ''), [h?.srCompanyId]);
  const { sending, result, send } = useSendReturns();
  const [deleting, setDeleting] = useState(false);

  if (!h) {
    return (
      <View style={st.root}>
        <ScreenHeader title={t('sr.detail.title')} backLabel={t('sr.back')} />
        <Text style={st.empty}>{t('sr.detail.gone')}</Text>
      </View>
    );
  }

  const status = h.appStatus;
  const tone = STATUS_TONES[status] ?? STATUS_TONES.WAITING!;
  const note = noteOf(h.appVkNote);
  const approval = h.appApproval ? (JSON.parse(h.appApproval) as { status?: string; note?: string | null }) : null;
  const settle = h.appVkSettle ? (JSON.parse(h.appVkSettle) as { credited?: string | number; settleStatus?: string; adjusted?: { refno?: string; amount: string | number }[] }) : null;
  const totals = h.appVkTotals ? (JSON.parse(h.appVkTotals) as { goods?: string | number; tax?: string | number; chargesNet?: string | number; roundOff?: string | number; creditNote?: string | number }) : null;
  const posted = status === 'POSTED';
  const vkAmt = h.appVkAmt ? paise(h.appVkAmt) : null;
  const estimate = paise(h.srReturnAmt);
  const slip = returnSlipLines(h, items, { t, names, company: company[0]?.name ?? '', salesman });
  const good = items.filter((i) => i.item.sriCondition === 'RESTOCK').reduce((s, i) => s + num(i.item.sriReturnQty), 0);
  const other = items.filter((i) => i.item.sriCondition !== 'RESTOCK').reduce((s, i) => s + num(i.item.sriReturnQty), 0);

  const edit = () => {
    const draft = draftOfSaved(h.srId);
    if (!draft) return Alert.alert(t('sr.review.notEditable'));
    dispatch(returnLoaded(draft));
    router.push('/sales-return/items');
  };
  const remove = () =>
    Alert.alert(t('sr.detail.deleteTitle'), status === 'SENT_BACK' ? t('sr.detail.deleteSentBack') : t('sr.detail.deleteText'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('sr.detail.delete'),
        style: 'destructive',
        onPress: async () => {
          setDeleting(true);
          try {
            if (status === 'SENT_BACK') await deleteReturnOnServer(h.srId, h.srCompanyId);
            else deleteLocalReturn(h.srId);
            router.back();
          } catch (e) {
            Alert.alert(t('common.error'), stopText(e));
          } finally {
            setDeleting(false);
          }
        },
      },
    ]);
  const sendAgain = () => {
    queueReturnAgain(h.srId);
    void send();
  };
  const share = () => void Share.share({ message: slip.text }).catch(() => Alert.alert(t('common.error')));

  return (
    <View style={st.root}>
      <ScreenHeader title={h.appVkRefno ?? h.srReturnRefno} subtitle={[h.appVkRefno ? t('sr.detail.phoneRef', { no: h.srReturnRefno }) : null, h.srCustName].filter(Boolean).join(' · ')} backLabel={t('sr.back')} />
      <ScrollView contentContainerStyle={[st.body, { paddingBottom: insets.bottom + spacing.xl }]}>
        <Text style={[st.status, { backgroundColor: tone.bg, color: tone.fg }]}>{t(`sr.status.${status}`)}</Text>

        {status === 'SENT_BACK' ? (
          <View style={[st.box, st.boxBack]} accessibilityRole="alert">
            <View style={st.between}>
              <Text style={[st.boxTitle, { color: '#991B1B' }]}>{t('sr.detail.sentBackTitle')}</Text>
              {note?.code ? <Text style={[st.code, { color: '#991B1B', borderColor: '#FCA5A5' }]}>{note.code}</Text> : null}
            </View>
            <Text style={st.boxText}>{note?.user?.line ?? (note?.message ? `“${note.message}”` : (h.appSyncError ?? ''))}</Text>
            {note?.user?.line && note.message ? <Text style={st.boxSmall}>{`“${note.message}”`}</Text> : null}
            {note?.user?.todo ? <Text style={[st.boxSmall, { fontWeight: '600' }]}>{note.user.todo}</Text> : null}
            <Text style={st.boxSmall}>{t('sr.detail.sentBackWhat')}</Text>
          </View>
        ) : null}
        {status === 'HELD' ? (
          <View style={[st.box, st.boxHeld]}>
            <View style={st.between}>
              <Text style={[st.boxTitle, { color: '#5B21B6' }]}>{t('sr.detail.heldTitle')}</Text>
              {note?.code ? <Text style={[st.code, { color: '#5B21B6', borderColor: '#C4B5FD' }]}>{note.code}</Text> : null}
            </View>
            {note?.user?.line || note?.message ? <Text style={st.boxText}>{note.user?.line ?? `“${note.message}”`}</Text> : null}
            {approval?.status ? <Text style={[st.boxSmall, { fontWeight: '600' }]}>{t('sr.detail.approval', { status: approval.status, note: approval.note ?? '' })}</Text> : null}
            <Text style={st.boxSmall}>{t('sr.detail.heldWhat')}</Text>
            {h.appVkRefno ? <Text style={st.boxSmall}>{t('sr.detail.draftNo', { no: h.appVkRefno })}</Text> : null}
          </View>
        ) : null}
        {status === 'WAITING' ? (
          <View style={[st.box, st.boxWait]}>
            <Text style={[st.boxTitle, { color: '#92400E' }]}>{t('sr.detail.waitingTitle')}</Text>
            <Text style={st.boxSmall}>{h.appSyncError && h.appSyncError.startsWith('SEND_TRIED') ? t('sr.detail.sendTried') : t('sr.detail.waitingText')}</Text>
          </View>
        ) : null}
        {status === 'CANCELLED' ? (
          <View style={[st.box, st.boxGrey]}>
            <Text style={st.boxTitle}>{t('sr.detail.cancelledTitle')}</Text>
            <Text style={st.boxSmall}>
              {[h.appCancelledOn ? formatDay(h.appCancelledOn.slice(0, 10), names) : null, note?.code === 'MOBILE_RETURN_DELETED' ? t('sr.detail.deletedInOffice') : h.appCancelReason].filter(Boolean).join(' · ')}
            </Text>
          </View>
        ) : null}
        {status === 'OLD' ? (
          <View style={[st.box, st.boxGrey]}>
            <Text style={st.boxTitle}>{t('sr.detail.oldTitle')}</Text>
            <Text style={st.boxSmall}>{t('sr.detail.oldText')}</Text>
          </View>
        ) : null}
        {result ? <Text style={[st.small, !result.ok && { color: colors.danger }]}>{result.text}</Text> : null}

        <View style={st.card}>
          <Text style={st.cardLabel}>{posted ? t('sr.detail.fromVk') : t('sr.review.creditEstimate')}</Text>
          <Text style={st.big}>{formatAmount(posted && vkAmt !== null ? vkAmt : estimate)}</Text>
          {posted && totals ? (
            <>
              <Row label={t('sr.review.goods')} value={formatAmount(paise(totals.goods))} />
              <Row label={t('sr.detail.gst')} value={formatAmount(paise(totals.tax))} />
              {paise(totals.chargesNet) !== 0 ? <Row label={t('sr.detail.charges')} value={formatAmount(paise(totals.chargesNet))} /> : null}
              {paise(totals.roundOff) !== 0 ? <Row label={t('sr.review.roundOff')} value={formatAmount(paise(totals.roundOff))} /> : null}
            </>
          ) : (
            <>
              <Row label={t('sr.review.goods')} value={formatAmount(paise(h.srTaxableAmt))} />
              <Row label={t('sr.detail.gst')} value={formatAmount(paise(h.srTaxAmt))} />
              {paise(h.srRoundOff) !== 0 ? <Row label={t('sr.review.roundOff')} value={formatAmount(paise(h.srRoundOff))} /> : null}
            </>
          )}
          {posted && vkAmt !== null && vkAmt !== estimate ? <Text style={st.diff}>{t('sr.detail.estimateWas', { amount: formatAmount(estimate) })}</Text> : null}
        </View>

        <View style={st.linesCard}>
          {slip.lines.map((l) => (
            <View key={l.key} style={[st.between, st.lineRow]}>
              <Text style={[st.lineText, { flex: 1 }]}>{l.label}</Text>
              <Text style={st.lineText}>{l.amount}</Text>
            </View>
          ))}
        </View>

        <View style={st.card}>
          <Text style={st.boxTitle}>{posted ? t('sr.detail.howSettled') : t('sr.detail.howItWill')}</Text>
          {posted && settle?.adjusted?.length
            ? settle.adjusted.map((a, i) => <Row key={i} label={t('sr.detail.adjustedTo', { bill: a.refno ?? '' })} value={formatAmount(paise(a.amount))} />)
            : null}
          {posted && settle && paise(settle.credited) > 0 ? <Row label={t('sr.detail.creditHeld')} value={formatAmount(paise(settle.credited))} /> : null}
          {!posted ? <Text style={st.small}>{slip.settleText}</Text> : null}
          <Row label={t('sr.detail.goodsBack')} value={t('sr.list.qty', { good: qtyText(good), other: qtyText(other) })} />
          <Row label={t('sr.saved.reason')} value={h.srReturnReason ?? '—'} />
          <Row label={t('sr.saved.against')} value={h.appBillRefno ? `${h.appBillRefno}${h.appBillDate ? ` · ${formatDay(h.appBillDate, names).replace(/ \d{4}$/, '')}` : ''}` : t('sr.items.noBill')} />
          {h.srUsrRefno ? <Row label={t('sr.review.debitNote')} value={h.srUsrRefno} /> : null}
        </View>
        <Text style={st.hint}>{posted || status === 'CANCELLED' ? t('sr.detail.officeOnly') : t('sr.detail.updates')}</Text>

        <View style={st.actions}>
          {status === 'WAITING' || status === 'SENT_BACK' || status === 'OLD' ? (
            <Pressable accessibilityRole="button" disabled={deleting} onPress={remove} style={[st.btn, st.btnDanger]}>
              {deleting ? <ActivityIndicator color={colors.danger} /> : <Text style={st.btnDangerText}>{t('sr.detail.delete')}</Text>}
            </Pressable>
          ) : null}
          {status === 'WAITING' || status === 'SENT_BACK' ? (
            <Pressable accessibilityRole="button" onPress={edit} style={[st.btn, st.btnOutline]}>
              <Text style={st.btnOutlineText}>{t('sr.detail.edit')}</Text>
            </Pressable>
          ) : null}
          {status === 'SENT_BACK' ? (
            <Pressable accessibilityRole="button" disabled={sending} onPress={sendAgain} style={[st.btn, st.btnMain]}>
              {sending ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={st.btnMainText}>{t('sr.detail.sendAgain')}</Text>}
            </Pressable>
          ) : status === 'WAITING' ? (
            <Pressable accessibilityRole="button" disabled={sending} onPress={() => void send()} style={[st.btn, st.btnMain]}>
              {sending ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={st.btnMainText}>{t('so.sendNow')}</Text>}
            </Pressable>
          ) : status !== 'OLD' ? (
            <Pressable accessibilityRole="button" onPress={share} style={[st.btn, st.btnOutline]}>
              <Text style={st.btnOutlineText}>{posted ? t('sr.detail.shareCredit') : t('sr.saved.share')}</Text>
            </Pressable>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={st.between} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={[st.small, { flex: 1, fontSize: 13.5 }]}>{label}</Text>
      <Text style={{ fontSize: 13.5, color: colors.text, textAlign: 'right', flexShrink: 1 }}>{value}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  ...returnStyles,
  empty: { textAlign: 'center', fontSize: font.md, color: colors.textMuted, padding: spacing.xl },
  status: { alignSelf: 'flex-start', fontSize: 12, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, overflow: 'hidden' },
  box: { gap: 6, borderWidth: 1, borderRadius: radius.lg, padding: spacing.md + 2 },
  boxBack: { backgroundColor: '#FEF2F2', borderColor: '#FCA5A5' },
  boxHeld: { backgroundColor: '#F5F3FF', borderColor: '#C4B5FD' },
  boxWait: { backgroundColor: '#FFFBEB', borderColor: '#FCD34D' },
  boxGrey: { backgroundColor: '#F5F5F4', borderColor: colors.border },
  boxTitle: { fontSize: 15, fontWeight: '700', color: colors.text, flexShrink: 1 },
  boxText: { fontSize: 14, lineHeight: 21, color: colors.text },
  boxSmall: { fontSize: 13, lineHeight: 20, color: colors.textLabel },
  code: { fontSize: 11.5, fontWeight: '600', borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, backgroundColor: colors.surface, overflow: 'hidden' },
  card: { gap: 6, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md + 2 },
  cardLabel: { fontSize: 12, fontWeight: '600', letterSpacing: 0.5, color: colors.textMuted },
  big: { fontSize: 26, fontWeight: '700', color: colors.text },
  diff: { fontSize: 12.5, color: '#92400E', backgroundColor: '#FFFBEB', borderRadius: 8, padding: 6, overflow: 'hidden' },
  linesCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md + 2 },
  lineRow: { paddingVertical: 10, paddingHorizontal: spacing.md + 2, borderBottomWidth: 1, borderBottomColor: '#F1EDE4' },
  lineText: { fontSize: 13.5, color: colors.text },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  btn: { minHeight: 52, borderRadius: radius.md + 2, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  btnMain: { flex: 1, backgroundColor: colors.primary },
  btnMainText: { fontSize: font.md, fontWeight: '600', color: colors.onPrimary },
  btnOutline: { flex: 1, borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.surface },
  btnOutlineText: { fontSize: font.md, fontWeight: '600', color: colors.primary },
  btnDanger: { borderWidth: 1, borderColor: '#FCA5A5', backgroundColor: colors.surface },
  btnDangerText: { fontSize: 14, fontWeight: '600', color: colors.danger },
});
