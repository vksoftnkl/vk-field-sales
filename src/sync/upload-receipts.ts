// Pure TypeScript (no React Native imports) so `npm test` can run it in Node.
import type { receiptAllocations, receipts, receiptTenders } from '@/db/schema';

import { TENDER_TYPE } from '../features/receipts/receipt-math.ts';

import type { SendResult } from './upload-orders';
import type { ApiError, CreatedReceipt } from './vk-nex-api';

// As in upload-orders.ts (kept here: these modules import each other's types only, so npm test
// can run them in Node without a bundler).
const isApi = (e: unknown): e is ApiError => (e as { kind?: unknown } | null)?.kind === 'api';
const isRecordRefusal = (e: unknown): e is ApiError => isApi(e) && [400, 404, 409, 422].includes(e.status);
const isDeviceRefusal = (e: unknown): e is ApiError => isApi(e) && e.status === 403;
const reasonText = (e: ApiError) => (e.code ? `${e.code}: ${e.message}` : e.message);
/** As isRouteMissing in vk-nex-api.ts: VK Nex is older than the phone and has no receipts route. */
const isRouteMissing = (e: unknown): e is ApiError =>
  isApi(e) && e.status === 404 && (e.code === 'HTTP_404' || /^Cannot (GET|POST|PUT|DELETE) /.test(e.message));

export type ReceiptHeader = typeof receipts.$inferSelect;
export type ReceiptTenderLine = typeof receiptTenders.$inferSelect;
export type ReceiptAllocationRow = typeof receiptAllocations.$inferSelect;

/** A receipt taken on the phone and not yet on VK Nex, with what the upload needs about its customer. */
export interface PendingReceipt {
  header: ReceiptHeader;
  lines: ReceiptTenderLine[];
  /** How the salesman settled the bills and credits ('PLANNED' rows); none on older receipts. */
  allocations?: ReceiptAllocationRow[];
  /** The customer is still waiting to reach VK Nex (or was refused): the receipt waits for it. */
  customerPending: boolean;
  /**
   * VK Nex's options listed transferTypes at the last Sync, so its create takes tdTransferType.
   * Not yet: the key stays out (VK Nex refuses keys it doesn't know) and the type stays on the phone.
   */
  takesTransferType?: boolean;
}

export const RECEIPT_CUSTOMER_NOT_SENT = 'CUSTOMER_NOT_SENT: The customer is not on VK Nex yet; the receipt goes after it.';
/**
 * Kept on a receipt while it is being sent (receipt-status.ts reads the prefix). VK Nex's answer
 * replaces it; if the answer is lost it stays, because VK Nex may have posted the receipt: then
 * the phone won't let it be edited or deleted until a Sync settles it (the resend is a duplicate).
 */
export const RECEIPT_SEND_TRIED = 'SEND_TRIED: Sent without an answer; VK Nex may already have it.';

/** Keys with no value are left out: VK Nex refuses unknown keys and null on most fields. */
function compact(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== null && v !== undefined && v !== '') out[k] = v;
  return out;
}

const n = (v: string | null | undefined): number => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};
/** Rupees text → whole paise, so sums never come out as 8449.999…. */
const paise = (v: string | null | undefined): number => Math.round(n(v) * 100);

/**
 * Body for POST /mobile/receipts/create, VK Nex's desktop receipt keys. The phone's id goes as
 * avhClientUuid, its own number as avhUsrRefno. Since the desktop-rule receipt (canvas 5b) the
 * phone also sends how it settled the shop's items: allocations[] (cash, discount and round-off
 * per bill), creditsApplied[] and onAccount; VK Nex re-runs its engine, so these are the plan.
 * A receipt saved before that has none, and VK Nex fills the oldest bills itself, as before.
 * Year, user, collector and row numbers are VK Nex's to fill. deviceUid is added by the client.
 * Amounts go as numbers; a tender's surcharge is inside its tdAmount. A bank transfer's type
 * (NEFT, IMPS, RTGS) goes as tdTransferType only once VK Nex says it takes it.
 */
