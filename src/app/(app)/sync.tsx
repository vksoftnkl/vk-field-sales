import { FlashList } from '@shopify/flash-list';
import { desc, ne } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';

import { SyncPanel } from '@/components/SyncPanel';
import { Badge, Button, Empty, Row, s } from '@/components/ui';
import { getServerAddress } from '@/config/server';
import { db } from '@/db/client';
import { outbox } from '@/db/schema';
import { requeue } from '@/sync/outbox';
import { colors, spacing } from '@/theme';

const tone = { PENDING: 'warning', SENDING: 'info', REJECTED: 'danger', ACKED: 'success' } as const;

/**
 * Sync center: the Sync button (the only way data moves to/from the server PC),
 * every record that hasn't uploaded yet, its state, and why.
 */
export default function SyncScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { data } = useLiveQuery(db.select().from(outbox).where(ne(outbox.status, 'ACKED')).orderBy(desc(outbox.id)));

  // Re-read when coming back from Server settings.
  const [server, setServer] = useState(getServerAddress);
  useFocusEffect(useCallback(() => setServer(getServerAddress()), []));

  return (
    <View style={s.screen}>
      <View style={{ padding: spacing.lg, gap: spacing.md }}>
        <Pressable onPress={() => router.push('/settings')}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text style={s.muted}>
              {t('sync.server')}: {server ? `${server.host}:${server.port}` : '—'}
            </Text>
            <Text style={[s.muted, { color: colors.primary, fontWeight: '600' }]}>{t('more.serverSettings')} ›</Text>
          </Row>
        </Pressable>
        <SyncPanel reason="manual" />
        <Text style={[s.body, { fontWeight: '700' }]}>{t('sync.queue')}</Text>
      </View>
      <FlashList
        data={data}
        keyExtractor={(r) => String(r.id)}
        ListEmptyComponent={<Empty text={t('sync.allClear')} />}
        renderItem={({ item: r }) => (
          <View style={s.listRow}>
            <Row style={{ justifyContent: 'space-between' }}>
              <View style={{ flex: 1, paddingRight: spacing.sm }}>
                <Text style={[s.body, { fontWeight: '600', textTransform: 'capitalize' }]}>{r.entity}</Text>
                <Text style={s.muted} numberOfLines={1}>
                  {r.clientUuid.slice(-12)} · tries {r.attempts}
                </Text>
                {r.lastError ? <Text style={[s.muted, { color: '#B91C1C' }]}>{r.lastError}</Text> : null}
              </View>
              <View style={{ alignItems: 'flex-end', gap: 6 }}>
                <Badge text={r.status} tone={tone[r.status]} />
                {r.status === 'REJECTED' ? <Button title={t('sync.retry')} variant="secondary" style={{ height: 32 }} onPress={() => requeue(r.id)} /> : null}
              </View>
            </Row>
          </View>
        )}
      />
    </View>
  );
}
