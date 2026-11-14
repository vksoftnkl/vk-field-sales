import { SplashScreen, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { Provider } from 'react-redux';

import { restoreSession } from '@/auth/auth-service';
import { s } from '@/components/ui';
import { ensureMigrated } from '@/db/migrate';
import { store, useAppSelector } from '@/store';
import { useSyncEvents } from '@/sync/useSyncEvents';
import { colors } from '@/theme';

void SplashScreen.preventAutoHideAsync();

/** Boot order: migrate SQLite → restore session from Keystore → show the right stack. */
export default function RootLayout() {
  const [bootError, setBootError] = useState<string | null>(null);

  useEffect(() => {
    ensureMigrated()
      .then(restoreSession)
      .catch((e: unknown) => setBootError(e instanceof Error ? e.message : String(e)));
  }, []);

  if (bootError) {
    return (
      <View style={[s.screen, { justifyContent: 'center', padding: 24 }]}>
        <Text style={s.title}>Database error</Text>
        <Text style={s.muted}>{bootError}</Text>
      </View>
    );
  }

  return (
    <Provider store={store}>
      <StatusBar style="light" />
      <RootStack />
    </Provider>
  );
}

function RootStack() {
  const { t } = useTranslation();
  const status = useAppSelector((st) => st.session.status);
  useSyncEvents(); // sync can run from the login screen too, so listen at the root

  useEffect(() => {
    if (status !== 'restoring') void SplashScreen.hideAsync();
  }, [status]);

  if (status === 'restoring') return null; // splash stays visible

  const signedIn = status === 'signedIn';
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.primary },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: '600' },
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(app)" options={{ headerShown: false }} />
        <Stack.Screen name="order/new" options={{ title: t('orders.new') }} />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="login" options={{ headerShown: false }} />
      </Stack.Protected>
      {/* Open to everyone: a new phone needs the server address before anyone can sign in. */}
      <Stack.Screen name="settings" options={{ title: t('settings.title') }} />
    </Stack>
  );
}
