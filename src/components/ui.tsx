/**
 * Small in-house UI kit. Deliberately no heavy component library — keeps the
 * app light on low-end phones and keeps the maroon/brass look consistent.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { filterOptions } from '@/lib/search';
import { colors, font, radius, spacing } from '@/theme';

/** Full-width maroon button; shows a spinner and ignores taps while `loading`. */
export function Button({
  title,
  onPress,
  loading,
  disabled,
  style,
}: {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
}) {
  const fg = colors.onPrimary;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        s.btn,
        { backgroundColor: colors.primary, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : <Text style={[s.btnText, { color: fg }]}>{title}</Text>}
    </Pressable>
  );
}

/** Password input with a show/hide eye; the border turns maroon while typing. */
export function PasswordField({ label, ...props }: Omit<TextInputProps, 'secureTextEntry'> & { label?: string }) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const [focused, setFocused] = useState(false);
  return (
    <View style={s.field}>
      {label ? <Text style={s.label}>{label}</Text> : null}
      <View style={[s.input, s.inputRow, focused && s.inputFocused]}>
        <TextInput
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel={label}
          {...props}
          secureTextEntry={!visible}
          onFocus={(e) => {
            setFocused(true);
            props.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            props.onBlur?.(e);
          }}
          style={[s.inputText, { flex: 1, height: '100%' }]}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={visible ? t('common.hidePassword') : t('common.showPassword')}
          hitSlop={12}
          onPress={() => setVisible((v) => !v)}
        >
          <Ionicons name={visible ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.textMuted} />
        </Pressable>
      </View>
    </View>
  );
}

export interface SelectOption {
  value: string;
  label: string;
}

/** Below this many choices a search box is just in the way; everything fits on screen. */
const SEARCH_MIN_OPTIONS = 8;

/**
 * Looks like an input; tapping it opens a bottom sheet to pick from. In-house instead of a
 * native picker so it looks the same on every phone and needs no extra native module.
 * `searchable` adds a search box to the sheet once the list is long enough to need one.
 */
export function SelectField({
  label,
  value,
  options,
  onChange,
  placeholder,
  searchable,
}: {
  label?: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  searchable?: boolean;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selected = options.find((o) => o.value === value);
  const withSearch = !!searchable && options.length > SEARCH_MIN_OPTIONS;
  const shown = useMemo(() => (withSearch ? filterOptions(options, query) : options), [withSearch, options, query]);
  const close = () => setOpen(false);

  return (
    <View style={s.field}>
      {label ? <Text style={s.label}>{label}</Text> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityValue={{ text: selected?.label ?? placeholder ?? '' }}
        onPress={() => {
          setQuery('');
          setOpen(true);
        }}
        style={[s.input, s.inputRow]}
      >
        <Text style={[s.inputText, !selected && { color: colors.textMuted }]} numberOfLines={1}>
          {selected?.label ?? placeholder ?? ''}
        </Text>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
        <KeyboardAvoidingView style={s.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          {/* Backdrop is a sibling, not a parent, so it never steals the list's scroll gestures. */}
          <Pressable style={StyleSheet.absoluteFill} accessibilityLabel={t('common.close')} onPress={close} />
          {/* Fixed height while searching, so the search box doesn't jump as the list shrinks. */}
          {/* The modal is edge-to-edge on Android too, so keep the last row clear of the navigation bar. */}
          <View style={[s.sheet, withSearch && s.sheetTall, { paddingBottom: spacing.lg + insets.bottom }]}>
            {label ? <Text style={s.sheetTitle}>{label}</Text> : null}
            {withSearch ? (
              <View style={[s.input, s.inputRow, s.sheetSearch]}>
                <Ionicons name="search" size={18} color={colors.textMuted} />
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder={t('common.search')}
                  placeholderTextColor={colors.textMuted}
                  accessibilityLabel={t('common.search')}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="search"
                  style={[s.inputText, { flex: 1, height: '100%' }]}
                />
              </View>
            ) : null}
            <FlatList
              data={shown}
              keyExtractor={(o) => o.value || '(none)'}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={<Text style={[s.muted, s.sheetEmpty]}>{t('common.noMatches')}</Text>}
              renderItem={({ item }) => {
                const on = item.value === value;
                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    style={({ pressed }) => [s.option, pressed && { backgroundColor: colors.bg }]}
                    onPress={() => {
                      onChange(item.value);
                      close();
                    }}
                  >
                    <Text style={[s.body, { flex: 1 }, on && { color: colors.primary, fontWeight: '700' }]}>{item.label}</Text>
                    {on ? <Ionicons name="checkmark" size={20} color={colors.primary} /> : null}
                  </Pressable>
                );
              }}
            />
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  btn: { height: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg },
  btnText: { fontSize: font.md, fontWeight: '600' },
  field: { marginBottom: spacing.lg },
  label: { fontSize: font.sm, color: colors.textLabel, fontWeight: '600', marginBottom: spacing.xs + 2 },
  input: {
    height: 48,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    fontSize: font.md,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  // 1 px thicker border, 1 px less padding: the text doesn't shift when the field gains focus.
  inputFocused: { borderColor: colors.primary, borderWidth: 2, paddingHorizontal: spacing.md - 1 },
  inputText: { fontSize: font.md, color: colors.text, padding: 0 },
  backdrop: { flex: 1, backgroundColor: 'rgba(28,25,23,0.45)', justifyContent: 'flex-end', paddingTop: spacing.xxl * 2 },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingTop: spacing.lg,
    maxHeight: '70%',
  },
  // flexShrink lets the sheet give way to the keyboard instead of pushing the search box off screen.
  sheetTall: { height: '70%', flexShrink: 1 },
  sheetTitle: { fontSize: font.lg, fontWeight: '700', color: colors.text, paddingHorizontal: spacing.lg, marginBottom: spacing.sm },
  sheetSearch: { marginHorizontal: spacing.lg, marginBottom: spacing.sm },
  sheetEmpty: { textAlign: 'center', paddingVertical: spacing.xl },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  title: { fontSize: font.xl, fontWeight: '700', color: colors.text },
  body: { fontSize: font.md, color: colors.text },
  muted: { fontSize: font.sm, color: colors.textMuted },
});
