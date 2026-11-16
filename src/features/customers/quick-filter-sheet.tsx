import { useTranslation } from 'react-i18next';

import { BottomSheet, ChoiceRow, SheetButtons, useDraft } from '@/components/sheet';

import { QUICK_FILTERS, type QuickFilter } from './customer-list';

/**
 * "Show customers" sheet from the filter button, like the Qt app's popup: All / Un-billed /
 * No collection, each with how many shops it would show. A choice only takes effect on Apply;
 * Reset goes straight back to All; tapping outside changes nothing.
 */
export function QuickFilterSheet({
  visible,
  value,
  counts,
  onApply,
  onClose,
}: {
  visible: boolean;
  value: QuickFilter;
  counts: Record<QuickFilter, number>;
  onApply: (value: QuickFilter) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [picked, setPicked] = useDraft(visible, value);
  const apply = (q: QuickFilter) => {
    onApply(q);
    onClose();
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={t('customers.quickTitle')}
      footer={
        <SheetButtons
          secondary={{ title: t('common.reset'), onPress: () => apply('all') }}
          primary={{ title: t('common.apply'), onPress: () => apply(picked) }}
        />
      }
    >
      {QUICK_FILTERS.map((q) => (
        <ChoiceRow
          key={q}
          selected={q === picked}
          label={t(`customers.quick.${q}`)}
          trailing={String(counts[q])}
          onPress={() => setPicked(q)}
        />
      ))}
    </BottomSheet>
  );
}
