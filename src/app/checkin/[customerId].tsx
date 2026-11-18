import Ionicons from '@expo/vector-icons/Ionicons';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/screen-header';
import { Button, TextField } from '@/components/ui';
import { currentCompanyQuery } from '@/features/company/company';
import { LocationCard, useLocate } from '@/features/orders/check-in-location';
import { COLLECTION_REASONS, customerName, orderCustomerQuery, saveVisit, VISIT_REASONS, type VisitReason } from '@/features/orders/queries';
import { useAppSelector } from '@/store';
import { colors, font, radius, spacing } from '@/theme';

/**
 * Check in · no order (the Qt app's OrderCheckin.qml), or · no collection (ReceiptCheckin.qml,
 * opened with kind=collection from Receipt): why nothing was taken, remarks, and where the
 * salesman was (the Qt app switched GPS on but never kept the place). Saved on the phone; the
 * next Sync sends it to VK Nex.
 */
export default function CheckInScreen() {
  const { customerId, kind, companyId: forCompany } = useLocalSearchParams<{ customerId: string; kind?: string; companyId?: string }>();
  const collection = kind === 'collection';
  const reasons = collection ? COLLECTION_REASONS : VISIT_REASONS;
  const reasonKey = (r: VisitReason) => (collection ? `checkIn.collectionReasons.${r}` : `checkIn.reasons.${r}`);
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const userId = useAppSelector((st) => st.session.session?.userId ?? '');
  const { data: found } = useLiveQuery(orderCustomerQuery(customerId), [customerId]);
  const c = found[0];

  const { loc, locate } = useLocate();
  const [reason, setReason] = useState<VisitReason | null>(null);
  const [remarks, setRemarks] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const saved = useRef(false);

  const save = () => {
    setSubmitted(true);
    if (saved.current || !reason || loc.kind === 'locating') return;
    try {
      // The receipt's company, else the one chosen in Choose company (else Sync picks it at upload).
      const companyId = forCompany ?? currentCompanyQuery().get()?.id ?? null;
      saveVisit({ customerId, companyId, reason, remarks, fix: loc.kind === 'fix' ? loc.fix : null, kind: collection ? 'collection' : 'order' }, userId);
      saved.current = true;
      // A no-collection visit ends the receipt too: back to the customer.
      if (collection) router.dismissTo({ pathname: '/customer/[id]', params: { id: customerId } });
      else router.back();
      Alert.alert(t('checkIn.savedTitle'), t('checkIn.savedText'));
    } catch {
      Alert.alert(t('common.error'));
    }
  };

  const other = i18n.language.startsWith('ta') ? 'en' : 'ta';

  return (
    <View style={st.root}>
      <ScreenHeader title={collection ? t('checkIn.collectionTitle') : t('checkIn.title')} subtitle={c ? customerName(c) : undefined} backLabel={collection ? t('receipt.back') : t('checkIn.back')} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView contentContainerStyle={st.body} keyboardShouldPersistTaps="handled">
          <LocationCard loc={loc} onRetry={() => void locate()} />

          <View accessibilityRole="radiogroup" accessibilityLabel={collection ? t('checkIn.collectionReason') : t('checkIn.reason')} style={{ gap: 6 }}>
            <Text style={st.legend} accessibilityRole="header">
              {collection ? t('checkIn.collectionReason') : t('checkIn.reason')}
            </Text>
            {reasons.map((r) => {
              const on = reason === r;
              return (
                <Pressable
                  key={r}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                  onPress={() => setReason(r)}
                  style={[st.reason, on && st.reasonOn]}
                >
                  <Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={20} color={on ? colors.primary : colors.inputBorder} />
                  <View style={{ flex: 1, gap: 1 }}>
                    <Text style={[st.reasonText, on && { fontWeight: '600' }]}>{t(reasonKey(r))}</Text>
                    <Text style={st.reasonOther}>{i18n.t(reasonKey(r), { lng: other })}</Text>
                  </View>
                </Pressable>
              );
            })}
            {submitted && !reason ? <Text style={st.error}>{t('checkIn.reasonRequired')}</Text> : null}
          </View>

          <TextField label={t('checkIn.remarks')} value={remarks} onChangeText={setRemarks} placeholder={t('order.optional')} multiline maxLength={500} style={st.remarks} />
        </ScrollView>
        <View style={[st.footer, { paddingBottom: insets.bottom + spacing.lg }]}>
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
  footer: { paddingTop: spacing.md, paddingHorizontal: spacing.lg, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
});
