import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { canLoadMore, PAGE_SIZE } from '@/lib/paging';
import { colors, font, spacing } from '@/theme';

/**
 * How many rows a list has loaded: 50 at first, 50 more each time it is scrolled near the end
 * (the user's choice, 2026-11-19). Back to the first 50 whenever `resetKey` changes (another
 * search, filter, company or customer level). Kept with the key it was set for, so no effect has
 * to reset it.
 *
 * `more(loaded, total)` is for FlatList's onEndReached: it asks for the next 50 only once the
 * last 50 have come and the list has more.
 */
export function useLoadMore(resetKey: string): { limit: number; more: (loaded: number, total: number) => void } {
  const [state, setState] = useState({ key: resetKey, limit: PAGE_SIZE });
  const limit = state.key === resetKey ? state.limit : PAGE_SIZE;
  const more = (loaded: number, total: number) => {
    if (canLoadMore(loaded, limit, total)) setState({ key: resetKey, limit: limit + PAGE_SIZE });
  };
  return { limit, more };
}

/** Under the list: "Loading more…" while more rows are to come, and "Showing 100 of 1,234 items". */
export function LoadMoreFooter({ shown, total }: { shown: number; total: number }) {
  const { t } = useTranslation();
  if (total <= PAGE_SIZE || shown === 0) return null;
  const loading = shown < total;
  return (
    <View style={st.footer} accessibilityLiveRegion="polite">
      {loading ? (
        <View style={st.loading}>
          <ActivityIndicator color={colors.primary} />
          <Text style={st.text}>{t('paging.loadingMore')}</Text>
        </View>
      ) : null}
      <Text style={st.count}>{t('paging.showing', { shown, total })}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  footer: { alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.lg },
  loading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  text: { fontSize: font.sm, color: colors.textLabel },
  count: { fontSize: 12, color: colors.textMuted },
});
