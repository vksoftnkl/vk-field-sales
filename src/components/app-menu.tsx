import Ionicons from '@expo/vector-icons/Ionicons';
import Constants from 'expo-constants';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { logout } from '@/auth/auth-service';
import { currentCompanyQuery } from '@/features/company/company';
import { useAppSelector } from '@/store';
import { colors, font, spacing } from '@/theme';

/** "Karthik S" → "KS". */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts
    .slice(0, 2)
    .map((p) => p.charAt(0).toLocaleUpperCase())
    .join('');
}

/**
 * Side menu from the ☰ button, like the Qt app's DrawerMenu: who is logged in and for which
 * company, then Home, Switch company, My orders, Reports, Sync data, Settings and Log out. (A
 * shop's receipts are on Customer detail.)
 * Reports and Settings are not built yet and say so.
 */
export function AppMenu({
  visible,
  onClose,
  onSwitchCompany,
  onSync,
  onMyOrders,
}: {
  visible: boolean;
  onClose: () => void;
  onSwitchCompany: () => void;
  onSync: () => void;
  onMyOrders: () => void;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const session = useAppSelector((st) => st.session.session);
  const { data: company } = useLiveQuery(currentCompanyQuery());
  const name = session?.displayName ?? '';

  const notYet = (item: string) => Alert.alert(t('common.notYetTitle'), t('menu.notYet', { item }));

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={st.backdrop}>
        <View style={st.panel} accessibilityRole="menu">
          <View style={[st.head, { paddingTop: insets.top + spacing.xl }]}>
            <View style={st.avatar}>
              <Text style={st.avatarText}>{initials(name)}</Text>
            </View>
            <Text style={st.name}>{name}</Text>
            {session?.secondDisplayName ? (
              <Text style={st.headMuted}>{t('menu.withSecond', { name: session.secondDisplayName })}</Text>
            ) : null}
            {company[0] ? <Text style={st.headMuted}>{company[0].name}</Text> : null}
          </View>

          <View style={st.items}>
            <MenuItem icon="home-outline" label={t('menu.home')} active onPress={onClose} />
            <MenuItem icon="business-outline" label={t('menu.switchCompany')} onPress={onSwitchCompany} />
            <MenuItem icon="clipboard-outline" label={t('menu.myOrders')} onPress={onMyOrders} />
            <MenuItem icon="bar-chart-outline" label={t('menu.reports')} onPress={() => notYet(t('menu.reports'))} />
            <MenuItem icon="sync-outline" label={t('menu.sync')} onPress={onSync} />
            <MenuItem icon="settings-outline" label={t('menu.settings')} onPress={() => notYet(t('menu.settings'))} />
            <View style={st.divider} />
            <MenuItem
              icon="log-out-outline"
              label={t('menu.logout')}
              danger
              onPress={() => {
                onClose();
                logout(); // Stack.Protected then goes back to the login page by itself.
              }}
            />
          </View>

          <View style={[st.foot, { paddingBottom: insets.bottom + spacing.lg }]}>
            <Text style={st.footMuted}>{t('menu.version', { version: Constants.expoConfig?.version ?? '' })}</Text>
          </View>
        </View>
        {/* Tap outside the panel to close. A sibling, so it never takes the panel's taps. */}
        <Pressable style={{ flex: 1 }} accessibilityLabel={t('common.close')} onPress={onClose} />
      </View>
    </Modal>
  );
}

function MenuItem({
  icon,
  label,
  active,
  danger,
  onPress,
}: {
  icon: ComponentProps<typeof Ionicons>['name'];
  label: string;
  active?: boolean;
  danger?: boolean;
  onPress: () => void;
}) {
  const fg = danger ? colors.danger : active ? colors.primary : colors.text;
  return (
    <Pressable
      accessibilityRole="menuitem"
      accessibilityState={{ selected: !!active }}
      onPress={onPress}
      style={({ pressed }) => [st.item, active && st.itemActive, pressed && !active && { backgroundColor: colors.bg }]}
    >
      <Ionicons name={icon} size={22} color={danger || active ? fg : colors.textMuted} />
      <Text style={[st.itemText, { color: fg }, (active || danger) && { fontWeight: '600' }]}>{label}</Text>
    </Pressable>
  );
}

const st = StyleSheet.create({
  backdrop: { flex: 1, flexDirection: 'row', backgroundColor: 'rgba(28,25,23,0.5)' },
  panel: { width: '78%', maxWidth: 304, backgroundColor: colors.surface },
  head: { backgroundColor: colors.primary, paddingHorizontal: spacing.lg + 4, paddingBottom: spacing.lg + 4, gap: spacing.xs },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  avatarText: { fontSize: 18, fontWeight: '700', color: colors.text },
  name: { fontSize: font.lg, fontWeight: '600', color: colors.onPrimary },
  headMuted: { fontSize: font.sm, color: colors.onPrimaryMuted },
  items: { flex: 1, paddingVertical: spacing.sm },
  item: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, minHeight: 52, paddingHorizontal: spacing.lg + 4 },
  itemActive: { backgroundColor: colors.primarySoft },
  itemText: { fontSize: font.md },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.sm, marginHorizontal: spacing.lg + 4 },
  foot: { paddingTop: spacing.md + 2, paddingHorizontal: spacing.lg + 4, borderTopWidth: 1, borderTopColor: colors.border, gap: 2 },
  footStrong: { fontSize: font.sm, fontWeight: '600', color: colors.text },
  footMuted: { fontSize: 12, color: colors.textMuted },
});
