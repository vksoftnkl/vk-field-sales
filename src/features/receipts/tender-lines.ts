// Pure TypeScript (no React Native imports) so `npm test` can run it in Node.

import type { TenderLine } from './receipt-draft';
import { TENDER_TYPE } from './receipt-math.ts';

/** A tender as the phone keeps it (tenders table), for a new payment line. */
export interface TenderLike {
  tndId: string;
  tndTypeId: number;
  tndName: string;
  appNeedsRef: boolean;
  appRefLabel: string | null;
  tndSurchargePerc: string;
  tndSurchargeAmount: string;
}

/**
 * A new payment line. A bank transfer's date starts as today (the receipt date, `today`), and the
 * salesman can change it (user, 2026-11-20); a cheque's date is still picked, as it may be post-dated.
 */
export const lineOf = (tnd: TenderLike, amount: string, today?: string): TenderLine => ({
  tndId: tnd.tndId,
  typeId: tnd.tndTypeId,
  name: tnd.tndName,
  needsRef: tnd.appNeedsRef,
  refLabel: tnd.appRefLabel,
  amount,
  refNo: '',
  bankName: '',
  instrumentDate: tnd.tndTypeId === TENDER_TYPE.BANK && today ? today : null,
  surchargePerc: tnd.tndSurchargePerc,
  surchargeFlat: tnd.tndSurchargeAmount,
  chequeBranch: '',
  chequeIfsc: '',
  chequeDrawer: '',
  transferType: '',
});

/** Phones take cash, cheques, UPI, wallets and transfers; cards are not offered (canvas 5b, Add payment mode). */
export const offeredOnPhone = (t: { tndTypeId: number }): boolean => t.tndTypeId !== TENDER_TYPE.CARD;

/** A cheque dated after the receipt is a post-dated cheque (VK Nex keeps it as a PDC). */
export const isPostDated = (l: { typeId: number; instrumentDate: string | null }, receiptDate: string): boolean =>
  l.typeId === TENDER_TYPE.CHEQUE && !!l.instrumentDate && l.instrumentDate > receiptDate;

/**
 * "004512 · Indian Bank, Tirunelveli Jn" (cheque) or "NEFT · UTR…" (transfer) style details of a
 * line, without its date (the screen formats that).
 */
export function lineDetails(l: Pick<TenderLine, 'refNo' | 'bankName' | 'chequeBranch' | 'transferType'>): string[] {
  const bank = [l.bankName.trim(), l.chequeBranch?.trim()].filter(Boolean).join(', ');
  return [l.transferType?.trim(), l.refNo.trim(), bank].filter((x): x is string => !!x);
}
