// Pure TypeScript (no React Native imports) so `npm test` can run it in Node.
import type { ApiError, SavedCustomer } from './vk-nex-api';

/**
 * Edit customer, sent by Sync: of the four fields the salesman may change on a VK Nex customer
 * (mobiles, Aadhaar, PAN), the ones he did change, with PUT /mobile/customers/update. VK Nex
 * changes only the fields it is sent, but always needs state, area, group and price level: those
 * are read from VK Nex just before, so an office change made since the last Sync is not
 * overwritten with the phone's copy.
 */

export type EditedField = 'cusPhone1' | 'cusPhone2' | 'cusAadharNo' | 'cusPanNo';
const EDITABLE: readonly EditedField[] = ['cusPhone1', 'cusPhone2', 'cusAadharNo', 'cusPanNo'];

export interface PendingEdit {
  cusId: string;
  cusName: string | null;
  cusPhone1: string | null;
  cusPhone2: string | null;
  cusAadharNo: string | null;
  cusPanNo: string | null;
  /** The fields the salesman changed (app_edited_fields); only these are sent. */
  editedFields: string[];
}

export interface UpdateOutcome {
  cusId: string;
  name: string;
  status: 'updated' | 'refused';
  /** Why it was refused ("CUSTOMER_…: …"). */
  error?: string;
}

export interface UpdateDeps {
  /** GET /mobile/customers/get: the customer as VK Nex has it now. */
  get(cusId: string): Promise<Record<string, unknown>>;
  update(payload: Record<string, unknown>): Promise<SavedCustomer>;
  /** The edit is on VK Nex: clear the flag, unless the salesman changed the customer again meanwhile. */
  markUpdated(sent: PendingEdit): void;
  /** Keep it waiting, with the reason to show. */
  markRefused(cusId: string, error: string): void;
  onProgress?(done: number, total: number): void;
}

export interface UpdateResult {
  outcomes: UpdateOutcome[];
  /** Set when the run stopped early (server gone, sign-in lost …); the rest stay waiting. */
  stoppedBy?: unknown;
}

/** The fields VK Nex's update requires; taken from VK Nex itself. */
const REQUIRED_FROM_SERVER = ['cusStateName', 'cusStateCode', 'cusAreaId', 'cusGroupId', 'cusPriceLevelId'] as const;

/**
 * Body for PUT /mobile/customers/update: the required fields as VK Nex has them, and only the
 * fields the salesman changed (an office change to another one is kept). A field the salesman
 * cleared is sent as null (cleared on VK Nex too).
 */
export function toUpdatePayload(edit: PendingEdit, current: Record<string, unknown>): Record<string, unknown> {
  const payload: Record<string, unknown> = { cusId: edit.cusId };
  for (const k of REQUIRED_FROM_SERVER) payload[k] = current[k];
  for (const k of EDITABLE) if (edit.editedFields.includes(k)) payload[k] = edit[k] || null;
  return payload;
}

const isApi = (e: unknown): e is ApiError => (e as { kind?: unknown } | null)?.kind === 'api';
/** About this one customer (bad PAN, deleted on VK Nex …): note it and go on. */
const isRecordRefusal = (e: unknown): e is ApiError => isApi(e) && [400, 404, 409, 422].includes(e.status);
const reason = (e: ApiError) => (e.code ? `${e.code}: ${e.message}` : e.message);

/** Sends every waiting edit, one customer at a time; each is marked done as soon as VK Nex has it. */
export async function updateCustomers(pending: readonly PendingEdit[], deps: UpdateDeps): Promise<UpdateResult> {
  const outcomes: UpdateOutcome[] = [];
  for (const [i, edit] of pending.entries()) {
    deps.onProgress?.(i, pending.length);
    const name = edit.cusName ?? '';
    try {
      const current = await deps.get(edit.cusId);
      await deps.update(toUpdatePayload(edit, current));
      deps.markUpdated(edit);
      outcomes.push({ cusId: edit.cusId, name, status: 'updated' });
    } catch (e) {
      if (!isRecordRefusal(e)) return { outcomes, stoppedBy: e };
      deps.markRefused(edit.cusId, reason(e));
      outcomes.push({ cusId: edit.cusId, name, status: 'refused', error: reason(e) });
    }
  }
  deps.onProgress?.(pending.length, pending.length);
  return { outcomes };
}
