import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { BottomSheet, CheckRow, SheetButtons, useDraft } from '@/components/sheet';
import { colors, font, spacing } from '@/theme';

export interface ItemFilter {
  /** [] = all. */
  groupIds: string[];
  brandIds: string[];
}

/** Order entry's filter button: tick item groups and brands. Nothing ticked in a section = all. */
export function ItemFilterSheet({
  visible,
  value,
  groups,
  brands,
  onApply,
  onClose,
}: {
  visible: boolean;
  value: ItemFilter;
  groups: readonly { id: string; name: string }[];
  brands: readonly { id: string; name: string }[];
  onApply: (f: ItemFilter) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useDraft(visible, value);
  const toggle = (key: keyof ItemFilter, id: string) => {
    const list = draft[key];
    setDraft({ ...draft, [key]: list.includes(id) ? list.filter((x) => x !== id) : [...list, id] });
  };
  const apply = (f: ItemFilter) => {
    onApply(f);
    onClose();
  };

  const section = (key: keyof ItemFilter, title: string, options: readonly { id: string; name: string }[]) =>
    options.length ? (
      <View>
        <Text style={st.section} accessibilityRole="header">
          {title}
        </Text>
        {options.map((o) => (
          <CheckRow key={o.id} checked={draft[key].includes(o.id)} label={o.name} onPress={() => toggle(key, o.id)} />
        ))}
      </View>
    ) : null;

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={t('order.filterTitle')}
      footer={
        <SheetButtons
          secondary={{ title: t('common.clear'), onPress: () => apply({ groupIds: [], brandIds: [] }) }}
          primary={{ title: t('common.apply'), onPress: () => apply(draft) }}
        />
      }
    >
      {section('groupIds', t('order.groups'), groups)}
      {section('brandIds', t('order.brands'), brands)}
    </BottomSheet>
  );
}

const st = StyleSheet.create({
  section: { marginTop: spacing.sm, marginBottom: spacing.xs, fontSize: font.sm, fontWeight: '700', letterSpacing: 0.5, color: colors.primary, textTransform: 'uppercase' },
});
