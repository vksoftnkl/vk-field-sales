import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, font, spacing } from '@/theme';

/** The maroon band at the top of a screen: back, title, a muted line under it, optional buttons. */
export function ScreenHeader({
  title,
  subtitle,
  backLabel,
  onBack = () => router.back(),
  right,
}: {
  title: string;
  subtitle?: string;
  backLabel: string;
  onBack?: () => void;
  right?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[st.header, { paddingTop: insets.top + spacing.sm }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={backLabel} onPress={onBack} style={st.back}>
        <Ionicons name="chevron-back" size={24} color={colors.onPrimary} />
      </Pressable>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={st.title} accessibilityRole="header" numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={st.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
    </View>
  );
}

const st = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.primary,
    paddingLeft: spacing.sm,
    paddingRight: spacing.md,
    paddingBottom: spacing.md + 2,
  },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 19, fontWeight: '600', color: colors.onPrimary },
  subtitle: { marginTop: 2, fontSize: font.sm, color: colors.onPrimaryMuted },
});
