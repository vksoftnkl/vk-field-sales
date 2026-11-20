// Pure TypeScript (no React Native imports) so `npm test` can run it in Node.
import type { saleReturn, saleReturnItem } from '@/db/schema';

import type { SendResult } from './upload-orders';
import type { ApiError, CreatedReturn } from './vk-nex-api';

// As in upload-receipts.ts (kept here so npm test runs these modules in Node without a bundler).
const isApi = (e: unknown): e is ApiError => (e as { kind?: unknown } | null)?.kind === 'api';
const isRecordRefusal = (e: unknown): e is ApiError => isApi(e) && [400, 404, 409, 422].includes(e.status);
const isDeviceRefusal = (e: unknown): e is ApiError => isApi(e) && e.status === 403;
const reasonText = (e: ApiError) => (e.code ? `${e.code}: ${e.message}` : e.message);
const isRouteMissing = (e: unknown): e is ApiError =>
  isApi(e) && e.status === 404 && (e.code === 'HTTP_404' || /^Cannot (GET|POST|PUT|DELETE) /.test(e.message));

export type ReturnHeader = typeof saleReturn.$inferSelect;
export type ReturnItemRow = typeof saleReturnItem.$inferSelect;

/** A return waiting to go to VK Nex, with what the upload needs about its customer. */
export interface PendingReturn {
  header: ReturnHeader;
  lines: ReturnItemRow[];
  /** The customer is still waiting to reach VK Nex (or was refused): the return waits for it. */
  customerPending: boolean;
}

export const RETURN_CUSTOMER_NOT_SENT = 'CUSTOMER_NOT_SENT: The customer is not on VK Nex yet; the return goes after it.';
/** Kept while it is being sent; VK Nex's answer replaces it (a lost answer is resent safely). */
export const RETURN_SEND_TRIED = 'SEND_TRIED: Sent without an answer; VK Nex may already have it.';

function compact(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== null && v !== undefined && v !== '') out[k] = v;
  return out;
}

const n = (v: string | null | undefined): number => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};

/**
 * Body for POST /mobile/returns/create (plan-mobile-sales-return-2026-11-20.md): the desktop's
 * sale-return keys without money (VK Nex works every line out from its bill line). sr_id goes as
 * srClientUuid, the phone's R number as srMobileRefno. Lines keep the phone's order; a split is a
 * line with the same bill line and a higher sriSplitNo. The salesman's Adjust split goes only when
 * he changed it (else VK Nex plans it: this bill first, then the oldest). deviceUid is added by the client.
 */
export function toReturnPayload(r: PendingReturn): Record<string, unknown> {
  const h = r.header;
  const adjust = h.srSettleMode === 'ADJUST' && h.appAdjust ? (JSON.parse(h.appAdjust) as { billId: string; billAccYear: string; amount: string }[]) : null;
  return compact({
    srClientUuid: h.srId,
    srCompanyId: h.srCompanyId,
    srBranchId: h.srBranchId,
    srCustId: h.srCustId,
    srIsAgainstBill: !!h.srBillId,
    srBillId: h.srBillId,
    srBillAccYear: h.srBillAccYear,
    srReasonId: h.srReasonId,
    srSettleMode: h.srSettleMode,
    srReturnDate: h.srReturnDate,
    srMobileRefno: h.srReturnRefno,
    srUsrRefno: h.srUsrRefno,
    srUsrRefdate: h.srUsrRefno ? h.srUsrRefdate : null,
    srRemarks: h.srRemarks,
    godownId: h.srGodownId,
    adjustments: adjust ? adjust.filter((a) => n(a.amount) > 0).map((a) => ({ billId: a.billId, billAccYear: a.billAccYear, amount: n(a.amount) })) : null,
    phoneEstimate: n(h.srReturnAmt),
    lines: [...r.lines]
      .sort((a, b) => a.sriLineNo - b.sriLineNo)
      .map((l) =>
        compact({
          // Every part has its own line number (VK Nex refuses a line number twice); VK Nex counts
          // splits from 1 (the phone from 0).
          sriLineNo: l.sriLineNo,
          sriSplitNo: l.sriSplitNo + 1,
          sriBillItemId: l.sriBillItemId,
          sriBillAccYear: l.sriBillItemId ? l.sriBillAccYear : null,
          sriItemId: l.sriItemId,
          sriItemUnitId: l.sriItemUnitId,
          sriReturnQty: n(l.sriReturnQty),
          sriCondition: l.sriCondition,
          sriRemarks: l.sriRemarks,
          sriBatchNo: l.sriBillItemId ? null : l.sriBatchNo,
          sriExpiryDate: l.sriBillItemId ? null : l.sriExpiryDate,
        }),
      ),
  });
}

