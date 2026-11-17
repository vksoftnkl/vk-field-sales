import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text } from 'react-native';

import { colors, font, radius } from '@/theme';

/** The header's "No collection" button: a check-in saying why nothing was collected. */
export function NoCollectionButton({ customerId, companyId }: { customerId: string; companyId?: string }) {
  const { t } = useTranslation();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push({ pathname: '/checkin/[customerId]', params: { customerId, kind: 'collection', ...(companyId ? { companyId } : {}) } })}
      style={({ pressed }) => [st.btn, pressed && { opacity: 0.85 }]}
    >
      <Ionicons name="location-outline" size={16} color={colors.onPrimary} />
      <Text style={st.text}>{t('receipt.noCollection')}</Text>
    </Pressable>
  );
}

const st = StyleSheet.create({
  btn: { minHeight: 40, paddingHorizontal: 10, borderRadius: radius.md, backgroundColor: '#A23A3A', flexDirection: 'row', alignItems: 'center', gap: 6 },
  text: { fontSize: font.sm, fontWeight: '600', color: colors.onPrimary },
});
