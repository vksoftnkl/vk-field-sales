import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useStopText } from '@/features/orders/use-send-now';
import { runSync } from '@/sync/run-sync';

/**
 * Send now / Send again (My receipts, Receipt detail): runs Sync's sending steps only — new
 * customers, edits, orders, check-ins, receipts — and says in one line how the receipts went.
 */
export function useSendReceipts() {
  const { t } = useTranslation();
  const stopText = useStopText();
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const send = useCallback(async () => {
    setSending(true);
    setResult(null);
    try {
      const r = await runSync(() => {}, { sendOnly: true });
      const rcts = r.receipts ?? [];
      const sent = rcts.filter((o) => o.status === 'uploaded' || o.status === 'alreadySaved').length;
      const back = rcts.filter((o) => o.status === 'refused').length;
      if (r.stoppedBy) setResult({ ok: false, text: stopText(r.stoppedBy) });
      else if (r.sendRefusedBy) setResult({ ok: false, text: t('sync.deviceRefused', { message: r.sendRefusedBy.message }) });
      else if (r.receiptsRefusedBy) setResult({ ok: false, text: t('sync.receiptsRefused', { message: r.receiptsRefusedBy.message }) });
      else if (r.receiptsRouteMissing) setResult({ ok: false, text: t('sync.receiptsNotOnServer') });
      else if (back > 0) setResult({ ok: false, text: t('receipt.sendBack', { sent, back }) });
      else setResult({ ok: true, text: sent > 0 ? t('receipt.sendDone', { count: sent }) : t('receipt.sendNothing') });
    } catch (e) {
      setResult({ ok: false, text: stopText(e) });
    } finally {
      setSending(false);
    }
  }, [stopText, t]);

  return { sending, result, send };
}
