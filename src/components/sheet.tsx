/**
 * Bottom sheets in the approved style (grab handle, title, bordered choices, two buttons at
 * the bottom): the customer filter, beat and type filters, and Choose company.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { normalizeSelection } from '@/lib/selection';
import { colors, font, radius, spacing } from '@/theme';

import { Button } from './ui';

export function BottomSheet({
  visible,
  onClose,
  title,
  subtitle,
  headerAction,
  footer,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  /** Small text button at the right of the title, e.g. "Select all". */
  headerAction?: { title: string; onPress: () => void };
  footer?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={st.backdrop}>
        {/* Backdrop is a sibling, not a parent, so it never takes the sheet's taps or scrolls. */}
        <Pressable style={StyleSheet.absoluteFill} accessibilityLabel={t('common.close')} onPress={onClose} />
        <View style={[st.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
          <View style={st.handle} />
          <View style={st.head}>
            <Text style={st.title} accessibilityRole="header">
              {title}
            </Text>
            {headerAction ? (
              <Pressable accessibilityRole="button" hitSlop={8} onPress={headerAction.onPress} style={st.headAction}>
                <Text style={st.headActionText}>{headerAction.title}</Text>
              </Pressable>
            ) : null}
          </View>
          {subtitle ? <Text style={st.subtitle}>{subtitle}</Text> : null}
          {/* Long lists (many beats) scroll inside the sheet; the buttons stay in view. */}
          <ScrollView style={st.scroll} contentContainerStyle={st.body} bounces={false}>
            {children}
          </ScrollView>
          {footer ? <View style={st.footer}>{footer}</View> : null}
        </View>
      </View>
    </Modal>
  );
}

/**
 * A choice made inside a sheet only counts on Apply. This keeps that draft, and puts it back
 * to the value in use each time the sheet opens, so an earlier unapplied tap never lingers.
 */
export function useDraft<T>(visible: boolean, value: T): [T, (next: T) => void] {
  const [draft, setDraft] = useState(value);
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) setDraft(value);
  }
  return [draft, setDraft];
}

/** Bordered single-choice row with a radio mark; tinted maroon when chosen. */
export function ChoiceRow({
  selected,
  label,
  detail,
  trailing,
  onPress,
}: {
  selected: boolean;
  label: string;
  detail?: string;
  trailing?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={({ pressed }) => [st.choice, selected && st.choiceOn, pressed && !selected && { backgroundColor: colors.bg }]}
    >
      <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={20} color={selected ? colors.primary : colors.inputBorder} />
      <View style={{ flex: 1 }}>
        <Text style={[st.choiceText, selected && st.choiceTextOn]}>{label}</Text>
        {detail ? <Text style={st.detail}>{detail}</Text> : null}
      </View>
      {trailing ? <Text style={st.trailing}>{trailing}</Text> : null}
    </Pressable>
  );
}

/** Checkbox row with a divider under it, for multi-select lists. */
export function CheckRow({
  checked,
  label,
  trailing,
  onPress,
}: {
  checked: boolean;
  label: string;
  trailing?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      onPress={onPress}
      style={({ pressed }) => [st.check, pressed && { backgroundColor: colors.bg }]}
    >
      <Ionicons name={checked ? 'checkbox' : 'square-outline'} size={22} color={checked ? colors.primary : colors.textMuted} />
      <Text style={st.checkText}>{label}</Text>
      {trailing ? <Text style={st.trailing}>{trailing}</Text> : null}
    </Pressable>
  );
}

/** The two buttons at the bottom of a sheet: a quiet one (Reset, Clear) and the main one. */
export function SheetButtons({
  secondary,
  primary,
}: {
  secondary: { title: string; onPress: () => void };
  primary: { title: string; onPress: () => void; disabled?: boolean };
}) {
  return (
    <View style={st.buttons}>
      <Button title={secondary.title} variant="outline" onPress={secondary.onPress} style={st.button} />
      <Button title={primary.title} onPress={primary.onPress} disabled={primary.disabled} style={st.button} />
    </View>
  );
}

export interface PickOption {
  value: string;
  label: string;
  /** Shown at the right, e.g. "18 shops". */
  count?: string;
}

/**
 * Tick several options (beats, customer types). `selected` [] means all, and shows every box
 * ticked. Apply hands back [] again for all-or-none; Clear goes straight back to all.
 */
export function MultiPickSheet({
  visible,
  title,
  options,
  selected,
  onApply,
  onClose,
}: {
  visible: boolean;
  title: string;
  options: readonly PickOption[];
  selected: readonly string[];
  onApply: (ids: string[]) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const allIds = options.map((o) => o.value);
  const [draft, setDraft] = useDraft<readonly string[]>(visible, selected.length ? selected : allIds);
  const toggle = (id: string) => setDraft(draft.includes(id) ? draft.filter((d) => d !== id) : [...draft, id]);
  const apply = (ids: readonly string[]) => {
    onApply(normalizeSelection(ids, allIds));
    onClose();
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={title}
      headerAction={{ title: t('common.selectAll'), onPress: () => setDraft(allIds) }}
      footer={
        <SheetButtons
          secondary={{ title: t('common.clear'), onPress: () => apply([]) }}
          // Nothing ticked would show no shops at all; tick at least one, or use Clear.
          primary={{ title: t('common.apply'), onPress: () => apply(draft), disabled: draft.length === 0 }}
        />
      }
    >
      {/* One child, so the rows touch and only their dividers separate them. */}
      <View>
        {options.map((o) => (
          <CheckRow key={o.value} checked={draft.includes(o.value)} label={o.label} trailing={o.count} onPress={() => toggle(o.value)} />
        ))}
      </View>
    </BottomSheet>
  );
}

const st = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(28,25,23,0.45)' },
  sheet: {
    maxHeight: '88%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: spacing.md,
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.inputBorder },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.lg + 4,
  },
  title: { flex: 1, fontSize: font.lg + 1, fontWeight: '700', color: colors.text },
  headAction: { minHeight: 44, justifyContent: 'center', paddingLeft: spacing.md },
  headActionText: { fontSize: font.sm + 1, fontWeight: '700', color: colors.primary },
  subtitle: { fontSize: font.sm, color: colors.textMuted, paddingHorizontal: spacing.lg + 4, marginBottom: spacing.xs },
  scroll: { flexGrow: 0, flexShrink: 1 },
  body: { paddingHorizontal: spacing.lg + 4, paddingTop: spacing.sm, gap: spacing.sm + 2 },
  footer: { paddingHorizontal: spacing.lg + 4, paddingTop: spacing.lg },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md + 2,
    minHeight: 54,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  // 1 px thicker border, 1 px less padding: the row's contents don't shift when it is picked.
  choiceOn: { borderWidth: 2, borderColor: colors.primary, paddingHorizontal: spacing.lg - 1, paddingVertical: spacing.sm - 1, backgroundColor: colors.primarySoft },
  choiceText: { fontSize: font.md, color: colors.text },
  choiceTextOn: { fontWeight: '700' },
  detail: { marginTop: 2, fontSize: 12, color: colors.textMuted },
  trailing: { fontSize: font.sm, color: colors.textMuted },
  check: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 52,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  checkText: { flex: 1, fontSize: font.md, color: colors.text },
  buttons: { flexDirection: 'row', gap: spacing.sm + 2 },
  button: { flex: 1, height: 52 },
});
