// Pure TypeScript (no React Native imports) so `npm test` can run it in Node.
import type { receipts, receiptTenders } from '@/db/schema';

import type { SendResult } from './upload-orders';
import type { ApiError, CreatedReceipt } from './vk-nex-api';

// As in upload-orders.ts (kept here: these modules import each other's types only, so npm test
// can run them in Node without a bundler).
const isApi = (e: unknown): e is ApiError => (e as { kind?: unknown } | null)?.kind === 'api';
const isRecordRefusal = (e: unknown): e is ApiError => isApi(e) && [400, 404, 409, 422].includes(e.status);
const isDeviceRefusal = (e: unknown): e is ApiError => isApi(e) && e.status === 403;
const reasonText = (e: ApiError) => (e.code ? `${e.code}: ${e.message}` : e.message);

export type ReceiptHeader = typeof receipts.$inferSelect;
export type ReceiptTenderLine = typeof receiptTenders.$inferSelect;

/** A receipt taken on the phone and not yet on VK Nex, with what the upload needs about its customer. */
export interface PendingReceipt {
  header: ReceiptHeader;
  lines: ReceiptTenderLine[];
  /** The customer is still waiting to reach VK Nex (or was refused): the receipt waits for it. */
  customerPending: boolean;
}

export const RECEIPT_CUSTOMER_NOT_SENT = 'CUSTOMER_NOT_SENT: The customer is not on VK Nex yet; the receipt goes after it.';

/** Keys with no value are left out: VK Nex refuses unknown keys and null on most fields. */
function compact(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== null && v !== undefined && v !== '') out[k] = v;
  return out;
}

/**
 * Body for POST /mobile/receipts/create: only the money (VK Nex fills the customer's oldest bills
 * itself and posts the receipt). The phone's id goes as avhClientUuid, its own number as
 * avhUsrRefno. Branch, year, user, row numbers, allocations and on-account are VK Nex's to fill,
 * and sending them is refused. deviceUid is added by the client. Amounts go as numbers; a tender's
 * surcharge is inside its tdAmount.
 */
export function toReceiptPayload(r: PendingReceipt): Record<string, unknown> {
  const h = r.header;
  return compact({
    avhClientUuid: h.avhClientUuid,
    avhCompanyId: h.avhCompanyId,
    avhPartyId: h.avhPartyId,
    avhVoucherDate: h.avhVoucherDate,
    avhUsrRefno: h.avhUsrRefno,
    avhRemarks: h.avhRemarks,
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
  error?: string;
}

export interface ReceiptUploadDeps {
  create(payload: Record<string, unknown>): Promise<CreatedReceipt>;
  markSynced(localId: string, created: CreatedReceipt): void;
  markRefused(localId: string, error: string): void;
  onProgress?(done: number, total: number): void;
}

/**
 * Sends every waiting receipt, oldest first, as orders are sent. A resend after a lost answer is
 * safe: VK Nex answers the receipt it saved before (duplicate), marked synced the same way.
 */
export async function uploadReceipts(pending: readonly PendingReceipt[], deps: ReceiptUploadDeps): Promise<SendResult<ReceiptOutcome>> {
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
    try {
      const created = await deps.create(toReceiptPayload(r));
      deps.markSynced(localId, created);
      outcomes.push({
        ...base,
        status: created.duplicate ? 'alreadySaved' : 'uploaded',
        voucherRefno: created.avhVoucherRefno,
        voucherStatus: created.avhVoucherStatus,
      });
    } catch (e) {
      if (isDeviceRefusal(e)) return { outcomes, refusedBy: e };
      if (!isRecordRefusal(e)) return { outcomes, stoppedBy: e };
      deps.markRefused(localId, reasonText(e));
      outcomes.push({ ...base, status: 'refused', error: reasonText(e) });
    }
  }
  deps.onProgress?.(pending.length, pending.length);
  return { outcomes };
}
