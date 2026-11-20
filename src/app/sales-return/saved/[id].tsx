import Ionicons from '@expo/vector-icons/Ionicons';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useDateNames } from '@/components/use-date-names';
import { hhmm } from '@/features/orders/order-status';
import { companyQuery } from '@/features/orders/queries';
import { returnSlipLines } from '@/features/returns/return-slip';
import { returnStyles } from '@/features/returns/return-styles';
import { returnItemsQuery, returnRowQuery } from '@/features/returns/queries';
import { formatDay } from '@/lib/date-range';
import { formatAmount } from '@/lib/money';
import { useAppSelector } from '@/store';
import { colors, font, radius, spacing } from '@/theme';

/**
 * Saved, step 5b (canvas 6b): the return slip. It says plainly that it is not a credit note yet:
 * VK Nex gives the SRT number and the final amount after Sync. Share sends it as text (WhatsApp
 * and other apps); printing comes with the printer setup.
 */
export default function ReturnSavedScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const names = useDateNames();
  const salesman = useAppSelector((st) => st.session.session?.username ?? '');
  const { data: head } = useLiveQuery(returnRowQuery(id), [id]);
  const { data: items } = useLiveQuery(returnItemsQuery(id), [id]);
  const h = head[0];
  const { data: company } = useLiveQuery(companyQuery(h?.srCompanyId ?? ''), [h?.srCompanyId]);
  const slip = h ? returnSlipLines(h, items, { t, names, company: company[0]?.name ?? '', salesman }) : null;

  const share = () => {
    if (slip) void Share.share({ message: slip.text }).catch(() => Alert.alert(t('common.error')));
  };

  return (
    <View style={st.root}>
      <View style={[st.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('sr.saved.close')} onPress={() => router.back()} style={st.close}>
          <Ionicons name="close" size={24} color={colors.onPrimary} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={st.title} accessibilityRole="header">
            {t('sr.saved.title')}
          </Text>
          <Text style={st.subtitle}>{t('sr.saved.subtitle')}</Text>
        </View>
      </View>
      {h && slip ? (
        <ScrollView contentContainerStyle={[st.body, { paddingBottom: insets.bottom + spacing.xl }]}>
          <View style={st.ok} accessibilityRole="alert">
            <Ionicons name="checkmark-circle" size={20} color="#14532D" />
            <Text style={st.okText}>{t('sr.saved.done')}</Text>
          </View>
          <View style={st.slip}>
            <Text style={st.company}>{company[0]?.name ?? ''}</Text>
            <Text style={st.kind}>{t('sr.saved.kind')}</Text>
            <View style={st.rule} />
            <Line label={t('sr.saved.phoneRef')} value={h.srReturnRefno} strong />
            <Line label={t('sr.saved.date')} value={`${formatDay(h.srReturnDate, names)}, ${hhmm(h.srReturnDatetime)}`} />
            <Line label={t('sr.saved.shop')} value={h.srCustName} />
            <Line label={t('sr.saved.against')} value={h.appBillRefno ? `${h.appBillRefno}${h.appBillDate ? ` · ${formatDay(h.appBillDate, names).replace(/ \d{4}$/, '')}` : ''}` : t('sr.items.noBill')} />
            {h.srReturnReason ? <Line label={t('sr.saved.reason')} value={h.srReturnReason} /> : null}
            <View style={st.rule} />
            {slip.lines.map((l) => (
              <Line key={l.key} label={l.label} value={l.amount} />
            ))}
            {h.srRoundOff !== '0.00' ? <Line label={t('sr.review.roundOff')} value={formatAmount(Math.round(Number(h.srRoundOff) * 100))} muted /> : null}
            <View style={st.rule} />
            <View style={st.between}>
              <Text style={st.totalText}>{t('sr.saved.about')}</Text>
              <Text style={st.totalText}>{formatAmount(Math.round(Number(h.srReturnAmt) * 100))}</Text>
            </View>
            <Text style={st.note}>{slip.settleText}</Text>
            <Text style={st.small}>{t('sr.saved.by', { name: salesman })}</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Pressable accessibilityRole="button" onPress={share} style={[st.btn, st.btnMain]}>
              <Text style={st.btnMainText}>{t('sr.saved.share')}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/returns', params: { customerId: h.srCustId } })} style={st.btn}>
              <Text style={st.btnText}>{t('sr.saved.list')}</Text>
            </Pressable>
          </View>
          <Text style={[st.hint, { textAlign: 'center' }]}>{t('sr.saved.editHint')}</Text>
          <Pressable accessibilityRole="button" onPress={() => router.back()} style={st.done}>
            <Text style={st.doneText}>{t('sr.saved.doneBtn')}</Text>
          </Pressable>
        </ScrollView>
      ) : null}
    </View>
  );
}

function Line({ label, value, strong, muted }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <View style={st.between} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={[st.lineLabel, muted && { color: colors.textMuted }]}>{label}</Text>
      <Text style={[st.lineValue, strong && { fontWeight: '700' }, muted && { color: colors.textMuted }]}>{value}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  ...returnStyles,
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: colors.primary, paddingLeft: spacing.sm, paddingRight: spacing.md, paddingBottom: spacing.md + 2 },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 19, fontWeight: '600', color: colors.onPrimary },
  subtitle: { marginTop: 2, fontSize: font.sm, color: colors.onPrimaryMuted },
  ok: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#F0FDF4', borderWidth: 1, borderColor: '#86EFAC', borderRadius: radius.md + 2, padding: spacing.md },
  okText: { flex: 1, fontSize: 14, color: '#14532D' },
  slip: { gap: 8, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg },
  company: { textAlign: 'center', fontSize: font.md, fontWeight: '700', color: colors.text },
  kind: { textAlign: 'center', fontSize: 12, fontWeight: '600', letterSpacing: 0.6, color: colors.textMuted },
  rule: { borderTopWidth: 1, borderStyle: 'dashed', borderColor: colors.inputBorder },
  lineLabel: { flex: 1, fontSize: 13.5, color: colors.textLabel },
  lineValue: { fontSize: 13.5, color: colors.text, textAlign: 'right', flexShrink: 1 },
  totalText: { fontSize: 16, fontWeight: '700', color: colors.text },
  note: { fontSize: 12.5, lineHeight: 18, color: colors.textLabel },
  btn: { flex: 1, minHeight: 48, borderRadius: radius.md + 2, borderWidth: 1, borderColor: colors.inputBorder, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  btnMain: { borderColor: colors.primary },
  btnMainText: { fontSize: font.md, fontWeight: '600', color: colors.primary },
  btnText: { fontSize: font.md, fontWeight: '600', color: colors.textLabel },
  done: { minHeight: 52, borderRadius: radius.md + 2, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: spacing.sm },
  doneText: { fontSize: font.md, fontWeight: '600', color: colors.onPrimary },
});
