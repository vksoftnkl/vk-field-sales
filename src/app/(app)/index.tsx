import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { count, eq } from 'drizzle-orm';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScrollView, Text, View } from 'react-native';

import { Button, Card, Row, s } from '@/components/ui';
import { db } from '@/db/client';
import { deviceMeta, outbox } from '@/db/schema';
import { useAppSelector } from '@/store';
import { colors, font, spacing } from '@/theme';

export default function TodayScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const session = useAppSelector((st) => st.session.session);
  const deviceStatus = useAppSelector((st) => st.session.deviceStatus);

  const { data: counts } = useLiveQuery(db.select({ status: outbox.status, n: count() }).from(outbox).groupBy(outbox.status));
  const { data: lastSync } = useLiveQuery(db.select().from(deviceMeta).where(eq(deviceMeta.key, 'lastSyncAt')));

  const n = (st: string) => counts.find((c) => c.status === st)?.n ?? 0;
  const pending = n('PENDING') + n('SENDING');
  const rejected = n('REJECTED');
  const last = lastSync[0]?.value;

  return (
    <ScrollView style={s.screen} contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
      <Text style={s.title}>{t('today.hello', { name: [session?.displayName, session?.secondDisplayName].filter(Boolean).join(' & ') })}</Text>

      {deviceStatus === 'PENDING' ? (
        <Card style={{ borderColor: colors.warning }}>
          <Text style={s.body}>{t('today.pendingApproval')}</Text>
        </Card>
      ) : null}

      <Row style={{ gap: spacing.md }}>
        <Stat label={t('today.pending')} value={pending} color={pending ? colors.warning : colors.success} />
        <Stat label={t('today.rejected')} value={rejected} color={rejected ? colors.danger : colors.textMuted} />
      </Row>

      <Text style={s.muted}>
        {t('today.lastSync')}: {last ? new Date(last).toLocaleString('en-IN') : t('today.never')}
      </Text>

      <Button title={t('today.newOrder')} onPress={() => router.push('/customers')} />
    </ScrollView>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <Card style={{ flex: 1 }}>
      <Text style={{ fontSize: font.xxl, fontWeight: '800', color }}>{value}</Text>
      <View style={{ height: spacing.xs }} />
      <Text style={s.muted}>{label}</Text>
    </Card>
  );
}
