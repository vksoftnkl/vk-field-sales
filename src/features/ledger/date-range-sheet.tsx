import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text } from 'react-native';

import { BottomSheet, ChoiceRow } from '@/components/sheet';
import { useDateNames } from '@/components/use-date-names';
import { formatRangeShort, rangeFor, RANGE_KEYS, type DateRange, type RangeKey } from '@/lib/date-range';
import { colors, font, spacing } from '@/theme';

/** What the ledger shows: a named range (worked out from today) or dates typed in Custom dates. */
export type RangeChoice = { key: RangeKey } | { key: 'custom'; range: DateRange };

export const choiceRange = (c: RangeChoice, today: string): DateRange => (c.key === 'custom' ? c.range : rangeFor(c.key, today));

/**
 * The Ledger statement's Date range sheet (the Qt app's Filters.qml): one tap picks a range
 * and closes; Custom dates… opens the From / To dialog.
 */
export function DateRangeSheet({
  visible,
  value,
  today,
  onPick,
  onCustom,
  onClose,
}: {
  visible: boolean;
  value: RangeChoice;
  today: string;
  onPick: (key: RangeKey) => void;
  onCustom: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const names = useDateNames();
  return (
    <BottomSheet visible={visible} onClose={onClose} title={t('dateRange.title')} subtitle={t('dateRange.note')}>
      {RANGE_KEYS.map((key) => (
        <ChoiceRow
          key={key}
          selected={value.key === key}
          label={t(`dateRange.ranges.${key}`)}
          trailing={formatRangeShort(rangeFor(key, today), names)}
          onPress={() => onPick(key)}
        />
      ))}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected: value.key === 'custom' }}
        onPress={onCustom}
        style={({ pressed }) => [st.custom, pressed && { opacity: 0.7 }]}
      >
        <Ionicons name="calendar-outline" size={20} color={colors.primary} />
        <Text style={st.customText}>{t('dateRange.custom')}</Text>
        {value.key === 'custom' ? <Text style={st.customDates}>{formatRangeShort(value.range, names)}</Text> : null}
      </Pressable>
    </BottomSheet>
  );
}

const st = StyleSheet.create({
  custom: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.xs },
  customText: { flex: 1, fontSize: font.md, fontWeight: '600', color: colors.primary },
  customDates: { fontSize: font.sm, color: colors.textMuted },
});
