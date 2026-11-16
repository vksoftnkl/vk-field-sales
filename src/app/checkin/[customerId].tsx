import Ionicons from '@expo/vector-icons/Ionicons';
import * as Location from 'expo-location';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/screen-header';
import { Button, TextField } from '@/components/ui';
import { useDateNames } from '@/components/use-date-names';
import { currentCompanyQuery } from '@/features/company/company';
import { customerName, orderCustomerQuery, saveVisit, VISIT_REASONS, type VisitFix, type VisitReason } from '@/features/orders/queries';
import { formatDay } from '@/lib/date-range';
import { todayISO } from '@/lib/money';
import { useAppSelector } from '@/store';
import { colors, font, radius, spacing } from '@/theme';

type Locating = { kind: 'locating' } | { kind: 'fix'; fix: VisitFix } | { kind: 'denied' } | { kind: 'off' } | { kind: 'failed' };

/** getCurrentPositionAsync has no timeout of its own. */
const GPS_TIMEOUT_MS = 20_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('GPS_TIMEOUT')), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

/**
 * Check in · no order (the Qt app's OrderCheckin.qml): why no order was taken, remarks, and
 * where the salesman was (the Qt app switched GPS on but never kept the place). Saved on the
 * phone; the next Sync sends it to VK Nex.
 */
