import Ionicons from '@expo/vector-icons/Ionicons';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, PasswordField, TextField } from '@/components/ui';
import { getServerCredentials, setServerCredentials } from '@/sync/credentials';
import { runSync, testConnection, type SyncReport, type SyncStep } from '@/sync/run-sync';
import { formatServerAddress, parseServerAddress } from '@/sync/server-address';
import { getServerAddress, pendingCustomersQuery, saveServerAddress } from '@/sync/sync-store';
import { isApiError, isNetworkError } from '@/sync/vk-nex-api';
import { colors, font, radius, spacing } from '@/theme';

type Check = { ok: boolean; text: string } | null;

/**
 * Sync with the VK Nex server PC on the office LAN, only when the salesman taps it. Sends every
 * customer added on the phone (each is marked synced as soon as VK Nex has it), then brings
 * VK Nex's customers to the phone.
 */
export default function SyncScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  const [address, setAddress] = useState(() => {
    const saved = getServerAddress();
    return saved ? formatServerAddress(saved) : '';
  });
  const [addressError, setAddressError] = useState<string>();
  const [check, setCheck] = useState<Check>(null);
  const [testing, setTesting] = useState(false);

  // VK Nex sign-in: the phone login's user, unless the salesman types another one here.
  const [showSignIn, setShowSignIn] = useState(() => getServerCredentials() === null);
  const [loginName, setLoginName] = useState(() => getServerCredentials()?.loginName ?? '');
  const [password, setPassword] = useState('');

  const [progress, setProgress] = useState<string | null>(null);
  const [report, setReport] = useState<SyncReport | null>(null);
  const { data: pending } = useLiveQuery(pendingCustomersQuery());

  /** Reads and saves the address box; null (with the error shown) when it is not usable. */
  const takeAddress = () => {
    const a = parseServerAddress(address);
    if (!a) {
      setAddressError(t('sync.addressInvalid'));
      return null;
    }
    setAddressError(undefined);
    setAddress(formatServerAddress(a));
    saveServerAddress(a);
    return a;
  };

  const test = async () => {
    const a = takeAddress();
    if (!a) return;
    setTesting(true);
    setCheck(null);
    try {
      await testConnection(a);
      setCheck({ ok: true, text: t('sync.connected', { address: formatServerAddress(a) }) });
    } catch (e) {
      setCheck({ ok: false, text: isNetworkError(e) ? t('sync.noAnswer', { address: formatServerAddress(a) }) : t('sync.server', { message: errorText(e) }) });
    } finally {
      setTesting(false);
    }
  };

  const stepText = (step: SyncStep, done = 0, total = 0) => {
    const n = Math.min(done + 1, total);
    switch (step) {
      case 'signIn':
        return t('sync.stepSignIn');
      case 'masters':
        return t('sync.stepMasters');
      case 'upload':
        return total ? t('sync.stepUpload', { n, total }) : t('sync.stepUploadNone');
      case 'download':
        return total ? t('sync.stepDownload', { n, total }) : t('sync.stepDownloadList');
    }
  };

  const sync = async () => {
    if (progress) return;
    const a = takeAddress();
    if (!a) return;
    if (showSignIn) {
      if (!loginName.trim() || !password) return setReport({ outcomes: [], stoppedBy: new Error('NO_SIGN_IN'), stoppedAt: 'signIn' });
      setServerCredentials({ loginName: loginName.trim(), password });
    }
    setReport(null);
    setCheck(null);
    setProgress(stepText('signIn'));
    try {
      const r = await runSync((step, done, total) => setProgress(stepText(step, done, total)));
      setReport(r);
      // VK Nex refused the sign-in: let the salesman type the VK Nex user and password.
      if (r.stoppedAt === 'signIn' && isApiError(r.stoppedBy) && r.stoppedBy.status === 401) {
        setShowSignIn(true);
        setPassword('');
      } else if (!r.stoppedBy) {
        setShowSignIn(false);
      }
    } finally {
      setProgress(null);
    }
  };

  const stopText = (r: SyncReport): string | null => {
    const e = r.stoppedBy;
    if (!e) return null;
    if (e instanceof Error && e.message === 'NO_SIGN_IN') return t('sync.signInMissing');
    if (isNetworkError(e)) return t('sync.noAnswer', { address });
    if (isApiError(e)) {
      if (r.stoppedAt === 'signIn' && e.status === 401) return t('sync.signInRefused', { name: getServerCredentials()?.loginName ?? '', message: e.message });
      if (e.status === 426) return t('sync.updateNeeded', { message: e.message });
      if (e.status === 403) return t('sync.noRight', { message: e.message });
      return t('sync.server', { message: errorText(e) });
    }
    return t('common.error');
  };

  const sent = report?.outcomes.filter((o) => o.status !== 'refused').length ?? 0;
  const refused = report?.outcomes.filter((o) => o.status === 'refused').length ?? 0;
  const stop = report ? stopText(report) : null;
  const got = report?.downloaded;

  return (
    <View style={st.root}>
      <View style={[st.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('sync.back')} onPress={() => router.back()} style={st.back}>
          <Ionicons name="chevron-back" size={24} color={colors.onPrimary} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={st.title} accessibilityRole="header">
            {t('sync.title')}
          </Text>
          <Text style={st.subtitle}>{t('sync.subtitle')}</Text>
        </View>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView contentContainerStyle={st.body} keyboardShouldPersistTaps="handled">
          <Card title={t('sync.serverTitle')}>
            <TextField
              label={t('sync.address')}
              value={address}
              onChangeText={(v) => {
                setAddress(v);
                setCheck(null);
              }}
              placeholder="192.168.1.10:3012"
              keyboardType="url"
              autoCapitalize="none"
              autoCorrect={false}
              error={addressError}
            />
            <Button title={t('sync.test')} variant="outline" loading={testing} onPress={() => void test()} />
            {check ? <StatusLine ok={check.ok} text={check.text} /> : null}
          </Card>

          <Card title={t('sync.signInTitle')}>
            {showSignIn ? (
              <>
                <Text style={st.note}>{t('sync.signInNote')}</Text>
                <TextField label={t('sync.loginName')} value={loginName} onChangeText={setLoginName} autoCapitalize="none" autoCorrect={false} />
                <PasswordField label={t('sync.password')} value={password} onChangeText={setPassword} textContentType="password" />
              </>
            ) : (
              <View style={st.row}>
                <Text style={[st.note, { flex: 1 }]}>{t('sync.signsInAs', { name: getServerCredentials()?.loginName ?? '' })}</Text>
                <Pressable accessibilityRole="button" hitSlop={8} onPress={() => setShowSignIn(true)}>
                  <Text style={st.link}>{t('sync.change')}</Text>
                </Pressable>
              </View>
            )}
          </Card>

          <Card title={t('sync.waitingTitle', { n: pending.length })}>
            {pending.length === 0 ? <Text style={st.note}>{t('sync.nothingWaiting')}</Text> : null}
            {pending.map((c) => (
              <View key={c.cusId} style={st.item}>
                <Ionicons name={c.appSyncError ? 'alert-circle' : 'time-outline'} size={20} color={c.appSyncError ? colors.danger : colors.textMuted} />
                <View style={{ flex: 1 }}>
                  <Text style={st.itemName}>{c.cusName}</Text>
                  {c.appSyncError ? <Text style={st.itemError}>{c.appSyncError}</Text> : null}
                </View>
              </View>
            ))}
          </Card>

          {report && (report.outcomes.length > 0 || got || stop) ? (
            <Card title={t('sync.resultTitle')}>
              {report.outcomes.length > 0 ? <Text style={st.note}>{t('sync.summary', { sent, refused })}</Text> : null}
              {report.outcomes.map((o) => (
                <View key={o.localId} style={st.item}>
                  <Ionicons
                    name={o.status === 'refused' ? 'close-circle' : 'checkmark-circle'}
                    size={20}
                    color={o.status === 'refused' ? colors.danger : colors.success}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={st.itemName}>{o.name}</Text>
                    <Text style={o.status === 'refused' ? st.itemError : st.itemOk}>
                      {o.status === 'uploaded'
                        ? t('sync.uploaded', { code: o.serverCode ?? '' })
                        : o.status === 'linked'
                          ? t('sync.linked', { code: o.serverCode ?? '' })
                          : o.error}
                    </Text>
                  </View>
                </View>
              ))}
              {got ? (
                <View style={[st.item, report.outcomes.length === 0 && st.itemFirst]}>
                  <Ionicons name="cloud-download-outline" size={20} color={colors.success} />
                  <View style={{ flex: 1 }}>
                    <Text style={st.itemOk}>{t('sync.received', { n: got.saved })}</Text>
                    {got.removed > 0 ? <Text style={st.itemNote}>{t('sync.removed', { n: got.removed })}</Text> : null}
                    {got.skipped > 0 ? <Text style={st.itemError}>{t('sync.skipped', { n: got.skipped })}</Text> : null}
                  </View>
                </View>
              ) : null}
              {stop ? <StatusLine ok={false} text={stop} /> : null}
            </Card>
          ) : null}
        </ScrollView>

        <View style={[st.footer, { paddingBottom: insets.bottom + spacing.lg }]}>
          {progress ? (
            <Text style={st.progress} accessibilityLiveRegion="polite">
              {progress}
            </Text>
          ) : null}
          <Button title={t('sync.syncNow')} loading={!!progress} onPress={() => void sync()} style={{ height: 52 }} />
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

/** "CUSTOMER_UNKNOWN_GROUP: …" style text of a VK Nex refusal. */
function errorText(e: unknown): string {
  if (isApiError(e)) return e.code ? `${e.code}: ${e.message}` : e.message;
  return e instanceof Error ? e.message : String(e);
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={st.card}>
      <Text style={st.cardTitle} accessibilityRole="header">
        {title}
      </Text>
      {children}
    </View>
  );
}

function StatusLine({ ok, text }: { ok: boolean; text: string }) {
  return (
    <View style={[st.row, { marginTop: spacing.md }]} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <Ionicons name={ok ? 'checkmark-circle' : 'alert-circle'} size={20} color={ok ? colors.success : colors.danger} />
      <Text style={[st.status, { color: ok ? colors.success : colors.danger }]}>{text}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
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
  body: { padding: spacing.lg, gap: spacing.md },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  cardTitle: { fontSize: font.sm, fontWeight: '700', letterSpacing: 0.5, color: colors.primary, textTransform: 'uppercase', marginBottom: spacing.md },
  note: { fontSize: font.sm, color: colors.textMuted, marginBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  link: { fontSize: font.sm, fontWeight: '700', color: colors.primary },
  status: { flex: 1, fontSize: font.sm },
  item: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  itemName: { fontSize: font.md, fontWeight: '600', color: colors.text },
  itemError: { marginTop: 2, fontSize: font.sm, color: colors.danger },
  itemOk: { marginTop: 2, fontSize: font.sm, color: colors.success },
  itemNote: { marginTop: 2, fontSize: font.sm, color: colors.textMuted },
  itemFirst: { borderTopWidth: 0, paddingTop: 0 },
  footer: { paddingTop: spacing.md, paddingHorizontal: spacing.lg, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
  progress: { marginBottom: spacing.sm, fontSize: font.sm, color: colors.textMuted, textAlign: 'center' },
});
