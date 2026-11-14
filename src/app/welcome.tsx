import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { logout } from '@/auth/auth-service';
import { Button } from '@/components/ui';
import { useAppSelector } from '@/store';
import { colors, font, radius, spacing } from '@/theme';

/** Shown after a correct password. Log out goes back to the login page. */
export default function WelcomeScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const session = useAppSelector((st) => st.session.session);

  return (
    <View style={[st.root, { paddingTop: insets.top + spacing.xxl, paddingBottom: insets.bottom + spacing.lg }]}>
      <View style={st.card}>
        <Text style={st.label}>{t('welcome.loggedInAs')}</Text>
        <Text style={st.name}>{session?.displayName}</Text>
        {session?.secondDisplayName ? (
          <Text style={st.second}>{t('welcome.withSecond', { name: session.secondDisplayName })}</Text>
        ) : null}
        <Button title={t('welcome.logout')} onPress={logout} style={{ marginTop: spacing.xl }} />
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center', paddingHorizontal: spacing.lg + 4 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg + 4,
  },
  label: { fontSize: font.sm, color: colors.textMuted },
  name: { marginTop: spacing.xs, fontSize: font.xl, fontWeight: '700', color: colors.text },
  second: { marginTop: spacing.xs, fontSize: font.md, color: colors.textLabel },
});
