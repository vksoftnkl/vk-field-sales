import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, Text } from 'react-native';

import { api } from '@/api/endpoints';
import { NetworkError } from '@/api/http';
import { getOrCreateDeviceId, shortDeviceId } from '@/auth/device';
import { SyncPanel } from '@/components/SyncPanel';
import { Button, Card, Field, Row, s } from '@/components/ui';
import { DEFAULT_SERVER_PORT } from '@/config/env';
import { getServerAddress, isValidPort, saveServerAddress, splitHostInput, type ServerAddress } from '@/config/server';
import { colors, spacing } from '@/theme';

/**
 * Where the VK Nex server PC is (IP + port), plus a Sync button. Reachable before sign-in
 * (gear on the login screen), because a new phone needs both for its first Sync — like the
 * old Qt app's Settings page.
 */
export default function ServerSettingsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const [saved] = useState(getServerAddress);
  const [host, setHost] = useState(saved?.host ?? '');
  const [port, setPort] = useState(saved?.port ?? DEFAULT_SERVER_PORT);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [deviceId, setDeviceId] = useState('');

  useEffect(() => {
    void getOrCreateDeviceId().then(setDeviceId);
  }, []);

  /** Validate the form. A port typed into the IP box ("192.168.0.10:3011") wins. */
  const read = (): ServerAddress | null => {
    const split = splitHostInput(host);
    const p = (split.port ?? port).trim();
    if (!split.host) {
      setError(t('settings.hostRequired'));
      return null;
    }
    if (!isValidPort(p)) {
      setError(t('settings.badPort'));
      return null;
    }
    setError(null);
    setHost(split.host);
    setPort(p);
    return { host: split.host, port: p };
  };

  const test = async () => {
    const addr = read();
    if (!addr) return;
    setTesting(true);
    setResult(null);
    try {
      await api.health(addr);
      setResult({ ok: true, text: t('settings.ok') });
    } catch (e) {
      setResult({ ok: false, text: e instanceof NetworkError ? t('sync.unreachable') : e instanceof Error ? e.message : String(e) });
    } finally {
      setTesting(false);
    }
  };

  const save = () => {
    const addr = read();
    if (!addr) return;
    saveServerAddress(addr);
    if (router.canGoBack()) router.back();
  };

  return (
    <ScrollView style={s.screen} contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }} keyboardShouldPersistTaps="handled">
      <Text style={s.muted}>{t('settings.intro')}</Text>
      <Card>
        <Field
          label={t('settings.host')}
          value={host}
          onChangeText={setHost}
          placeholder="192.168.0.10"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />
        <Field label={t('settings.port')} value={port} onChangeText={setPort} keyboardType="number-pad" error={error} />
        <Row style={{ gap: spacing.md }}>
          <Button title={t('settings.test')} variant="secondary" loading={testing} onPress={() => void test()} style={{ flex: 1 }} />
          <Button title={t('settings.save')} onPress={save} style={{ flex: 1 }} />
        </Row>
      </Card>

      {result ? (
        <Card style={{ borderColor: result.ok ? colors.success : colors.danger }}>
          <Text style={[s.body, { color: result.ok ? colors.success : colors.danger }]}>{result.text}</Text>
        </Card>
      ) : null}

      <Card style={{ gap: spacing.md }}>
        <Text style={s.muted}>{t('settings.syncHint')}</Text>
        <SyncPanel reason="manual" />
      </Card>

      <Card>
        <Text style={s.muted}>{t('settings.deviceId')}</Text>
        <Text style={[s.title, { letterSpacing: 2 }]}>{deviceId ? shortDeviceId(deviceId) : '…'}</Text>
        <Text style={s.muted} selectable>
          {deviceId}
        </Text>
      </Card>
    </ScrollView>
  );
}
