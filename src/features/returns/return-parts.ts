import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { num, priceForLevel } from '@/features/orders/order-math';
import type { SoUnitRow } from '@/features/orders/queries';
import { useStopText } from '@/features/orders/use-send-now';
import { addDays } from '@/lib/date-range';
import { todayISO } from '@/lib/money';
import { uuidv7 } from '@/lib/uuid';
import { runSync } from '@/sync/run-sync';

import { returnGodownsQuery, returnReasonsQuery, returnSettingsQuery, type BillLineRow } from './queries';
import { isCondition, todayRateBase, type Condition, type RateSource, type ReturnPart } from './return-math';

/**
 * IGST (an inter-state bill line) rather than CGST + SGST. VK Nex keeps the IGST rate on every
 * line, so a line is IGST only when it has no CGST.
 */
const isIgst = (l: { cgstPerc: string; igstPerc: string }): boolean => num(l.igstPerc) > 0 && num(l.cgstPerc) === 0;

/** The line of a synced bill as a return part (qty blank unless given). */
export function partFromBillLine(r: BillLineRow, condition: Condition, o: { qty?: string; splitNo?: number; notes?: string } = {}): ReturnPart {
  const l = r.line;
  return {
    key: uuidv7(),
    billItemId: l.billItemId,
    billAccYear: l.accYear,
    splitNo: o.splitNo ?? 0,
    itemId: l.itemId,
    iucId: l.itemUnitId,
    unitName: l.unitName ?? '',
    factor: l.toBaseFactor,
    name: r.nameEn ?? l.itemName ?? '',
    nameTa: r.nameTa,
    qty: o.qty ?? '',
    condition,
    notes: o.notes ?? '',
    batchNo: '',
    expiryDate: '',
    ratePreTaxBase: l.ratePreTaxBase,
    taxPerc: l.taxPerc,
    igst: isIgst(l),
    rateSource: 'BILL',
    rateFrom: null,
  };
}

/** Where a no-bill line's rate comes from, as VK Nex prices it (LAST_SALE, else TODAY_PRICE). */
export interface NoBillRate {
  source: RateSource;
  ratePreTaxBase: string;
  taxPerc: string;
  igst: boolean;
  /** The bill of the last sale, for the chip. */
  from: { refno: string; date: string } | null;
}

/** The shop's last sale of the item inside the window (0 = any date), else today's price at its level. */
export function noBillRate(
  u: Pick<SoUnitRow, 'factor' | 'taxPerc' | 'inclTax' | 'ipmSalesPriceA' | 'ipmSalesPriceB' | 'ipmSalesPriceC' | 'ipmSalesPriceD' | 'ipmMaxPrice' | 'ipmMinPrice'>,
  sales: readonly { line: { ratePreTaxBase: string; taxPerc: string; cgstPerc: string; igstPerc: string }; refno: string; billDate: string }[],
  o: { level: number | null; windowDays: number; today?: string },
): NoBillRate | null {
  const today = o.today ?? todayISO();
  const from = o.windowDays > 0 ? addDays(today, -o.windowDays) : '';
  const last = sales.find((s) => s.billDate >= from);
  if (last) return { source: 'LAST_SALE', ratePreTaxBase: last.line.ratePreTaxBase, taxPerc: last.line.taxPerc, igst: isIgst(last.line), from: { refno: last.refno, date: last.billDate } };
  const price = priceForLevel(u, o.level ?? 1) ?? priceForLevel(u, 1);
  if (!price) return null;
  const taxPerc = u.taxPerc ?? '0';
  return { source: 'TODAY_PRICE', ratePreTaxBase: todayRateBase(price, String(u.factor), taxPerc, !!u.inclTax), taxPerc, igst: false, from: null };
}

/** A no-bill item as a return part. */
export function partFromUnit(u: Pick<SoUnitRow, 'iucId' | 'itemId' | 'unitName' | 'factor' | 'itemNameEn' | 'itemNameTa'>, rate: NoBillRate, condition: Condition, qty = ''): ReturnPart {
  return {
    key: uuidv7(),
    billItemId: null,
    billAccYear: null,
    splitNo: 0,
    itemId: u.itemId,
    iucId: u.iucId,
    unitName: u.unitName,
    factor: String(u.factor),
    name: u.itemNameEn,
    nameTa: u.itemNameTa,
    qty,
    condition,
    notes: '',
    batchNo: '',
    expiryDate: '',
    ratePreTaxBase: rate.ratePreTaxBase,
    taxPerc: rate.taxPerc,
    igst: rate.igst,
    rateSource: rate.source,
    rateFrom: rate.from ? rate.from.refno : null,
  };
}

/** A company's return reasons, godowns and rules (from Sync). `ready` = Sync has brought them. */
export function useReturnSetup(companyId: string) {
  const { data: settingsRows } = useLiveQuery(returnSettingsQuery(companyId), [companyId]);
  const { data: reasons } = useLiveQuery(returnReasonsQuery(companyId), [companyId]);
  const { data: godowns } = useLiveQuery(returnGodownsQuery(companyId), [companyId]);
  const settings = settingsRows[0] ?? null;
  return { settings, reasons, godowns, ready: !!settings };
}

/** A reason's default condition, or Damaged when it names none. */
export const reasonCondition = (r: { defaultCondition: string | null } | undefined): Condition => (r && isCondition(r.defaultCondition) ? r.defaultCondition : 'DAMAGED');

/**
 * Send now / Send again (Return list, Return detail): Sync's sending steps only, and one line on
 * how the returns went.
 */
export function useSendReturns() {
  const { t } = useTranslation();
  const stopText = useStopText();
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const send = useCallback(async () => {
    setSending(true);
    setResult(null);
    try {
      const r = await runSync(() => {}, { sendOnly: true });
      const rets = r.returns ?? [];
      const posted = rets.filter((o) => o.status === 'posted').length;
      const held = rets.filter((o) => o.status === 'held').length;
      const back = rets.filter((o) => o.status === 'sentBack' || o.status === 'refused').length;
      if (r.stoppedBy) setResult({ ok: false, text: stopText(r.stoppedBy) });
      else if (r.sendRefusedBy) setResult({ ok: false, text: t('sync.deviceRefused', { message: r.sendRefusedBy.message }) });
      else if (r.returnsRouteMissing) setResult({ ok: false, text: t('sr.sync.notOnServer') });
      else if (rets.length === 0) setResult({ ok: true, text: t('sr.list.sendNothing') });
      else setResult({ ok: back === 0, text: t('sr.sync.summary', { posted, held, back }) });
    } catch (e) {
      setResult({ ok: false, text: stopText(e) });
    } finally {
      setSending(false);
    }
  }, [stopText, t]);

  return { sending, result, send };
}
