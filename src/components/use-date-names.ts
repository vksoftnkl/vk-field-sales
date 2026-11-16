import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { DateNames } from '@/lib/date-range';

export interface AllDateNames extends DateNames {
  monthsLong: readonly string[];
  /** "Su" … "Sa", Sunday first. */
  weekdaysMin: readonly string[];
  /** "Sun" … "Sat", Sunday first. */
  weekdaysShort: readonly string[];
}

const list = (v: unknown, n: number): string[] => (Array.isArray(v) && v.length === n ? v.map(String) : Array.from({ length: n }, () => ''));

/** Month and weekday names in the app's language (dates.* in the translations). */
export function useDateNames(): AllDateNames {
  const { t, i18n } = useTranslation();
  return useMemo(
    () => ({
      months: list(t('dates.monthsShort', { returnObjects: true }), 12),
      monthsLong: list(t('dates.monthsLong', { returnObjects: true }), 12),
      weekdaysMin: list(t('dates.weekdaysMin', { returnObjects: true }), 7),
      weekdaysShort: list(t('dates.weekdaysShort', { returnObjects: true }), 7),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the names change only with the language
    [i18n.language],
  );
}