export function toReceiptPayload(r: PendingReceipt): Record<string, unknown> {
  const h = r.header;
  const planned = (r.allocations ?? []).filter((a) => a.ralSource === 'PLANNED');
  // A bill counts when anything settles it, credits alone included.
  const bills = planned.filter((a) => a.ralKind === 'BILL' && paise(a.ralAmount) + paise(a.ralCredit) + paise(a.ralDiscount) + paise(a.ralRoundoff) > 0);
  const credits = planned.filter((a) => a.ralKind === 'CREDIT' && paise(a.ralAmount) > 0);
  // Saved by the desktop-rule receipt with the shop's open items on the phone: VK Nex follows the
  // plan, and an empty plan means everything on account. Otherwise (older receipts, or no open
  // items on the phone) the keys stay out and VK Nex fills the oldest bills itself.
  const settled = h.appOnAccount !== null && h.appOnAccount !== undefined;
  return compact({
    avhClientUuid: h.avhClientUuid,
    avhCompanyId: h.avhCompanyId,
    avhBranchId: h.avhBranchId,
    avhPartyId: h.avhPartyId,
    avhVoucherDate: h.avhVoucherDate,
    avhUsrRefno: h.avhUsrRefno,
    avhDocRefno: h.avhDocRefno,
    avhDocDate: h.avhDocRefno ? h.avhDocDate : null,
    avhRemarks: h.avhRemarks,
    allocations: settled
      ? bills.map((a) =>
          compact({
            billId: a.ralBillId,
            billAccYear: a.ralBillAccYear,
            // VK Nex's amount is the money and the credits on the bill together (discount and
            // round-off apart); the credits themselves go again in creditsApplied.
            amount: (paise(a.ralAmount) + paise(a.ralCredit)) / 100,
            discount: n(a.ralDiscount) || null,
            roundoff: n(a.ralRoundoff) || null,
          }),
        )
      : null,
    creditsApplied: settled && credits.length ? credits.map((a) => ({ billId: a.ralBillId, billAccYear: a.ralBillAccYear, amount: n(a.ralAmount) })) : null,
    onAccount: settled ? n(h.appOnAccount) : null,
    tenders: [...r.lines]
      .sort((a, b) => a.tdRowNo - b.tdRowNo)
      // VK Nex numbers the rows itself, in this order (tdRowNo is refused).
      .map((l) =>
        compact({
          tdTenderId: l.tdTenderId,
          tdTenderTypeId: l.tdTenderTypeId,
          tdAmount: Number(l.tdAmount),
          tdRefNo: l.tdRefNo,
          tdBankName: l.tdBankName,
          tdInstrumentDate: l.tdInstrumentDate,
          tdTransferType: r.takesTransferType && l.tdTenderTypeId === TENDER_TYPE.BANK ? l.tdTransferType : null,
          cheque: l.appChequeBranch || l.appChequeIfsc || l.appChequeDrawer ? compact({ bankBranch: l.appChequeBranch, ifsc: l.appChequeIfsc, drawerName: l.appChequeDrawer }) : null,
        }),
      ),
  });
}

export type ReceiptUploadStatus = 'uploaded' | 'alreadySaved' | 'refused' | 'waiting';

export interface ReceiptOutcome {
  /** The phone's avh_client_uuid. */
  localId: string;
  customerName: string;
  /** The phone's own receipt number. */
  phoneRefno: string;
  status: ReceiptUploadStatus;
  /** VK Nex's number and status once it has the receipt. */
  voucherRefno?: string | null;
  voucherStatus?: string;
  /** What VK Nex kept on account after filling the oldest bills (rupees, text). */
  onAccount?: string | null;
  error?: string;
}

export interface ReceiptSendResult extends SendResult<ReceiptOutcome> {
  /** VK Nex has no /mobile/receipts/create yet: every receipt waits, none is marked refused. */
  routeMissing?: ApiError;
}

export interface ReceiptUploadDeps {
  create(payload: Record<string, unknown>): Promise<CreatedReceipt>;
  markSynced(localId: string, created: CreatedReceipt): void;
  markRefused(localId: string, error: string): void;
  /** Sets (or puts back) the receipt's sync note: RECEIPT_SEND_TRIED just before sending. */
  markTried?(localId: string, error: string | null): void;
  onProgress?(done: number, total: number): void;
}

/**
 * Sends every waiting receipt, oldest first, as orders are sent. A resend after a lost answer is
 * safe: VK Nex answers the receipt it saved before (duplicate), marked synced the same way.
 */
export async function uploadReceipts(pending: readonly PendingReceipt[], deps: ReceiptUploadDeps): Promise<ReceiptSendResult> {
  const outcomes: ReceiptOutcome[] = [];
  for (const [i, r] of pending.entries()) {
    deps.onProgress?.(i, pending.length);
    const localId = r.header.avhClientUuid;
    const base = { localId, customerName: r.header.appPartyName, phoneRefno: r.header.avhUsrRefno };
    if (r.customerPending) {
      deps.markRefused(localId, RECEIPT_CUSTOMER_NOT_SENT);
      outcomes.push({ ...base, status: 'waiting', error: RECEIPT_CUSTOMER_NOT_SENT });
      continue;
    }
    deps.markTried?.(localId, RECEIPT_SEND_TRIED);
    try {
      const created = await deps.create(toReceiptPayload(r));
      deps.markSynced(localId, created);
      outcomes.push({
        ...base,
        status: created.duplicate ? 'alreadySaved' : 'uploaded',
        voucherRefno: created.avhVoucherRefno,
        voucherStatus: created.avhVoucherStatus,
        onAccount: created.onAccount ?? null,
      });
    } catch (e) {
      // Not taken for sure (no route, or the phone refused): its note goes back as it was.
      if (isRouteMissing(e)) {
        deps.markTried?.(localId, r.header.appSyncError);
        return { outcomes, routeMissing: e };
      }
      if (isDeviceRefusal(e)) {
        deps.markTried?.(localId, r.header.appSyncError);
        return { outcomes, refusedBy: e };
      }
      if (!isRecordRefusal(e)) return { outcomes, stoppedBy: e };
      deps.markRefused(localId, reasonText(e));
      outcomes.push({ ...base, status: 'refused', error: reasonText(e) });
    }
  }
  deps.onProgress?.(pending.length, pending.length);
  return { outcomes };
}
