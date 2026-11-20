// Pure TypeScript (no React Native imports) so `npm test` can run it in Node.
import type { visits } from '@/db/schema';

import type { SendResult } from './upload-orders';
import type { ApiError, CreatedVisit } from './vk-nex-api';

// As in upload-orders.ts (kept here: these modules import each other's types only, so npm test
// can run them in Node without a bundler).
const isApi = (e: unknown): e is ApiError => (e as { kind?: unknown } | null)?.kind === 'api';
const isRecordRefusal = (e: unknown): e is ApiError => isApi(e) && [400, 404, 409, 422].includes(e.status);
const isDeviceRefusal = (e: unknown): e is ApiError => isApi(e) && e.status === 403;
const reasonText = (e: ApiError) => (e.code ? `${e.code}: ${e.message}` : e.message);

export type Visit = typeof visits.$inferSelect;

/** A check-in not yet on VK Nex, with what the upload needs about its customer. */
export interface PendingVisit {
  visit: Visit;
  customerName: string;
  /** The customer is still waiting to reach VK Nex: the visit waits for it. */
  customerPending: boolean;
}

/** The reasons VK Nex takes (ck_cv_reason_code), in the phone's own words. */
export const VISIT_REASONS = ['shopClosed', 'noOrder', 'shopBusy', 'ownerAway', 'paymentPending', 'nextVisit'] as const;

export const VISIT_CUSTOMER_NOT_SENT = 'CUSTOMER_NOT_SENT: The customer is not on VK Nex yet; the visit goes after it.';
export const VISIT_NO_COMPANY = 'NO_COMPANY: No company was chosen for this visit.';
export const VISIT_NO_SALESMAN =
  'NO_SALESMAN: Your VK Nex login is not linked to an employee, and VK Nex needs the salesman on every visit. Ask the office to link the login to its employee on the User screen, then Sync again.';

/**
 * The salesman of a check-in (cvSalesmanId): the employee VK Nex links to the login that saved it
 * (user_master.usr_employee_id), from GET /mobile/me as the phone keeps it. Sync reads /mobile/me
 * right after signing in, before the uploads, so a link made in the office is used at once. null
 * when the phone has no /mobile/me for that login, or VK Nex links it to no employee.
 */
export function salesmanFromMe(meJson: string | null | undefined, userId: string): string | null {
  try {
    const me = JSON.parse(meJson ?? 'null') as { userId?: unknown; employeeId?: unknown } | null;
    if (!me || me.userId !== userId) return null;
    return typeof me.employeeId === 'string' && me.employeeId ? me.employeeId : null;
  } catch {
    return null;
  }
}

/**
 * Body for POST /mobile/visits/create (VK Nex's sales.customer_visit). The phone's id goes as
 * cvClientUuid. Latitude and longitude go together or not at all. deviceUid is added by the client.
 */
export function toVisitPayload(v: Visit, companyId: string, salesmanId: string): Record<string, unknown> {
  const hasFix = v.latitude !== null && v.longitude !== null;
  const payload: Record<string, unknown> = {
    cvClientUuid: v.id,
    cvCompanyId: companyId,
    cvCustId: v.customerId,
    cvSalesmanId: salesmanId,
    cvVisitAt: v.visitedAt,
  };
  if (v.reason) payload.cvReasonCode = v.reason;
  if (v.remarks?.trim()) payload.cvRemarks = v.remarks.trim().slice(0, 500);
  if (hasFix) {
    payload.cvLatitude = v.latitude;
    payload.cvLongitude = v.longitude;
    if (v.accuracyM !== null && v.accuracyM >= 0) payload.cvGpsAccuracy = v.accuracyM;
  }
  return payload;
}

export type VisitUploadStatus = 'uploaded' | 'alreadySaved' | 'refused' | 'waiting';

export interface VisitOutcome {
  localId: string;
  customerName: string;
  status: VisitUploadStatus;
  error?: string;
}

export interface VisitUploadDeps {
  create(payload: Record<string, unknown>): Promise<CreatedVisit>;
  /** The company of a visit saved without one (Choose company now). */
  currentCompanyId: string | null;
  /** VK Nex's employee_master id of the phone's salesman (visits.user_id); null = not known. */
  salesmanOf(userId: string): string | null;
  markSynced(localId: string, created: CreatedVisit): void;
  markRefused(localId: string, error: string): void;
  onProgress?(done: number, total: number): void;
}

/** Sends every waiting check-in, oldest first, as orders are sent. */
export async function uploadVisits(pending: readonly PendingVisit[], deps: VisitUploadDeps): Promise<SendResult<VisitOutcome>> {
  const outcomes: VisitOutcome[] = [];
  const hold = (p: PendingVisit, error: string) => {
    deps.markRefused(p.visit.id, error);
    outcomes.push({ localId: p.visit.id, customerName: p.customerName, status: 'waiting', error });
  };
  for (const [i, p] of pending.entries()) {
    deps.onProgress?.(i, pending.length);
    const v = p.visit;
    const companyId = v.companyId ?? deps.currentCompanyId;
    const salesmanId = deps.salesmanOf(v.userId);
    if (p.customerPending) {
      hold(p, VISIT_CUSTOMER_NOT_SENT);
      continue;
    }
    if (!companyId) {
      hold(p, VISIT_NO_COMPANY);
      continue;
    }
    if (!salesmanId) {
      hold(p, VISIT_NO_SALESMAN);
      continue;
    }
    try {
      const created = await deps.create(toVisitPayload(v, companyId, salesmanId));
      deps.markSynced(v.id, created);
      outcomes.push({ localId: v.id, customerName: p.customerName, status: created.duplicate ? 'alreadySaved' : 'uploaded' });
    } catch (e) {
      if (isDeviceRefusal(e)) return { outcomes, refusedBy: e };
      if (!isRecordRefusal(e)) return { outcomes, stoppedBy: e };
      deps.markRefused(v.id, reasonText(e));
      outcomes.push({ localId: v.id, customerName: p.customerName, status: 'refused', error: reasonText(e) });
    }
  }
  deps.onProgress?.(pending.length, pending.length);
  return { outcomes };
}