export default function CheckInScreen() {
  const { customerId } = useLocalSearchParams<{ customerId: string }>();
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const names = useDateNames();
  const userId = useAppSelector((st) => st.session.session?.userId ?? '');
  const { data: found } = useLiveQuery(orderCustomerQuery(customerId), [customerId]);
  const c = found[0];

  const [loc, setLoc] = useState<Locating>({ kind: 'locating' });
  const [reason, setReason] = useState<VisitReason | null>(null);
  const [remarks, setRemarks] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const saved = useRef(false);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  const locate = useCallback(async () => {
    const put = (l: Locating) => {
      if (alive.current) setLoc(l);
    };
    put({ kind: 'locating' });
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) return put({ kind: 'denied' });
      if (!(await Location.hasServicesEnabledAsync())) return put({ kind: 'off' });
      // A fix from the last two minutes, close enough, saves waiting for the GPS.
      const pos =
        (await Location.getLastKnownPositionAsync({ maxAge: 120_000, requiredAccuracy: 100 })) ??
        (await withTimeout(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }), GPS_TIMEOUT_MS));
      put({
        kind: 'fix',
        fix: {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracyM: pos.coords.accuracy ?? null,
          locatedAt: new Date(pos.timestamp).toISOString(),
        },
      });
    } catch {
      put({ kind: 'failed' });
    }
  }, []);

  useEffect(() => {
    void locate();
  }, [locate]);

  const save = () => {
    setSubmitted(true);
    if (saved.current || !reason || loc.kind === 'locating') return;
    try {
      // The company chosen in Choose company, if it is one VK Nex sent (else Sync picks it at upload).
      const companyId = currentCompanyQuery().get()?.id ?? null;
      saveVisit({ customerId, companyId, reason, remarks, fix: loc.kind === 'fix' ? loc.fix : null }, userId);
      saved.current = true;
      router.back();
      Alert.alert(t('checkIn.savedTitle'), t('checkIn.savedText'));
    } catch {
      Alert.alert(t('common.error'));
    }
  };

  const other = i18n.language.startsWith('ta') ? 'en' : 'ta';

  return (
    <View style={st.root}>
      <ScreenHeader title={t('checkIn.title')} subtitle={c ? customerName(c) : undefined} backLabel={t('checkIn.back')} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView contentContainerStyle={st.body} keyboardShouldPersistTaps="handled">
          <LocationCard loc={loc} onRetry={() => void locate()} dateText={(iso) => formatDay(todayISO(new Date(iso)), names)} />

          <View accessibilityRole="radiogroup" accessibilityLabel={t('checkIn.reason')} style={{ gap: 6 }}>
            <Text style={st.legend} accessibilityRole="header">
              {t('checkIn.reason')}
            </Text>
            {VISIT_REASONS.map((r) => {
              const on = reason === r;
              return (
                <Pressable
                  key={r}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                  onPress={() => setReason(r)}
                  style={[st.reason, on && st.reasonOn]}
                >
                  <Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={20} color={on ? colors.primary : colors.inputBorder} />
                  <View style={{ flex: 1, gap: 1 }}>
                    <Text style={[st.reasonText, on && { fontWeight: '600' }]}>{t(`checkIn.reasons.${r}`)}</Text>
                    <Text style={st.reasonOther}>{i18n.t(`checkIn.reasons.${r}`, { lng: other })}</Text>
                  </View>
                </Pressable>
              );
            })}
            {submitted && !reason ? <Text style={st.error}>{t('checkIn.reasonRequired')}</Text> : null}
          </View>

          <TextField label={t('checkIn.remarks')} value={remarks} onChangeText={setRemarks} placeholder={t('order.optional')} multiline maxLength={500} style={st.remarks} />
        </ScrollView>
        <View style={[st.footer, { paddingBottom: insets.bottom + spacing.lg }]}>
          <Button title={t('checkIn.save')} onPress={save} loading={loc.kind === 'locating'} style={{ height: 52 }} />
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

function LocationCard({ loc, onRetry, dateText }: { loc: Locating; onRetry: () => void; dateText: (iso: string) => string }) {
  const { t } = useTranslation();
  if (loc.kind === 'locating') {
    return (
      <View style={st.card} accessibilityLiveRegion="polite">
        <ActivityIndicator color={colors.primary} />
        <Text style={st.cardTitle}>{t('checkIn.locating')}</Text>
      </View>
    );
  }
  if (loc.kind === 'fix') {
    const at = new Date(loc.fix.locatedAt);
    const time = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
    return (
      <View style={st.card} accessibilityLiveRegion="polite">
        <View style={[st.pin, { backgroundColor: '#DCFCE7' }]}>
          <Ionicons name="location-outline" size={20} color="#166534" />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={st.cardTitle}>{t('checkIn.located')}</Text>
          <Text style={st.cardNote}>
            {t('checkIn.locatedAt', { date: dateText(loc.fix.locatedAt), time, m: loc.fix.accuracyM === null ? '?' : Math.round(loc.fix.accuracyM) })}
          </Text>
        </View>
      </View>
    );
  }
  const text = loc.kind === 'denied' ? t('checkIn.noPermission') : loc.kind === 'off' ? t('checkIn.servicesOff') : t('checkIn.failed');
  return (
    <View style={st.card} accessibilityRole="alert">
      <View style={[st.pin, { backgroundColor: '#FEF3C7' }]}>
        <Ionicons name="location-outline" size={20} color="#92400E" />
      </View>
      <Text style={[st.cardNote, { flex: 1 }]}>{text}</Text>
      {loc.kind !== 'denied' ? (
        <Pressable accessibilityRole="button" onPress={onRetry} hitSlop={8} style={st.retry}>
          <Text style={st.retryText}>{t('checkIn.retry')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { padding: spacing.lg, gap: spacing.md },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md + 2,
  },
  pin: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontSize: 14, fontWeight: '600', color: colors.text },
  cardNote: { fontSize: 12, color: colors.textMuted },
  retry: { minHeight: 44, justifyContent: 'center' },
  retryText: { fontSize: font.sm, fontWeight: '700', color: colors.primary },
  legend: { fontSize: font.md, fontWeight: '600', color: colors.text, marginBottom: spacing.xs },
  reason: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 56,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md + 2,
    paddingVertical: 6,
    paddingHorizontal: spacing.md + 2,
  },
  reasonOn: { backgroundColor: '#F6E9E9', borderWidth: 2, borderColor: colors.primary },
  reasonText: { fontSize: font.md, color: colors.text },
  reasonOther: { fontSize: font.sm, color: colors.textMuted },
  error: { fontSize: font.sm, color: colors.danger },
  remarks: { minHeight: 72, textAlignVertical: 'top', paddingTop: spacing.md },
  footer: { paddingTop: spacing.md, paddingHorizontal: spacing.lg, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
});