/** Where VK Nex left a return: its status word, normalised (an unknown word counts as held). */
export function answerStatus(created: Pick<CreatedReturn, 'status' | 'srStatus'>): 'POSTED' | 'HELD' | 'SENT_BACK' | 'CANCELLED' {
  // A resend of a return cancelled in the office answers status POSTED with srStatus CANCELLED.
  if ((created.srStatus ?? '').toUpperCase() === 'CANCELLED') return 'CANCELLED';
  const s = (created.status ?? '').toUpperCase();
  if (s === 'POSTED' || s === 'SENT_BACK' || s === 'CANCELLED') return s;
  return 'HELD';
}

export type ReturnUploadStatus = 'posted' | 'held' | 'sentBack' | 'refused' | 'waiting';

export interface ReturnOutcome {
  localId: string;
  customerName: string;
  phoneRefno: string;
  status: ReturnUploadStatus;
  /** VK Nex's number (SRT/…) once it has the return. */
  returnRefno?: string | null;
  duplicate?: boolean;
  error?: string;
}

export interface ReturnSendResult extends SendResult<ReturnOutcome> {
  /** VK Nex has no /mobile/returns/create yet: every return waits, none is marked refused. */
  routeMissing?: ApiError;
}

export interface ReturnUploadDeps {
  create(payload: Record<string, unknown>): Promise<CreatedReturn>;
  /** VK Nex answered (posted, held or sent back). */
  markAnswered(localId: string, created: CreatedReturn): void;
  /** VK Nex refused to save it at all: kept on the phone as sent back with its words. */
  markRefused(localId: string, error: string): void;
  /** Sets (or puts back) the return's sync note: RETURN_SEND_TRIED just before sending. */
  markTried(localId: string, error: string | null): void;
  onProgress?(done: number, total: number): void;
}

/** Sends every waiting return, oldest first, as receipts are sent. */
export async function uploadReturns(pending: readonly PendingReturn[], deps: ReturnUploadDeps): Promise<ReturnSendResult> {
  const outcomes: ReturnOutcome[] = [];
  for (const [i, r] of pending.entries()) {
    deps.onProgress?.(i, pending.length);
    const localId = r.header.srId;
    const base = { localId, customerName: r.header.srCustName, phoneRefno: r.header.srReturnRefno };
    if (r.customerPending) {
      deps.markTried(localId, RETURN_CUSTOMER_NOT_SENT);
      outcomes.push({ ...base, status: 'waiting', error: RETURN_CUSTOMER_NOT_SENT });
      continue;
    }
    deps.markTried(localId, RETURN_SEND_TRIED);
    try {
      const created = await deps.create(toReturnPayload(r));
      deps.markAnswered(localId, created);
      const s = answerStatus(created);
      const note = created.refusal ?? created.held;
      outcomes.push({
        ...base,
        status: s === 'POSTED' || s === 'CANCELLED' ? 'posted' : s === 'SENT_BACK' ? 'sentBack' : 'held',
        returnRefno: created.srReturnRefno ?? null,
        duplicate: !!created.duplicate,
        error: note ? [note.code, note.message].filter(Boolean).join(': ') : undefined,
      });
    } catch (e) {
      if (isRouteMissing(e)) {
        deps.markTried(localId, r.header.appSyncError);
        return { outcomes, routeMissing: e };
      }
      if (isDeviceRefusal(e)) {
        deps.markTried(localId, r.header.appSyncError);
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
