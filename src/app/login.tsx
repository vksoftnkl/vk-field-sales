import Ionicons from '@expo/vector-icons/Ionicons';
import { asc, eq } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Keyboard, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, View, type ScrollViewInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { login, LoginError } from '@/auth/auth-service';
import { SyncPanel } from '@/components/SyncPanel';
import { Button, PasswordField, SelectField, s, type SelectOption } from '@/components/ui';
import { db } from '@/db/client';
import { getMeta } from '@/db/meta';
import { users } from '@/db/schema';
import { colors, font, radius, spacing } from '@/theme';

/**
 * Offline sign-in, like the old Qt app: pick your name from the salesmen downloaded at the
 * last Sync, optionally a second salesman (multi-user mode), and type your VK Nex password.
 * A brand-new phone (no salesmen yet) shows Sync + Server settings in the card instead.
 */
export default function LoginScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { data: people } = useLiveQuery(
    db.select({ id: users.id, name: users.displayName }).from(users).where(eq(users.isActive, true)).orderBy(asc(users.displayName)),
  );
  const options: SelectOption[] = useMemo(() => people.map((u) => ({ value: u.id, label: u.name })), [people]);
  const hasUsers = options.length > 0;

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

  const [lastUserId] = useState(() => getMeta('lastUserId'));
  const [picked, setPicked] = useState<string | null>(null);
  const userId = picked ?? (lastUserId && options.some((o) => o.value === lastUserId) ? lastUserId : '');
  const [secondId, setSecondId] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const secondOptions = useMemo(
    () => [{ value: '', label: t('login.none') }, ...options.filter((o) => o.value !== userId)],
    [options, userId, t],
  );

  // Any edit clears the last error, so it never describes a value that has since changed.
  const pickSalesman = (id: string) => {
    setPicked(id);
    if (id === secondId) setSecondId('');
    setPassword('');
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

  const submit = async () => {
    if (busy) return; // the keyboard's Go key can fire while a check is running
    // Messages as in the old Qt app, so salesmen recognise them.
    if (!userId) return setError(t('login.nameRequired'));
    if (!password) return setError(t('login.passwordRequired'));
    setBusy(true);
    setError(null);
    try {
      await login(userId, password, secondId || null);
      // Stack.Protected switches to the app automatically once signedIn is set.
    } catch (e) {
      setError(
        e instanceof LoginError
          ? e.code === 'NO_USERS'
            ? t('login.noUsers')
            : e.code === 'DEVICE_BLOCKED'
              ? t('login.blocked')
              : t('login.badPassword')
          : t('common.error'),
      );
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
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('login.serverSettings')}
            hitSlop={12}
            onPress={() => router.push('/settings')}
            style={[st.gear, { top: insets.top + spacing.md }]}
          >
            <Ionicons name="settings-outline" size={22} color={colors.onPrimaryMuted} />
          </Pressable>
        </View>

        {/* White card overlapping the band */}
        <View style={st.card}>
          {hasUsers ? (
            <>
              <SelectField
                label={t('login.salesman')}
                value={userId}
                options={options}
                onChange={pickSalesman}
                placeholder={t('login.chooseSalesman')}
                searchable
              />
              <SelectField label={t('login.secondSalesman')} value={secondId} options={secondOptions} onChange={pickSecond} searchable />
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
            </>
          ) : (
            <View style={{ gap: spacing.md }}>
              <Text style={s.body}>{t('login.noUsers')}</Text>
              <SyncPanel reason="login-screen" />
              <Button title={t('login.serverSettings')} variant="secondary" onPress={() => router.push('/settings')} />
            </View>
          )}
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
  gear: { position: 'absolute', right: spacing.lg },
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
  error: { color: colors.danger, fontSize: font.sm, marginTop: -spacing.xs, marginBottom: spacing.xs },
  footer: { textAlign: 'center', fontSize: 12, color: colors.textMuted, paddingHorizontal: spacing.xl, paddingTop: spacing.xl },
});
