import { SplashScreen, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Provider } from 'react-redux';

import { s } from '@/components/ui';
import { ensureMigrated } from '@/db/migrate';
import { seedTestSalesmen } from '@/db/seed';
import { store, useAppSelector } from '@/store';
import { colors } from '@/theme';

void SplashScreen.preventAutoHideAsync();

/** Start-up: prepare the database, then always open on the login page. */
export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);

  useEffect(() => {
    ensureMigrated()
      .then(() => {
        seedTestSalesmen();
        setReady(true);
      })
      .catch((e: unknown) => setBootError(e instanceof Error ? e.message : String(e)))
      .finally(() => void SplashScreen.hideAsync());
  }, []);

  if (bootError) {
    return (
      <View style={[s.screen, { justifyContent: 'center', padding: 24 }]}>
        <Text style={s.title}>Database error</Text>
        <Text style={s.muted}>{bootError}</Text>
      </View>
    );
  }
  if (!ready) return null; // splash stays visible

  return (
    <Provider store={store}>
      <StatusBar style="light" />
      <RootStack />
    </Provider>
  );
}

function RootStack() {
  const signedIn = useAppSelector((st) => st.session.session !== null);
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="index" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="welcome" />
      </Stack.Protected>
    </Stack>
  );
}
