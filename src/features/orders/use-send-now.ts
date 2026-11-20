import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getServerCredentials } from '@/sync/credentials';
import { refreshBranches, refreshItems, runSync } from '@/sync/run-sync';
import { formatServerAddress } from '@/sync/server-address';
import { getServerAddress } from '@/sync/sync-store';
import { isApiError, isNetworkError } from '@/sync/vk-nex-api';

/** Why a send or a refresh did not happen, in the Sync page's words. */
export function useStopText() {
  const { t } = useTranslation();
  return useCallback(
    (e: unknown): string => {
      if (e instanceof Error && e.message === 'NO_SERVER_ADDRESS') return t('so.noAddress');
      if (e instanceof Error && e.message === 'NO_SIGN_IN') return t('sync.signInMissing');
      const saved = getServerAddress();
      const shown = saved ? formatServerAddress(saved) : '';
      if (isNetworkError(e)) return t(/^https:\/\//i.test(shown) ? 'sync.noAnswerHttps' : 'sync.noAnswer', { address: shown });
      if (isApiError(e)) {
        if (e.status === 401) return t('sync.signInRefused', { name: getServerCredentials()?.loginName ?? '', message: e.message });
        if (e.status === 426) return t('sync.updateNeeded', { message: e.message });
        if (e.status === 403) return t('sync.noRight', { message: e.message });
        return t('sync.server', { message: e.code ? `${e.code}: ${e.message}` : e.message });
      }
      return t('common.error');
    },
    [t],
  );
}

/**
 * Send now (My orders, a saved or sent-back order): runs Sync's sending steps only — new
 * customers, edits, orders, check-ins, receipts — and says what happened in one line.
 */
export function useSendNow() {
  const { t } = useTranslation();
  const stopText = useStopText();
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const send = useCallback(async () => {
    setSending(true);
    setResult(null);
    try {
      const r = await runSync(() => {}, { sendOnly: true });
      const orders = r.orders ?? [];
      const sent = orders.filter((o) => o.status === 'uploaded' || o.status === 'alreadySaved').length;
      const back = orders.filter((o) => o.status === 'refused').length;
      if (r.stoppedBy) setResult({ ok: false, text: stopText(r.stoppedBy) });
      else if (r.sendRefusedBy) setResult({ ok: false, text: t('sync.deviceRefused', { message: r.sendRefusedBy.message }) });
      else if (back > 0) setResult({ ok: false, text: t('so.sendBack', { sent, back }) });
      else setResult({ ok: true, text: sent > 0 ? t('so.sendDone', { count: sent }) : t('so.sendNothing') });
    } catch (e) {
      setResult({ ok: false, text: stopText(e) });
    } finally {
      setSending(false);
    }
  }, [stopText, t]);

  return { sending, result, send };
}

/** Refresh stock and prices (Add items): brings the items again, nothing else. */
export function useRefreshItems() {
  const { t } = useTranslation();
  const stopText = useStopText();
  const [refreshing, setRefreshing] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setResult(null);
    try {
      const got = await refreshItems();
      const brought = t('so.refreshed', { count: got.items });
      // The prices came but the offers did not: say so (the phone keeps the offers it had).
      if (got.schemesStoppedBy) setResult({ ok: false, text: `${brought} ${t('offers.notRefreshed')}` });
      else setResult({ ok: true, text: brought });
    } catch (e) {
      setResult({ ok: false, text: stopText(e) });
    } finally {
      setRefreshing(false);
    }
  }, [stopText, t]);

  return { refreshing, result, refresh, clear: () => setResult(null) };
}

/**
 * Switch company, a company with no branches on the phone: pull them from VK Nex. `pull` resolves
 * to true when VK Nex answered (even with no branch), false with `error` saying why not.
 */
export function useRefreshBranches() {
  const stopText = useStopText();
  const [pulling, setPulling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pull = useCallback(async (): Promise<boolean> => {
    setPulling(true);
    setError(null);
    try {
      await refreshBranches();
      return true;
    } catch (e) {
      setError(stopText(e));
      return false;
    } finally {
      setPulling(false);
    }
  }, [stopText]);

  return { pulling, error, pull, clear: () => setError(null) };
}
