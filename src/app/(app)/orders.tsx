import { FlashList } from '@shopify/flash-list';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

import { Badge, Empty, Row, s } from '@/components/ui';
import { orderQueries } from '@/features/orders/order-repo';
import { formatINR } from '@/lib/money';

const tone = { QUEUED: 'warning', SYNCED: 'success', REJECTED: 'danger', CANCELLED: 'muted' } as const;

export default function OrdersScreen() {
  const { t } = useTranslation();
  const { data } = useLiveQuery(orderQueries.recent());

  return (
    <View style={s.screen}>
      <FlashList
        data={data}
        keyExtractor={(o) => o.clientUuid}
        ListEmptyComponent={<Empty text={t('orders.empty')} />}
        renderItem={({ item: o }) => (
          <View style={s.listRow}>
            <Row style={{ justifyContent: 'space-between' }}>
              <View style={{ flex: 1 }}>
                <Text style={[s.body, { fontWeight: '600' }]}>{o.customerName ?? '—'}</Text>
                <Text style={s.muted}>
                  {o.orderNo ?? 'Not uploaded'} · {o.orderDate}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                <Text style={[s.body, { fontWeight: '700' }]}>{formatINR(o.totalPaise)}</Text>
                <Badge text={o.status} tone={tone[o.status]} />
              </View>
            </Row>
          </View>
        )}
      />
    </View>
  );
}
