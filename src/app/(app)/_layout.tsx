import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router/js-tabs';
import { useTranslation } from 'react-i18next';

import { colors } from '@/theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];
type IconColor = React.ComponentProps<typeof Ionicons>['color'];
const icon = (name: IconName) => ({ color, size }: { color: unknown; size: number }) => (
  <Ionicons name={name} color={color as IconColor} size={size} />
);

export default function AppTabs() {
  const { t } = useTranslation();
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.primary },
        headerTintColor: '#fff',
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
      }}
    >
      <Tabs.Screen name="index" options={{ title: t('tabs.today'), tabBarIcon: icon('today-outline') }} />
      <Tabs.Screen name="customers" options={{ title: t('tabs.customers'), tabBarIcon: icon('people-outline') }} />
      <Tabs.Screen name="orders" options={{ title: t('tabs.orders'), tabBarIcon: icon('receipt-outline') }} />
      <Tabs.Screen name="sync" options={{ title: t('tabs.sync'), tabBarIcon: icon('sync-outline') }} />
      <Tabs.Screen name="more" options={{ title: t('tabs.more'), tabBarIcon: icon('ellipsis-horizontal') }} />
    </Tabs>
  );
}
