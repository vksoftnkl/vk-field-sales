// Pure TypeScript (no React Native imports) so `npm test` can run it in Node.
import { daysBetween, todayISO } from '../../lib/money.ts';
import { addDays, formatDay, type DateNames } from '../../lib/date-range.ts';
import { seriesCode } from '../sales/bill-number.ts';

/**
 * Where a phone order stands (canvas page 3b, "Status"):
 *  - on the phone: Waiting to send, or Sent back (VK Nex refused it, with its words);
 *  - on VK Nex, as its so_status reads: DRAFT = With office, CONFIRMED, PARTIAL = Part delivered,
 *    COMPLETED = Delivered, CANCELLED, CLOSED, EXPIRED.
 * VK Nex's answer to the upload is the last status the phone has: there is no status read route
 * yet, so a sent order keeps "With office" until one exists.
 */
export type SoState = 'waiting' | 'sentBack' | 'office' | 'confirmed' | 'part' | 'delivered' | 'cancelled' | 'closed' | 'expired';

/** The upload is waiting for the customer to reach VK Nex first: not a refusal of the order. */
export const CUSTOMER_FIRST = 'CUSTOMER_NOT_SENT';

const SERVER: Record<string, SoState> = {
  DRAFT: 'office',
  CONFIRMED: 'confirmed',
  PARTIAL: 'part',
  COMPLETED: 'delivered',
  CANCELLED: 'cancelled',
  CLOSED: 'closed',
  EXPIRED: 'expired',
};

export function soState(o: { appPendingUpload: boolean; appSyncError: string | null; soStatus: string | null }): SoState {
  if (o.appPendingUpload) return o.appSyncError && !o.appSyncError.startsWith(CUSTOMER_FIRST) ? 'sentBack' : 'waiting';
  return SERVER[(o.soStatus ?? '').toUpperCase()] ?? 'office';
}

/** Chip colours per state (background / text), 4.5:1 or better. */
export const SO_TONES: Record<SoState, { bg: string; fg: string }> = {
  waiting: { bg: '#FEF3C7', fg: '#92400E' },
  sentBack: { bg: '#FEE2E2', fg: '#B91C1C' },
  office: { bg: '#E7E5E4', fg: '#44403C' },
  confirmed: { bg: '#DBEAFE', fg: '#1E40AF' },
  part: { bg: '#E0E7FF', fg: '#3730A3' },
  delivered: { bg: '#DCFCE7', fg: '#166534' },
  cancelled: { bg: '#F5F5F4', fg: '#57534E' },
  closed: { bg: '#F5F5F4', fg: '#57534E' },
  expired: { bg: '#F5F5F4', fg: '#57534E' },
};

/** Still on the phone: it may be edited or deleted there. */
export const isOnPhone = (s: SoState): boolean => s === 'waiting' || s === 'sentBack';
/** Not finished: delivery may still come. */
export const isOpen = (s: SoState): boolean => s === 'waiting' || s === 'sentBack' || s === 'office' || s === 'confirmed' || s === 'part';

export type SoFilter = 'all' | 'attention' | 'waiting' | 'open';
export const SO_FILTERS: readonly SoFilter[] = ['all', 'attention', 'waiting', 'open'];

/** My orders' chips: Needs attention = sent back; Waiting = not sent; Open = on VK Nex, not finished. */
export function inFilter(s: SoState, f: SoFilter): boolean {
  if (f === 'attention') return s === 'sentBack';
  if (f === 'waiting') return s === 'waiting';
  if (f === 'open') return s === 'office' || s === 'confirmed' || s === 'part';
  return true;
}

/** VK Nex keeps an unclaimed order 30 days ("Valid until"). */
export const VALID_DAYS = 30;
export const validUntil = (orderDate: string): string => addDays(orderDate, VALID_DAYS);

/**
 * Orders that count as the shop's open orders on Visit and on the item rows: open, for that
 * company, and not older than the 30 days an order stays valid.
 */
export function isRecentOpen(o: { state: SoState; soOrderDate: string }, today: string): boolean {
  return isOpen(o.state) && daysBetween(o.soOrderDate, today) <= VALID_DAYS && o.soOrderDate <= today;
}

/**
 * The phone's own order reference, before VK Nex numbers it: device series, day (ddmmyy) and the
 * day's count on this phone, e.g. '3F9A-181126-03'. Sent as soUsrRefno, so the office can match the
 * shop's copy to its sor… number.
 */
export function phoneRef(deviceUid: string, dateISO: string, seq: number): string {
  const [y, m, d] = dateISO.split('-');
  return `${seriesCode(deviceUid)}-${d}${m}${(y ?? '').slice(2)}-${String(seq).padStart(2, '0')}`;
}

/** The next number of the day after the refs already used ('…-03' → 4). */
export function nextRefSeq(usedRefs: readonly (string | null)[]): number {
  let max = 0;
  for (const r of usedRefs) {
    const n = Number(r?.split('-').pop());
    if (Number.isInteger(n) && n > max) max = n;
  }
  return max + 1;
}

/** An ISO time as the phone's local "10:42". */
export function hhmm(iso: string): string {
  const at = new Date(iso);
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
}

/** "10:30 today" or "17 Nov 2026, 10:30": when the phone last heard from VK Nex. */
export function asOfText(iso: string, names: DateNames, todayWord: string, now: Date = new Date()): string {
  const day = todayISO(new Date(iso));
  return day === todayISO(now) ? `${hhmm(iso)} ${todayWord}` : `${formatDay(day, names)}, ${hhmm(iso)}`;
}
