import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text } from 'react-native';

import { BottomSheet, ChoiceRow, useDraft } from '@/components/sheet';
import { Button } from '@/components/ui';
import { colors, font, spacing } from '@/theme';

import { companiesQuery, currentCompanyQuery, switchCompany } from './company';

/** "Choose company" sheet, from Switch company in the side menu (the Qt CompanySelectionPopup). */
export function CompanySheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { data: list } = useLiveQuery(companiesQuery());
  const { data: current } = useLiveQuery(currentCompanyQuery());
  const currentId = current[0]?.id ?? '';
  const [picked, setPicked] = useDraft(visible, currentId);

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={t('company.title')}
      subtitle={t('company.subtitle')}
      footer={
        <Button
          title={t('company.switch')}
          disabled={!picked}
          onPress={() => {
            if (picked && picked !== currentId) switchCompany(picked);
            onClose();
          }}
          style={st.button}
        />
      }
    >
      {list.length === 0 ? <Text style={st.none}>{t('company.none')}</Text> : null}
      {list.map((c) => (
        <ChoiceRow
          key={c.id}
          selected={c.id === picked}
          label={c.name}
          detail={c.id === currentId ? (c.place ? t('company.currentAt', { place: c.place }) : t('company.current')) : (c.place ?? undefined)}
          onPress={() => setPicked(c.id)}
        />
      ))}
    </BottomSheet>
  );
}

const st = StyleSheet.create({
  button: { height: 52 },
  none: { paddingVertical: spacing.lg, fontSize: font.md, color: colors.textMuted },
});
