import Ionicons from '@expo/vector-icons/Ionicons';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View, type ScrollViewInstance } from 'react-native';

import { dateParts, isoOf, monthGrid, weekday } from '@/lib/date-range';
import { colors, font, radius, spacing } from '@/theme';

import { useDateNames } from './use-date-names';

const FIRST_YEAR = 2000;
const LAST_YEAR = 2099;
const YEAR_ROW = 44;

/**
 * Pick one date, in the app's maroon (the Qt app's DatePicker.qml): the year and the picked
 * day on the band, month by month with arrows, a year list behind the year. Only OK commits.
 */
export function CalendarDialog({
  visible,
  value,
  today,
  onCancel,
  onPick,
}: {
  visible: boolean;
  /** 'YYYY-MM-DD'; null opens on today. */
  value: string | null;
  today: string;
  onCancel: () => void;
  onPick: (iso: string) => void;
}) {
  const { t } = useTranslation();
  const names = useDateNames();
  const [picked, setPicked] = useState(value ?? today);
  const [month, setMonth] = useState(() => ({ y: dateParts(value ?? today).y, m: dateParts(value ?? today).m }));
  const [years, setYears] = useState(false);
  const yearList = useRef<ScrollViewInstance>(null);

  // Each opening starts again from the field's date (reset while rendering, as useDraft does).
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      const start = value ?? today;
      setPicked(start);
      setMonth({ y: dateParts(start).y, m: dateParts(start).m });
      setYears(false);
    }
  }

  const p = dateParts(picked);
  const move = (by: number) =>
    setMonth(({ y, m }) => {
      const n = y * 12 + (m - 1) + by;
      const ny = Math.floor(n / 12);
      return ny < FIRST_YEAR || ny > LAST_YEAR ? { y, m } : { y: ny, m: (n % 12) + 1 };
    });

  const chooseYear = (y: number) => {
    setMonth(({ m }) => ({ y, m }));
    setYears(false);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={st.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} accessibilityLabel={t('calendar.cancel')} onPress={onCancel} />
        <View style={st.dialog} accessibilityViewIsModal accessibilityLabel={t('calendar.title')}>
          <View style={st.band}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('calendar.chooseYear', { year: month.y })}
              onPress={() => setYears((v) => !v)}
              hitSlop={8}
              style={st.yearBtn}
            >
              <Text style={st.yearText}>{month.y}</Text>
            </Pressable>
            <Text style={st.bigDate}>
              {names.weekdaysShort[weekday(picked)]}, {p.d} {names.months[p.m - 1]}
            </Text>
          </View>

          {years ? (
            <ScrollView
              ref={yearList}
              style={{ height: YEAR_ROW * 7 }}
              // Opens with the shown year in the middle (contentOffset is iOS-only).
              onLayout={() => yearList.current?.scrollTo({ y: Math.max(0, (month.y - FIRST_YEAR - 3) * YEAR_ROW), animated: false })}
            >
              {Array.from({ length: LAST_YEAR - FIRST_YEAR + 1 }, (_, i) => FIRST_YEAR + i).map((y) => (
                <Pressable
                  key={y}
                  accessibilityRole="button"
                  accessibilityState={{ selected: y === month.y }}
                  onPress={() => chooseYear(y)}
                  style={st.yearRow}
                >
                  <Text style={[st.yearRowText, y === month.y && st.yearRowOn]}>{y}</Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : (
            <>
              <View style={st.monthRow}>
                <Pressable accessibilityRole="button" accessibilityLabel={t('calendar.prevMonth')} onPress={() => move(-1)} style={st.arrow}>
                  <Ionicons name="chevron-back" size={20} color={colors.textLabel} />
                </Pressable>
                <Text style={st.monthText} accessibilityRole="header">
                  {names.monthsLong[month.m - 1]} {month.y}
                </Text>
                <Pressable accessibilityRole="button" accessibilityLabel={t('calendar.nextMonth')} onPress={() => move(1)} style={st.arrow}>
                  <Ionicons name="chevron-forward" size={20} color={colors.textLabel} />
                </Pressable>
              </View>
              <View style={st.grid}>
                {names.weekdaysMin.map((w, i) => (
                  <Text key={`w${i}`} style={st.weekday} importantForAccessibility="no">
                    {w}
                  </Text>
                ))}
              </View>
              <View style={[st.grid, { paddingBottom: spacing.sm }]}>
                {monthGrid(month.y, month.m).map((d, i) => {
                  if (d === null) return <View key={`e${i}`} style={st.cell} />;
                  const iso = isoOf(month.y, month.m, d);
                  const on = iso === picked;
                  const isToday = iso === today;
                  return (
                    <Pressable
                      key={iso}
                      accessibilityRole="button"
                      accessibilityLabel={`${d} ${names.monthsLong[month.m - 1]} ${month.y}`}
                      accessibilityState={{ selected: on }}
                      onPress={() => setPicked(iso)}
                      style={st.cell}
                    >
                      <View style={[st.day, isToday && !on && st.dayToday, on && st.dayOn]}>
                        <Text style={[st.dayText, on && st.dayTextOn]}>{d}</Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            </>
          )}

          <View style={st.buttons}>
            <Pressable accessibilityRole="button" onPress={onCancel} style={st.textBtn}>
              <Text style={st.textBtnLabel}>{t('calendar.cancel')}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => onPick(picked)} style={st.okBtn}>
              <Text style={st.okLabel}>{t('calendar.ok')}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'center', padding: spacing.lg + 4, backgroundColor: 'rgba(28,25,23,0.5)' },
  dialog: { backgroundColor: colors.surface, borderRadius: 20, overflow: 'hidden' },
  band: { backgroundColor: colors.primary, paddingHorizontal: spacing.xl - 4, paddingVertical: spacing.lg, gap: 2 },
  yearBtn: { alignSelf: 'flex-start', minHeight: 32, justifyContent: 'center' },
  yearText: { fontSize: 14, fontWeight: '500', color: colors.onPrimaryMuted },
  bigDate: { fontSize: 26, fontWeight: '600', color: colors.onPrimary },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.sm, paddingTop: spacing.sm, paddingBottom: spacing.xs },
  arrow: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  monthText: { fontSize: font.md, fontWeight: '600', color: colors.text },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: spacing.md },
  weekday: { width: `${100 / 7}%`, textAlign: 'center', fontSize: 12, fontWeight: '600', color: colors.textMuted, paddingBottom: spacing.xs },
  cell: { width: `${100 / 7}%`, height: 44, alignItems: 'center', justifyContent: 'center' },
  day: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  dayToday: { borderWidth: 1, borderColor: colors.primary },
  dayOn: { backgroundColor: colors.primary },
  dayText: { fontSize: 14, color: colors.text },
  dayTextOn: { color: colors.onPrimary, fontWeight: '700' },
  yearRow: { height: YEAR_ROW, alignItems: 'center', justifyContent: 'center' },
  yearRowText: { fontSize: font.md, color: colors.text },
  yearRowOn: { fontSize: font.lg, fontWeight: '700', color: colors.primary },
  buttons: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, paddingTop: spacing.xs },
  textBtn: { minHeight: 44, paddingHorizontal: spacing.lg, borderRadius: radius.md, justifyContent: 'center' },
  textBtnLabel: { fontSize: font.md, fontWeight: '600', color: colors.textLabel },
  okBtn: { minHeight: 44, paddingHorizontal: spacing.xl - 4, borderRadius: radius.md, justifyContent: 'center', backgroundColor: colors.primary },
  okLabel: { fontSize: font.md, fontWeight: '600', color: colors.onPrimary },
});
