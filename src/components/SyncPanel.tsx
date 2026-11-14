import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text } from 'react-native';

import { getOrCreateDeviceId, shortDeviceId } from '@/auth/device';
import { useAppSelector } from '@/store';
import { runSync, type SyncReason, type SyncReport } from '@/sync/engine';
import { colors } from '@/theme';

import { Button, Card, s } from './ui';

/**
 * "Sync now" button plus what happened last time, in words the salesman can act on.
 * Used on the login screen (first sync of a new phone) and on the Sync tab.
 */
export function SyncPanel({ reason }: { reason: SyncReason }) {
  const { t } = useTranslation();
  const { running, lastReport } = useAppSelector((st) => st.sync);
  const deviceStatus = useAppSelector((st) => st.session.deviceStatus);
  const [deviceId, setDeviceId] = useState('');

  useEffect(() => {
    void getOrCreateDeviceId().then((id) => setDeviceId(shortDeviceId(id)));
  }, []);

  const message = lastReport
    ? describe(lastReport, deviceId, t)
    : deviceStatus === 'PENDING'
      ? { text: t('sync.notApproved', { id: deviceId }), tone: colors.warning }
      : deviceStatus === 'BLOCKED' || deviceStatus === 'WIPE'
        ? { text: t('sync.blocked'), tone: colors.danger }
        : null;

  return (
    <>
      <Button title={running ? t('sync.running') : t('sync.now')} loading={running} onPress={() => void runSync(reason)} />
      {message ? (
        <Card style={{ borderColor: message.tone }}>
          <Text style={[s.body, { color: message.tone }]}>{message.text}</Text>
          {lastReport ? <Text style={[s.muted, { marginTop: 4 }]}>{new Date(lastReport.finishedAt).toLocaleString('en-IN')}</Text> : null}
        </Card>
      ) : null}
    </>
  );
}

type T = ReturnType<typeof useTranslation>['t'];

function describe(r: SyncReport, deviceId: string, t: T): { text: string; tone: string } {
  switch (r.failure) {
    case null:
      return {
        text: `${t('sync.done')} · ↑${r.pushed}${r.rejected ? ` ✕${r.rejected}` : ''} ↓${r.pulled}`,
        tone: r.rejected ? colors.warning : colors.success,
      };
    case 'server-not-set':
      return { text: t('sync.notSet'), tone: colors.warning };
    case 'unreachable':
      return { text: t('sync.unreachable'), tone: colors.danger };
    case 'not-approved':
      return { text: t('sync.notApproved', { id: deviceId }), tone: colors.warning };
    case 'blocked':
      return { text: t('sync.blocked'), tone: colors.danger };
    case 'rejected':
      return { text: t('sync.rejected', { message: r.error ?? '' }), tone: colors.danger };
    case 'error':
      return { text: r.error ?? t('common.error'), tone: colors.danger };
  }
}
