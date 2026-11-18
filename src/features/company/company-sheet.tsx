import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { BottomSheet, ChoiceRow, SheetButtons, useDraft } from '@/components/sheet';
import { useRefreshBranches } from '@/features/orders/use-send-now';
import { colors, font, spacing } from '@/theme';

import { branchesQuery, companiesQuery, currentBranchQuery, currentCompanyQuery, switchCompany } from './company';

/**
 * Switch company (the side menu, and Take order when none is picked yet), as on the VK Nex desktop:
 * tap a company, then pick one of its branches and Switch. Nothing changes until Switch; Back goes
 * to the companies, and closing the sheet keeps what was picked before. New orders are saved for
 * the company and branch; bills and receipts are made for the company.
 *
 * Branches come with Sync. A company with none on the phone pulls them from VK Nex at once (and
 * Refresh pulls again); the branch step starts on the one picked before, else the company's
 * default, else its only branch.
 */
export function CompanySheet({ visible, onClose, onSwitched }: { visible: boolean; onClose: () => void; onSwitched?: () => void }) {
  const { t } = useTranslation();
  const { data: list } = useLiveQuery(companiesQuery());
  const { data: current } = useLiveQuery(currentCompanyQuery());
  const { data: currentBranch } = useLiveQuery(currentBranchQuery());
  const currentId = current[0]?.id ?? '';
  const currentBranchId = currentBranch[0]?.companyId === currentId ? (currentBranch[0]?.id ?? '') : '';

  // '' = the company list; a company id = that company's branches.
  const [companyId, setCompanyId] = useDraft(visible, '');
  // The branch tapped, or the one picked before; '' = none yet.
  const [tapped, setBranchId] = useState('');
  // VK Nex answered for this company (so "no branches" is VK Nex's answer, not a missing Sync).
  const [pulledFor, setPulledFor] = useState('');
  const { pulling, error, pull, clear } = useRefreshBranches();
  const { data: rows } = useLiveQuery(branchesQuery(companyId), [companyId]);
  // A live read can still hold the company before; only this company's rows count.
  const branchRows = rows.filter((b) => b.companyId === companyId);
  const company = list.find((c) => c.id === companyId);
  // Nothing tapped yet (or not this company's): the default, else the only branch.
  const branchId = branchRows.some((b) => b.id === tapped)
    ? tapped
    : (branchRows.find((b) => b.isDefault) ?? (branchRows.length === 1 ? branchRows[0] : undefined))?.id ?? '';
  const canSwitch = !!branchId;

  const pullFor = async (id: string) => {
    if (await pull()) setPulledFor(id);
  };

  const openCompany = (id: string) => {
    clear();
    setBranchId(id === currentId ? currentBranchId : '');
    setCompanyId(id);
    if (branchesQuery(id).all().length === 0) void pullFor(id);
  };

  const doSwitch = () => {
    if (!companyId || !canSwitch) return;
    switchCompany(companyId, branchId);
    onClose();
    onSwitched?.();
  };

  const branchStep = !!companyId;
  const detailOf = (b: { id: string; isDefault: boolean }) =>
    [b.id === currentBranchId ? t('company.current') : null, b.isDefault ? t('company.default') : null].filter(Boolean).join(' · ') || undefined;

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={branchStep ? t('company.branchTitle') : t('company.title')}
      subtitle={branchStep ? t('company.branchSubtitle', { company: company?.name ?? '' }) : t('company.subtitle')}
      headerAction={branchStep && !pulling ? { title: t('company.refresh'), onPress: () => void pullFor(companyId) } : undefined}
      footer={
        branchStep ? (
          <SheetButtons
            secondary={{ title: t('company.back'), onPress: () => setCompanyId('') }}
            primary={{ title: t('company.switch'), onPress: doSwitch, disabled: !canSwitch }}
          />
        ) : undefined
      }
    >
      {branchStep ? (
        <>
          {pulling ? (
            <View style={st.pulling} accessibilityLiveRegion="polite">
              <ActivityIndicator color={colors.primary} />
              <Text style={st.muted}>{t('company.pulling')}</Text>
            </View>
          ) : null}
          {error ? (
            <Text style={st.error} accessibilityRole="alert">
              {t('company.pullFailed', { message: error })}
            </Text>
          ) : null}
          {!pulling && branchRows.length === 0 ? (
            <Text style={st.none}>{pulledFor === companyId ? t('company.noBranchesOnServer') : t('company.noBranches')}</Text>
          ) : null}
          {branchRows.map((b) => (
            <ChoiceRow key={b.id} selected={b.id === branchId} label={b.name} detail={detailOf(b)} onPress={() => setBranchId(b.id)} />
          ))}
        </>
      ) : (
        <>
          {list.length === 0 ? <Text style={st.none}>{t('company.none')}</Text> : null}
          {list.map((c) => (
            <ChoiceRow
              key={c.id}
              selected={c.id === currentId}
              label={c.name}
              detail={c.id === currentId ? [t('company.current'), currentBranchId ? currentBranch[0]?.name : c.place].filter(Boolean).join(' · ') : (c.place ?? undefined)}
              onPress={() => openCompany(c.id)}
            />
          ))}
        </>
      )}
    </BottomSheet>
  );
}

const st = StyleSheet.create({
  none: { paddingVertical: spacing.lg, fontSize: font.md, color: colors.textMuted },
  muted: { fontSize: font.md, color: colors.textMuted },
  pulling: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.lg },
  error: { paddingVertical: spacing.sm, fontSize: font.sm, color: colors.danger },
});
