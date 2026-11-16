import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { CalendarDialog } from '@/components/calendar-dialog';
import { Button } from '@/components/ui';
import { parseDMY, toDMY, type DateRange } from '@/lib/date-range';
import { colors, font, radius, spacing } from '@/theme';

type Field = 'from' | 'to';
type DateError = 'fromMissing' | 'toMissing' | 'invalid' | 'reversed';

/** What is wrong with the two typed dates, per field (empty = OK). */
export function checkCustomDates(fromText: string, toText: string): Partial<Record<Field, DateError>> {
  const errors: Partial<Record<Field, DateError>> = {};
  const from = parseDMY(fromText);
  const to = parseDMY(toText);
  if (!fromText.trim()) errors.from = 'fromMissing';
  else if (!from) errors.from = 'invalid';
  if (!toText.trim()) errors.to = 'toMissing';
  else if (!to) errors.to = 'invalid';
  if (from && to && to < from) errors.to = 'reversed';
  return errors;
}

/**
 * Custom dates (the Qt app's DatePopup.qml): From and To typed as dd-mm-yyyy or picked on the
 * calendar. Search says what is missing instead of doing nothing; Cancel goes back to the sheet.
 */
export function CustomDatesDialog({
  visible,
  initial,
  today,
  onCancel,
  onSearch,
}: {
  visible: boolean;
  initial: DateRange;
  today: string;
  onCancel: () => void;
  onSearch: (r: DateRange) => void;
}) {
  const { t } = useTranslation();
  const [fromText, setFromText] = useState(toDMY(initial.from));
  const [toText, setToText] = useState(toDMY(initial.to));
  const [submitted, setSubmitted] = useState(false);
  const [calendarFor, setCalendarFor] = useState<Field | null>(null);

  // Each opening starts again from the dates in use (reset while rendering, as useDraft does).
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setFromText(toDMY(initial.from));
      setToText(toDMY(initial.to));
      setSubmitted(false);
      setCalendarFor(null);
    }
  }

  const errors = submitted ? checkCustomDates(fromText, toText) : {};

  const search = () => {
    setSubmitted(true);
    if (Object.keys(checkCustomDates(fromText, toText)).length > 0) return;
    onSearch({ from: parseDMY(fromText)!, to: parseDMY(toText)! });
  };

  const field = (which: Field, label: string, value: string, set: (v: string) => void, pickLabel: string) => {
    const e = errors[which];
    return (
      <View style={{ gap: 6 }}>
        <Text style={st.label}>{label}</Text>
        <View style={[st.inputBox, !!e && st.inputBoxError]}>
          <TextInput
            value={value}
            onChangeText={set}
            placeholder={t('customDates.placeholder')}
            placeholderTextColor={colors.textMuted}
            accessibilityLabel={label}
            keyboardType="numbers-and-punctuation"
            autoCorrect={false}
            maxLength={10}
            style={st.input}
          />
          <Pressable accessibilityRole="button" accessibilityLabel={pickLabel} onPress={() => setCalendarFor(which)} style={st.calBtn}>
            <Ionicons name="calendar-outline" size={20} color={colors.primary} />
          </Pressable>
        </View>
        {e ? <Text style={st.error}>{t(`customDates.errors.${e}`)}</Text> : null}
      </View>
    );
  };

  const calendarValue = calendarFor ? parseDMY(calendarFor === 'from' ? fromText : toText) : null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView behavior="padding" style={st.backdrop}>
        <View style={st.dialog} accessibilityViewIsModal>
          <Text style={st.title} accessibilityRole="header">
            {t('customDates.title')}
          </Text>
          {field('from', t('customDates.from'), fromText, setFromText, t('customDates.pickFrom'))}
          {field('to', t('customDates.to'), toText, setToText, t('customDates.pickTo'))}
          <View style={st.buttons}>
            <Button title={t('customDates.cancel')} variant="outline" onPress={onCancel} style={{ flex: 1 }} />
            <Button title={t('customDates.search')} onPress={search} style={{ flex: 1 }} />
          </View>
        </View>
      </KeyboardAvoidingView>
      <CalendarDialog
        visible={calendarFor !== null}
        value={calendarValue}
        today={today}
        onCancel={() => setCalendarFor(null)}
        onPick={(iso) => {
          (calendarFor === 'from' ? setFromText : setToText)(toDMY(iso));
          setCalendarFor(null);
        }}
      />
    </Modal>
  );
}

const st = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'center', padding: spacing.xl, backgroundColor: 'rgba(28,25,23,0.5)' },
  dialog: { backgroundColor: colors.surface, borderRadius: 20, padding: spacing.xl - 4, gap: spacing.md + 2 },
  title: { fontSize: 18, fontWeight: '600', color: colors.text },
  label: { fontSize: font.sm, fontWeight: '500', color: colors.textLabel },
  inputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 48,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: radius.lg - 2,
    paddingLeft: spacing.md + 2,
    paddingRight: spacing.xs,
    backgroundColor: colors.surface,
  },
  inputBoxError: { borderWidth: 2, borderColor: colors.danger, paddingLeft: spacing.md + 1 },
  input: { flex: 1, fontSize: 16, color: colors.text, padding: 0, height: '100%' },
  calBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  error: { fontSize: 12, fontWeight: '500', color: colors.danger },
  buttons: { flexDirection: 'row', gap: spacing.md - 2, marginTop: spacing.xs },
});
