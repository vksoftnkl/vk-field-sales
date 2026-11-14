import { FlashList } from '@shopify/flash-list';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, Text, View } from 'react-native';

import { Empty, Field, Row, s } from '@/components/ui';
import { masterQueries } from '@/features/masters/queries';
import { formatINR } from '@/lib/money';
import { useAppSelector } from '@/store';
import { runSync } from '@/sync/engine';
import { colors, spacing } from '@/theme';

export default function CustomersScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const [search, setSearch] = useState('');
  const running = useAppSelector((st) => st.sync.running);
  const { data } = useLiveQuery(masterQueries.customers(search), [search]);

  return (
    <View style={s.screen}>
      <View style={{ padding: spacing.md, paddingBottom: 0 }}>
        <Field placeholder={t('customers.search')} value={search} onChangeText={setSearch} autoCorrect={false} />
      </View>
      <FlashList
        data={data}
        keyExtractor={(c) => c.id}
        refreshControl={<RefreshControl refreshing={running} onRefresh={() => void runSync('pull-to-refresh')} colors={[colors.primary]} />}
        ListEmptyComponent={<Empty text={t('customers.empty')} />}
        renderItem={({ item: c }) => (
          <Pressable
            style={s.listRow}
            onPress={() => router.push({ pathname: '/order/new', params: { customerId: c.id } })}
          >
            <Row style={{ justifyContent: 'space-between' }}>
              <View style={{ flex: 1 }}>
                <Text style={[s.body, { fontWeight: '600' }]}>{c.name}</Text>
                <Text style={s.muted}>{[c.code, c.mobile].filter(Boolean).join(' · ')}</Text>
              </View>
              {c.outstandingPaise > 0 ? (
                <Text style={{ color: colors.danger, fontWeight: '600' }}>{formatINR(c.outstandingPaise)}</Text>
              ) : null}
            </Row>
          </Pressable>
        )}
      />
    </View>
  );
}
