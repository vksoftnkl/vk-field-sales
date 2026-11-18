import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Keyboard, KeyboardAvoidingView, Pressable, ScrollView, Share, StyleSheet, Text, View, type ScrollViewInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { lastLoginName, login, savedUsersQuery, type LoginResult } from '@/auth/auth-service';
import { Button, PasswordField, SelectField, TextField, type SelectOption } from '@/components/ui';
import { formatServerAddress, parseServerAddress } from '@/sync/server-address';
import { getDeviceUid, getServerAddress, saveServerAddress } from '@/sync/sync-store';
import { colors, font, radius, spacing } from '@/theme';

/**
 * Login page — the app's start page. The salesman types their VK Nex login name and password.
 * The first login on this phone is checked with VK Nex (POST /auth/login), so it needs the office
 * Wi-Fi and the server address shown below the card; later logins are checked on the phone.
 * As in the old Qt app, a second salesman can be added (multi-user mode).
 * The phone's VK Nex device ID is shown here too, so the office can register it on VK Nex's
 * Device List before the salesman ever logs in.
 */
export default function LoginScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  // Keep the card (password + Log in button) in view while the keyboard is open on small phones.
  // Scrolls when the ScrollView shrinks for the keyboard, i.e. after the padding below is applied.
  const scrollRef = useRef<ScrollViewInstance>(null);
  const keyboardUp = useRef(false);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => {
      keyboardUp.current = true;
      scrollRef.current?.scrollToEnd();
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      keyboardUp.current = false;
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const [deviceUid] = useState(getDeviceUid);
  const shareDeviceUid = () => void Share.share({ message: deviceUid }).catch(() => undefined);

  const [loginName, setLoginName] = useState(lastLoginName);
  const [secondId, setSecondId] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // VK Nex server: needed only when VK Nex has to check the login (first login on this phone).
  const [address, setAddress] = useState(getServerAddress);
  const [editingAddress, setEditingAddress] = useState(() => getServerAddress() === null);
  const [addressText, setAddressText] = useState(() => {
    const a = getServerAddress();
    return a ? formatServerAddress(a) : '';
  });
  const [addressError, setAddressError] = useState<string>();

  // Second salesman: anyone else who has logged in on this phone before.
  const { data: savedUsers } = useLiveQuery(savedUsersQuery());
  const typed = loginName.trim().toLowerCase();
  const secondOptions: SelectOption[] = useMemo(
    () => [
      { value: '', label: t('login.none') },
      ...savedUsers.filter((u) => u.loginName.toLowerCase() !== typed).map((u) => ({ value: u.id, label: u.loginName })),
    ],
    [savedUsers, typed, t],
  );
  // The picked second salesman is dropped if the name typed above becomes theirs.
  const second = secondOptions.some((o) => o.value === secondId) ? secondId : '';

  // Any edit clears the last error, so it never describes a value that has since changed.
  const typeLoginName = (text: string) => {
    setLoginName(text);
    setError(null);
  };
  const pickSecond = (id: string) => {
    setSecondId(id);
    setError(null);
  };
  const typePassword = (text: string) => {
    setPassword(text);
    setError(null);
  };
  const typeAddress = (text: string) => {
    setAddressText(text);
    setAddressError(undefined);
    setError(null);
  };

  /** Saves a newly typed server address; false (with the error shown) when it is not usable. */
  const takeAddress = (): boolean => {
    if (!editingAddress || !addressText.trim()) return true;
    const a = parseServerAddress(addressText);
    if (!a) {
      setAddressError(t('sync.addressInvalid'));
      return false;
    }
    saveServerAddress(a);
    setAddress(a);
    setAddressText(formatServerAddress(a));
    setEditingAddress(false);
    return true;
  };

  const failText = (r: Exclude<LoginResult, { ok: true }>): string => {
    switch (r.reason) {
      case 'refused':
        return t('login.refused');
      case 'noServer':
        return t('login.noServer');
      case 'offline':
        return t(r.known ? 'login.offlinePassword' : 'login.offlineFirst', { address: formatServerAddress(r.address) });
      case 'server':
        return r.status === 426 ? t('sync.updateNeeded', { message: r.message }) : t('sync.server', { message: r.message });
    }
  };

  const submit = async () => {
    if (busy) return; // the keyboard's Go key can fire while a check is running
    // Messages as in the old Qt app, so salesmen recognise them.
    if (!loginName.trim()) return setError(t('login.nameRequired'));
    if (!password) return setError(t('login.passwordRequired'));
    if (!takeAddress()) return;
    setBusy(true);
    setError(null);
    try {
      // On success Stack.Protected switches to the customer list by itself.
      const r = await login(loginName, password, second || null);
      if (!r.ok) {
        setError(failText(r));
        if (r.reason === 'noServer') setEditingAddress(true);
      }
    } catch {
      setError(t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    // 'padding' on Android too: the app is edge-to-edge (targetSdk 36), so adjustResize no longer
    // shrinks the window. The padding is the measured overlap with the keyboard, never more.
    <KeyboardAvoidingView style={st.root} behavior="padding">
      <ScrollView
        ref={scrollRef}
        onLayout={() => keyboardUp.current && scrollRef.current?.scrollToEnd()}
        contentContainerStyle={{ flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        bounces={false}
      >
        {/* Maroon band: logo, app name, prompt */}
        <View style={[st.band, { paddingTop: Math.max(insets.top + spacing.lg, LOGO_TOP) }]}>
          <View style={st.logo}>
            <Text style={st.logoText}>VK</Text>
          </View>
          <Text style={st.title}>{t('login.title')}</Text>
          <Text style={st.subtitle}>{t('login.subtitle')}</Text>
        </View>

        {/* White card overlapping the band */}
        <View style={st.card}>
          <TextField
            label={t('login.loginName')}
            value={loginName}
            onChangeText={typeLoginName}
            placeholder={t('login.loginNamePlaceholder')}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="username"
            textContentType="username"
          />
          {secondOptions.length > 1 ? (
            <SelectField label={t('login.secondSalesman')} value={second} options={secondOptions} onChange={pickSecond} searchable />
          ) : null}
          <PasswordField
            label={t('login.password')}
            value={password}
            onChangeText={typePassword}
            textContentType="password"
            returnKeyType="go"
            onSubmitEditing={() => void submit()}
          />
          {error ? (
            <Text style={st.error} accessibilityRole="alert" accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}
          <Button title={t('login.submit')} onPress={() => void submit()} loading={busy} style={{ marginTop: spacing.sm }} />
        </View>

        {/* Where VK Nex is: the first login on this phone is checked there */}
        <View style={st.device}>
          {editingAddress ? (
            <TextField
              label={t('login.serverLabel')}
              value={addressText}
              onChangeText={typeAddress}
              placeholder={t('sync.addressPlaceholder')}
              keyboardType="url"
              autoCapitalize="none"
              autoCorrect={false}
              error={addressError}
            />
          ) : (
            <>
              <Text style={st.deviceLabel}>{t('login.serverLabel')}</Text>
              <View style={st.deviceRow}>
                <Text style={st.serverText} selectable>
                  {address ? formatServerAddress(address) : ''}
                </Text>
                <Pressable accessibilityRole="button" hitSlop={8} onPress={() => setEditingAddress(true)}>
                  <Text style={st.link}>{t('login.changeServer')}</Text>
                </Pressable>
              </View>
            </>
          )}
          <Text style={st.deviceNote}>{t('login.serverNote')}</Text>
        </View>

        {/* This phone's ID, for the office to add on VK Nex's Device List */}
        <View style={st.device}>
          <Text style={st.deviceLabel}>{t('login.deviceLabel')}</Text>
          <View style={st.deviceRow}>
            <Text style={st.deviceUid} selectable accessibilityLabel={deviceUid.split('').join(' ')}>
              {deviceUid}
            </Text>
            <Pressable accessibilityRole="button" hitSlop={8} onPress={shareDeviceUid}>
              <Text style={st.link}>{t('login.shareDevice')}</Text>
            </Pressable>
          </View>
          <Text style={st.deviceNote}>{t('login.deviceNote')}</Text>
        </View>

        <View style={{ flex: 1 }} />
        <Text style={[st.footer, { paddingBottom: insets.bottom + spacing.lg }]}>{t('login.footer')}</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// Measured from the approved mockup (390 × 844): logo tile 64 from the top, card overlaps the band by 64.
const LOGO_TOP = 64;
const CARD_OVERLAP = 64;

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  band: {
    backgroundColor: colors.primary,
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingBottom: CARD_OVERLAP + spacing.xxl,
  },
  logo: {
    width: 64,
    height: 64,
    borderRadius: radius.lg,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: { fontSize: 24, fontWeight: '800', color: colors.text },
  title: { marginTop: spacing.xl, fontSize: 24, fontWeight: '800', color: colors.onPrimary, letterSpacing: 0.5 },
  subtitle: { marginTop: spacing.sm, fontSize: font.md, color: colors.onPrimaryMuted },
  card: {
    marginTop: -CARD_OVERLAP,
    marginHorizontal: spacing.lg + 4,
    padding: spacing.lg + 4,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  device: { marginTop: spacing.xl, marginHorizontal: spacing.lg + 4, paddingHorizontal: spacing.xs },
  deviceLabel: { fontSize: font.sm, color: colors.textMuted },
  deviceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, marginTop: spacing.xs },
  deviceUid: { flexShrink: 1, fontSize: font.lg, fontWeight: '700', letterSpacing: 1, color: colors.text, fontVariant: ['tabular-nums'] },
  deviceNote: { marginTop: spacing.xs, fontSize: font.sm, color: colors.textMuted },
  serverText: { flexShrink: 1, fontSize: font.md, fontWeight: '600', color: colors.text },
  link: { fontSize: font.sm, fontWeight: '700', color: colors.primary },
  error: { color: colors.danger, fontSize: font.sm, marginTop: -spacing.xs, marginBottom: spacing.xs },
  footer: { textAlign: 'center', fontSize: 12, color: colors.textMuted, paddingHorizontal: spacing.xl, paddingTop: spacing.xl },
});
