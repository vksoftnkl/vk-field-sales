import Ionicons from '@expo/vector-icons/Ionicons';
import * as Location from 'expo-location';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { useDateNames } from '@/components/use-date-names';
import { formatDay } from '@/lib/date-range';
import { todayISO } from '@/lib/money';
import { colors, font, radius, spacing } from '@/theme';

import { hhmm } from './order-status';
import type { VisitFix } from './queries';
import { readLocation, type LocateResult, type LocationApi } from './read-location';

export type Locating = { kind: 'locating' } | LocateResult;

/** expo-location for readLocation. */
const EXPO_LOCATION: LocationApi = {
  getPermission: () => Location.getForegroundPermissionsAsync(),
  requestPermission: () => Location.requestForegroundPermissionsAsync(),
  servicesOn: () => Location.hasServicesEnabledAsync(),
  // Android's "Turn on location" dialog; iOS has none (Settings only).
  askToTurnOn: Platform.OS === 'android' ? () => Location.enableNetworkProviderAsync() : undefined,
  lastKnown: (o) => Location.getLastKnownPositionAsync(o),
  current: () => Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
};

/**
 * Where the salesman is, read once when the screen opens (offline too: GPS needs no internet).
 * `start` = a fix already taken (the visit's), which is kept instead of reading again.
 */
export function useLocate(start: VisitFix | null = null) {
  const [loc, setLoc] = useState<Locating>(start ? { kind: 'fix', fix: start } : { kind: 'locating' });
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
    const r = await readLocation(EXPO_LOCATION);
    put(r);
    return r;
  }, []);

  const hadStart = useRef(start !== null);
  useEffect(() => {
    if (!hadStart.current) void locate();
  }, [locate]);

  return { loc, locate };
}

/**
 * The check-in card: "Checked in at 10:42 · 18 Nov 2026 · GPS ±12 m" on Visit and No order (with
 * `checkedInAt`), or "Location saved with this visit" on Receipt's no-collection check-in.
 * Without a fix it says why, with Try again where that can help.
 */
export function LocationCard({ loc, onRetry, checkedInAt, note }: { loc: Locating; onRetry: () => void; checkedInAt?: string; note?: string }) {
  const { t } = useTranslation();
  const names = useDateNames();
  const title = checkedInAt ? t('so.checkedInAt', { time: hhmm(checkedInAt) }) : t('checkIn.located');

  if (loc.kind === 'locating') {
    return (
      <View style={st.card} accessibilityLiveRegion="polite">
        {checkedInAt ? (
          <View style={[st.pin, { backgroundColor: '#DCFCE7' }]}>
            <Ionicons name="location-outline" size={20} color="#166534" />
          </View>
        ) : (
          <ActivityIndicator color={colors.primary} />
        )}
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={st.cardTitle}>{checkedInAt ? title : t('checkIn.locating')}</Text>
          {checkedInAt ? <Text style={st.cardNote}>{t('checkIn.locating')}</Text> : null}
        </View>
        {checkedInAt ? <ActivityIndicator color={colors.primary} /> : null}
      </View>
    );
  }
  if (loc.kind === 'fix') {
    const at = checkedInAt ?? loc.fix.locatedAt;
    const vars = { date: formatDay(todayISO(new Date(at)), names), time: hhmm(at), m: loc.fix.accuracyM === null ? '?' : Math.round(loc.fix.accuracyM) };
    // The title already says the time when there is a check-in.
    const where = checkedInAt ? t('so.fixLine', vars) : t('checkIn.locatedAt', vars);
    return (
      <View style={st.card} accessibilityLiveRegion="polite">
        <View style={[st.pin, { backgroundColor: '#DCFCE7' }]}>
          <Ionicons name="location-outline" size={20} color="#166534" />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={st.cardTitle}>{title}</Text>
          <Text style={st.cardNote}>{note ? `${where} · ${note}` : where}</Text>
        </View>
      </View>
    );
  }
  const text = loc.kind === 'denied' ? t('checkIn.noPermission') : loc.kind === 'off' ? t('checkIn.servicesOff') : t('checkIn.failed');
  // Refused for good: only the app's settings can allow it now; else ask (or switch on) again.
  const settings = loc.kind === 'denied' && !loc.canAskAgain;
  const action = settings ? t('checkIn.openSettings') : loc.kind === 'denied' ? t('checkIn.allow') : loc.kind === 'off' ? t('checkIn.turnOn') : t('checkIn.retry');
  const press = settings ? () => void Linking.openSettings() : onRetry;
  return (
    <View style={st.card} accessibilityRole="alert">
      <View style={[st.pin, { backgroundColor: '#FEF3C7' }]}>
        <Ionicons name="location-outline" size={20} color="#92400E" />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        {checkedInAt ? <Text style={st.cardTitle}>{title}</Text> : null}
        <Text style={st.cardNote}>{text}</Text>
      </View>
      <Pressable accessibilityRole="button" onPress={press} hitSlop={8} style={st.retry}>
        <Text style={st.retryText}>{action}</Text>
      </Pressable>
    </View>
  );
}

const st = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingVertical: spacing.md - 2,
    paddingHorizontal: spacing.md + 2,
  },
  pin: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontSize: 14, fontWeight: '600', color: colors.text },
  cardNote: { fontSize: 12, color: colors.textMuted },
  retry: { minHeight: 44, justifyContent: 'center' },
  retryText: { fontSize: font.sm, fontWeight: '700', color: colors.primary },
});
