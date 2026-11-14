import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Alert, ScrollView, Text } from 'react-native';

import { logout, unsyncedCount } from '@/auth/auth-service';
import { Button, Card, s } from '@/components/ui';
import { APP_VERSION } from '@/config/env';
import i18n from '@/i18n';
import { EscPos } from '@/printing/escpos';
import { printer } from '@/printing/printer';
import { useAppSelector } from '@/store';
import { spacing } from '@/theme';

export default function MoreScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const session = useAppSelector((st) => st.session.session);

  const confirmLogout = () => {
    const n = unsyncedCount();
    Alert.alert(t('more.logout'), n > 0 ? t('more.unsyncedWarn', { count: n }) : undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('more.logout'), style: 'destructive', onPress: () => void logout() },
    ]);
  };

  const testPrint = async () => {
    const bytes = new EscPos(48)
      .align('center').bold(true).size(2).line('VK FIELD SALES').size(1).bold(false)
      .line('Printer test').divider()
      .align('left').pair('Salesman', session?.displayName ?? '-').pair('Amount', 'Rs. 1,250.00')
      .divider().feed(3).cut().build();
    try {
      const [dev] = await printer.listPaired();
      if (dev) await printer.print(dev.address, bytes);
    } catch (e) {
      Alert.alert(t('common.error'), e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <ScrollView style={s.screen} contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
      <Card>
        <Text style={[s.body, { fontWeight: '700' }]}>{session?.displayName}</Text>
        <Text style={s.muted}>@{session?.username} · v{APP_VERSION}</Text>
      </Card>
      <Button title={t('more.serverSettings')} variant="secondary" onPress={() => router.push('/settings')} />
      <Button title={t('more.testPrint')} variant="secondary" onPress={() => void testPrint()} />
      <Button
        title={`${t('more.language')}: ${i18n.language === 'ta' ? 'தமிழ்' : 'English'}`}
        variant="secondary"
        onPress={() => void i18n.changeLanguage(i18n.language === 'ta' ? 'en' : 'ta')}
      />
      <Button title={t('more.logout')} variant="danger" onPress={confirmLogout} />
    </ScrollView>
  );
}
