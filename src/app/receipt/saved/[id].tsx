import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/screen-header';
import { Button } from '@/components/ui';
import { useDateNames } from '@/components/use-date-names';
import { ReceiptSlip, slipText, useSlip } from '@/features/receipts/receipt-slip';
import { colors, font, radius, spacing } from '@/theme';

/**
 * Receipt saved (canvas 5b, step 5): the slip for the shop, which says it is not in VK Nex yet,
 * with Share (WhatsApp and other apps, as text; D9). Printing comes with the printer setup in
 * Settings. Done goes back to the customer.
 */
export default function ReceiptSavedScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const names = useDateNames();
  const { slip } = useSlip(id);

  const share = () => {
    if (slip) void Share.share({ message: slipText(slip, t, names) }).catch(() => Alert.alert(t('common.error')));
  };
  const done = () => router.back();

  return (
    <View style={st.root}>
      <ScreenHeader
        title={t('receipt.savedTitle')}
        subtitle={slip?.state === 'posted' ? t('receipt.state.posted') : t('receipt.waitingLine')}
        backLabel={t('receipt.back')}
        onBack={done}
      />
      <ScrollView contentContainerStyle={st.body}>
        {slip ? <ReceiptSlip slip={slip} /> : null}
        {slip && slip.state !== 'posted' ? <Text style={st.note}>{t('receipt.savedNote')}</Text> : null}
      </ScrollView>
      <View style={[st.footer, { paddingBottom: insets.bottom + spacing.lg }]}>
        <View style={st.btnRow}>
          <IconBtn icon="share-social-outline" label={t('receipt.share')} onPress={share} disabled={!slip} />
          <IconBtn icon="print-outline" label={t('receipt.print')} onPress={() => Alert.alert(t('common.notYetTitle'), t('receipt.printLater'))} />
        </View>
        <Button title={t('receipt.done')} onPress={done} style={{ height: 52 }} />
      </View>
    </View>
  );
}

function IconBtn({ icon, label, onPress, disabled }: { icon: 'share-social-outline' | 'print-outline'; label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [st.iconBtn, disabled && { opacity: 0.5 }, pressed && { opacity: 0.85 }]}
    >
      <Ionicons name={icon} size={20} color={colors.primary} />
      <Text style={st.iconText}>{label}</Text>
    </Pressable>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { padding: spacing.lg, gap: spacing.md },
  note: { fontSize: 12.5, color: colors.textMuted, lineHeight: 18 },
  footer: { paddingTop: spacing.md, paddingHorizontal: spacing.lg, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border, gap: spacing.sm },
  btnRow: { flexDirection: 'row', gap: spacing.sm },
  iconBtn: { flex: 1, minHeight: 48, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md + 2, borderWidth: 1, borderColor: colors.primary },
  iconText: { fontSize: font.md, fontWeight: '600', color: colors.primary },
});
