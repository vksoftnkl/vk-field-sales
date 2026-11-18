import Ionicons from '@expo/vector-icons/Ionicons';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/screen-header';
import { Button, TextField } from '@/components/ui';
import { LocationCard, useLocate } from '@/features/orders/check-in-location';
import { fixFound, orderCleared } from '@/features/orders/order-draft';
import { companyQuery, customerName, orderCustomerQuery, saveVisit, VISIT_REASONS, type VisitReason } from '@/features/orders/queries';
import { store, useAppDispatch, useAppSelector } from '@/store';
import { colors, font, radius, spacing } from '@/theme';

const REMARKS_MAX = 500;

/**
 * No order (canvas 3b, step 2b; was "Check in (no order)"): why nothing was ordered, in English and
 * Tamil, mapped to VK Nex's six visit reasons, and remarks. The time and place are the visit's
 * check-in. Saved on the phone as a visit; the next Sync sends it.
 */
export default function NoOrderScreen() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const dispatch = useAppDispatch();
  const userId = useAppSelector((st) => st.session.session?.userId ?? '');
  const draft = useAppSelector((st) => st.orderDraft);
  const { data: found } = useLiveQuery(orderCustomerQuery(draft.customerId ?? ''), [draft.customerId]);
  const { data: company } = useLiveQuery(companyQuery(draft.companyId ?? ''), [draft.companyId]);
  const c = found[0];

  const { loc, locate } = useLocate(draft.checkIn?.fix ?? null);
  useEffect(() => {
    if (loc.kind === 'fix') dispatch(fixFound(loc.fix));
  }, [dispatch, loc]);

  const [reason, setReason] = useState<VisitReason | null>(null);
  const [remarks, setRemarks] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const saved = useRef(false);

  const write = () => {
    const d = store.getState().orderDraft;
    if (saved.current || !d.customerId || !reason) return;
    try {
      saveVisit(
        {
          customerId: d.customerId,
          companyId: d.companyId,
          reason,
          remarks,
          fix: loc.kind === 'fix' ? loc.fix : (d.checkIn?.fix ?? null),
          visitedAt: d.checkIn?.at,
          kind: 'order',
        },
        userId,
      );
      saved.current = true;
      // Cleared first, so Visit lets itself be closed without asking to discard.
      dispatch(orderCleared());
      requestAnimationFrame(() => {
        router.dismissTo('/customers');
        Alert.alert(t('checkIn.savedTitle'), t('checkIn.savedText'));
      });
    } catch {
      Alert.alert(t('common.error'));
    }
  };

  const save = () => {
    setSubmitted(true);
    if (saved.current || !reason || loc.kind === 'locating') return;
    const items = store.getState().orderDraft.lines.length;
    if (!items) return write();
    Alert.alert(t('so.noOrderDropTitle'), t('so.noOrderDropText', { count: items }), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('checkIn.save'), style: 'destructive', onPress: write },
    ]);
  };

  const other = i18n.language.startsWith('ta') ? 'en' : 'ta';
  const subtitle = [c ? customerName(c) : '', company[0]?.name ?? ''].filter(Boolean).join(' · ');

  return (
    <View style={st.root}>
      <ScreenHeader title={t('so.noOrder')} subtitle={subtitle} backLabel={t('so.backToVisit')} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView contentContainerStyle={st.body} keyboardShouldPersistTaps="handled">
          <LocationCard loc={loc} onRetry={() => void locate()} checkedInAt={draft.checkIn?.at} note={t('so.savedWithVisit')} />

          <View accessibilityRole="radiogroup" accessibilityLabel={t('so.whyNoOrder')} style={{ gap: 6 }}>
            <Text style={st.legend} accessibilityRole="header">
              {t('so.whyNoOrder')}
            </Text>
            {VISIT_REASONS.map((r) => {
              const on = reason === r;
              return (
                <Pressable key={r} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => setReason(r)} style={[st.reason, on && st.reasonOn]}>
                  <Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={20} color={on ? colors.primary : colors.inputBorder} />
                  <View style={{ flex: 1, gap: 1 }}>
                    <Text style={[st.reasonText, on && { fontWeight: '600' }]}>{t(`checkIn.reasons.${r}`)}</Text>
                    <Text style={st.reasonOther}>{i18n.t(`checkIn.reasons.${r}`, { lng: other })}</Text>
                  </View>
                </Pressable>
              );
            })}
            {submitted && !reason ? <Text style={st.error}>{t('checkIn.reasonRequired')}</Text> : null}
          </View>

          <View>
            <TextField
              label={t('so.remarksOptional')}
              value={remarks}
              onChangeText={setRemarks}
              multiline
              maxLength={REMARKS_MAX}
              style={st.remarks}
            />
            <Text style={st.counter}>{`${remarks.length} / ${REMARKS_MAX}`}</Text>
          </View>
        </ScrollView>
        <View style={[st.footer, { paddingBottom: insets.bottom + spacing.lg }]}>
          <View style={st.footNote}>
            <Ionicons name="phone-portrait-outline" size={14} color={colors.textMuted} />
            <Text style={st.footNoteText}>{t('so.visitWaits')}</Text>
          </View>
          <Button title={t('checkIn.save')} onPress={save} loading={loc.kind === 'locating'} style={{ height: 52 }} />
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { padding: spacing.lg, gap: spacing.md },
  legend: { fontSize: font.md, fontWeight: '600', color: colors.text, marginBottom: spacing.xs },
  reason: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 56,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md + 2,
    paddingVertical: 6,
    paddingHorizontal: spacing.md + 2,
  },
  reasonOn: { backgroundColor: '#F6E9E9', borderWidth: 2, borderColor: colors.primary },
  reasonText: { fontSize: font.md, color: colors.text },
  reasonOther: { fontSize: font.sm, color: colors.textMuted },
  error: { fontSize: font.sm, color: colors.danger },
  remarks: { minHeight: 72, textAlignVertical: 'top', paddingTop: spacing.md },
  counter: { alignSelf: 'flex-end', marginTop: -spacing.xs, fontSize: 12, color: colors.textMuted },
  footer: { gap: spacing.sm, paddingTop: spacing.md, paddingHorizontal: spacing.lg, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
  footNote: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  footNoteText: { flex: 1, fontSize: 12, color: colors.textMuted },
});
