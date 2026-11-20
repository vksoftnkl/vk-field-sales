import { router, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/screen-header';
import { Button } from '@/components/ui';
import { useDateNames } from '@/components/use-date-names';
import { asOfText, hhmm } from '@/features/orders/order-status';
import { deleteReceipt, receiptDraftFor } from '@/features/receipts/queries';
import { receiptLoaded } from '@/features/receipts/receipt-draft';
import { parseAdjusted, parsePdc, RC_TONES, receiptSendTried, refusalHint, splitRefusal } from '@/features/receipts/receipt-status';
import { slipText, useSlip } from '@/features/receipts/receipt-slip';
import { useSendReceipts } from '@/features/receipts/use-send-receipts';
import { formatDay } from '@/lib/date-range';
import { formatAmount } from '@/lib/money';
import { useAppDispatch } from '@/store';
import { colors, font, radius, spacing } from '@/theme';

/**
 * Receipt detail (canvas 5b, steps 6b and 9): one of this phone's receipts and where it stands.
 * Posted: VK Nex's number, each post-dated cheque's own voucher, what VK Nex changed at Sync, and
 * the bills as it really settled them; changes and cancelling are done in the office (D12).
 * Waiting or sent back: VK Nex's words and code with what to do, and Edit, Delete or Send again.
 */
export default function ReceiptDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const names = useDateNames();
  const dispatch = useAppDispatch();
  const { slip, loaded, raw } = useSlip(id);
  const { sending, result, send } = useSendReceipts();
  const r = raw.r;
  const adjusted = useMemo(() => parseAdjusted(r?.appAdjusted), [r?.appAdjusted]);
  const pdc = useMemo(() => parsePdc(r?.appPdc), [r?.appPdc]);

  if (!slip || !r) {
    return (
      <View style={st.root}>
        <ScreenHeader title={t('receipt.detailTitle')} backLabel={t('receipt.back')} />
        <Text style={st.gone}>{loaded ? t('receipt.gone') : ''}</Text>
      </View>
    );
  }

  const state = slip.state;
  const tone = RC_TONES[state];
  const refusal = splitRefusal(r.appSyncError);
  const syncAt = r.appSyncedOn ? asOfText(r.appSyncedOn, names, t('so.today')) : null;
  const pending = state === 'waiting' || state === 'sentBack';
  // Sent once without an answer: VK Nex may have it, so it is not changed here until a Sync settles it.
  const tried = receiptSendTried(r.appSyncError);
  const changeable = pending && !tried && !sending;
  const bills = slip.bills.filter((b) => b.kind === 'BILL');
  const credits = slip.bills.filter((b) => b.kind === 'CREDIT');

  const share = () => void Share.share({ message: slipText(slip, t, names) }).catch(() => Alert.alert(t('common.error')));
  const edit = () => {
    if (!changeable) return;
    const d = receiptDraftFor(id);
    if (!d || !d.customerId || !d.companyId) return;
    dispatch(receiptLoaded(d));
    router.push({ pathname: '/receipt/[customerId]', params: { customerId: d.customerId, companyId: d.companyId } });
  };
  const remove = () =>
    changeable &&
    Alert.alert(t('receipt.deleteTitle'), t('receipt.deleteText', { no: slip.phoneNo, amount: formatAmount(slip.totalPaise) }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('receipt.delete'),
        style: 'destructive',
        onPress: () => {
          deleteReceipt(id);
          router.back();
        },
      },
    ]);

  return (
    <View style={st.root}>
      <ScreenHeader title={slip.voucherNo ?? slip.phoneNo} subtitle={`${slip.customerName} · ${formatAmount(slip.totalPaise)}`} backLabel={t('receipt.back')} />
      <ScrollView contentContainerStyle={st.body}>
        <View style={[st.status, { backgroundColor: tone.bg }]}>
          <Text style={[st.statusTitle, { color: tone.fg }]}>{t(`receipt.stateLong.${state}`)}</Text>
          {state === 'posted' && syncAt ? <Text style={[st.statusText, { color: tone.fg }]}>{t('receipt.syncAt', { when: syncAt })}</Text> : null}
          {state === 'waiting' && r.appSyncError ? (
            <Text style={[st.statusText, { color: tone.fg }]}>{tried ? t('receipt.triedNote') : t('receipt.waitsForCustomer')}</Text>
          ) : null}
          {state === 'sentBack' ? (
            <>
              <Text style={[st.statusText, { color: tone.fg }]}>{refusal.message}</Text>
              {refusal.code ? <Text style={[st.small, { color: tone.fg }]}>{t('receipt.code', { code: refusal.code })}</Text> : null}
            </>
          ) : null}
          {state === 'cancelled' ? (
            <Text style={[st.statusText, { color: tone.fg }]}>
              {[r.appCancelledOn ? formatDay(r.appCancelledOn.slice(0, 10), names) : null, r.appCancelReason].filter(Boolean).join(' · ')}
            </Text>
          ) : null}
        </View>

        {state === 'sentBack' ? (
          <View style={st.card}>
            <Text style={st.section}>{t('receipt.whatToDo')}</Text>
            <Text style={st.text}>{t(`receipt.hints.${refusalHint(refusal.code)}`)}</Text>
          </View>
        ) : null}

        <View style={st.card}>
          {slip.voucherNo ? <Pair label={t('receipt.slip.phoneNo')} value={slip.phoneNo} /> : null}
          <Pair label={t('receipt.receiptDate')} value={`${formatDay(slip.createdOn.slice(0, 10), names)}, ${hhmm(slip.createdOn)}`} />
          {slip.docRefno ? <Pair label={t('receipt.slip.shopNo')} value={slip.docRefno} /> : null}
          <View style={st.rule} />
          {slip.lines.map((l, i) => (
            <Pair key={i} label={[l.name, l.details].filter(Boolean).join(' · ')} value={formatAmount(l.amountPaise)} />
          ))}
          {slip.surcharges.map((f, i) => (
            <Pair key={`fee${i}`} label={t('receipt.surchargeOf', { name: f.name })} value={formatAmount(f.paise)} />
          ))}
          <Pair label={t('receipt.slip.total')} value={formatAmount(slip.totalPaise)} strong />
          {pdc.map((p) => (
            <View key={p.voucherId} style={st.pdc}>
              <Text style={st.pdcTitle}>{t('receipt.pdcVoucher', { no: p.voucherRefno ?? '' })}</Text>
              <Text style={st.small}>
                {t(`receipt.pdcState.${p.status === 'CLEARED' || p.status === 'BOUNCED' || p.status === 'CANCELLED' ? p.status : 'HELD'}`, { date: formatDay(p.chequeDate, names), amount: formatAmount(p.amountPaise) })}
              </Text>
            </View>
          ))}
        </View>

        {adjusted.length ? (
          <View style={[st.card, { borderColor: '#FCD34D', backgroundColor: '#FFFBEB' }]}>
            {adjusted.map((a, i) => (
              <Text key={i} style={st.text}>
                {t(`receipt.syncChanges.${['BILL_SETTLED', 'BILL_REDUCED', 'CREDIT_REDUCED', 'PDC_ON_CLEARING'].includes(a.reason) ? a.reason : 'OTHER'}`, {
                  bill: a.docRefno ?? '',
                  planned: formatAmount(a.plannedPaise),
                  applied: formatAmount(a.appliedPaise),
                })}
              </Text>
            ))}
          </View>
        ) : null}

        {bills.length || credits.length ? (
          <>
            <Text style={st.section} accessibilityRole="header">
              {slip.posted ? t('receipt.asApplied') : t('receipt.asPlanned')}
            </Text>
            <View style={st.card}>
              {credits.map((b) => (
                <Pair key={b.key} label={t('receipt.creditUsedOn', { no: b.docRefno })} value={formatAmount(b.settledPaise)} />
              ))}
              {bills.map((b) => (
                <View key={b.key} style={{ gap: 1 }}>
                  <Pair label={b.docRefno} value={formatAmount(b.settledPaise)} />
                  {b.creditPaise + b.discountPaise + b.roundoffPaise > 0 ? (
                    <Text style={st.small}>
                      {[
                        b.creditPaise ? t('receipt.partCredits', { amount: formatAmount(b.creditPaise) }) : null,
                        b.discountPaise ? t('receipt.partDiscount', { amount: formatAmount(b.discountPaise) }) : null,
                        b.roundoffPaise ? t('receipt.partRoundoff', { amount: formatAmount(b.roundoffPaise) }) : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                  ) : null}
                </View>
              ))}
              {slip.onAccountPaise !== null ? (
                <>
                  <View style={st.rule} />
                  <Pair label={t('receipt.leftOnAccount')} value={formatAmount(slip.onAccountPaise)} />
                </>
              ) : null}
            </View>
          </>
        ) : !slip.posted && slip.onAccountPaise === null ? (
          <Text style={st.small}>{t('receipt.oldStyle')}</Text>
        ) : null}

        {slip.remarks ? <Text style={st.text}>{slip.remarks}</Text> : null}
        {state === 'sentBack' ? <Text style={st.small}>{t('receipt.sentBackNote')}</Text> : null}
        <Text style={st.small}>{pending ? t('receipt.pendingNote') : t('receipt.officeNote')}</Text>
        {result ? (
          <Text style={[st.small, !result.ok && { color: colors.danger }]} accessibilityLiveRegion="polite">
            {result.text}
          </Text>
        ) : null}
      </ScrollView>

      <View style={[st.footer, { paddingBottom: insets.bottom + spacing.lg }]}>
        {pending ? (
          <View style={st.btnRow}>
            <Button title={t('receipt.delete')} variant="outline" onPress={remove} disabled={!changeable} style={{ flex: 1, height: 48 }} />
            <Button title={t('receipt.edit')} variant="outline" onPress={edit} disabled={!changeable} style={{ flex: 1, height: 48 }} />
          </View>
        ) : null}
        <View style={st.btnRow}>
          <Button title={t('receipt.share')} variant={pending ? 'outline' : 'primary'} onPress={share} style={{ flex: 1, height: 52 }} />
          {pending ? <Button title={state === 'sentBack' ? t('receipt.sendAgain') : t('so.sendNow')} onPress={() => void send()} loading={sending} style={{ flex: 1, height: 52 }} /> : null}
        </View>
      </View>
    </View>
  );
}

function Pair({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={st.pair}>
      <Text style={[st.pairLabel, strong && { fontWeight: '700', color: colors.text }]}>{label}</Text>
      <Text style={[st.pairValue, strong && { fontWeight: '700' }]}>{value}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { padding: spacing.lg, gap: spacing.md },
  gone: { padding: spacing.xl, textAlign: 'center', fontSize: font.md, color: colors.textMuted },
  status: { borderRadius: radius.lg, padding: spacing.md + 2, gap: 4 },
  statusTitle: { fontSize: font.md, fontWeight: '700' },
  statusText: { fontSize: font.sm },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md + 2, gap: 7 },
  section: { fontSize: font.md, fontWeight: '600', color: colors.text },
  text: { fontSize: font.sm, color: colors.text, lineHeight: 20 },
  small: { fontSize: 12.5, color: colors.textMuted, lineHeight: 18 },
  rule: { height: 1, backgroundColor: colors.border },
  pair: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  pairLabel: { fontSize: font.sm, color: colors.textLabel, flexShrink: 1 },
  pairValue: { fontSize: font.sm, fontWeight: '600', color: colors.text },
  pdc: { backgroundColor: '#EFF6FF', borderRadius: radius.md, padding: spacing.sm + 2, gap: 2 },
  pdcTitle: { fontSize: font.sm, fontWeight: '600', color: '#1E40AF' },
  footer: { paddingTop: spacing.md, paddingHorizontal: spacing.lg, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border, gap: spacing.sm },
  btnRow: { flexDirection: 'row', gap: spacing.sm },
});
