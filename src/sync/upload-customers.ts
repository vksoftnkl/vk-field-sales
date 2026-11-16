// Pure TypeScript (no React Native imports) so `npm test` can run it in Node.
import type { ApiError, CustomerSearchRow, SavedCustomer } from './vk-nex-api';

/** A shop added on the phone and not yet on VK Nex (the columns the upload needs). */
export interface PendingCustomer {
  cusId: string;
  cusName: string | null;
  cusGroupId: string;
  cusAreaId: string;
  cusContactPerson: string | null;
  cusAddr1: string | null;
  cusAddr2: string | null;
  cusAddr3: string | null;
  cusLandmark: string | null;
  cusCity: string | null;
  cusDistrict: string | null;
  cusStateName: string;
  cusStateCode: string;
  cusPin: string | null;
  cusPhone1: string | null;
  cusPhone2: string | null;
  cusWhatsappNo: string | null;
  cusEmail: string | null;
  cusGstType: string | null;
  cusGstNo: string | null;
  cusPanNo: string | null;
  cusAadharNo: string | null;
  cusPriceLevelId: number | null;
}

/**
 * Body for POST /mobile/customers/create (VK Nex's SaveCustomerDto without cusId). Only fields
 * with a value are sent: VK Nex refuses keys it does not know, and blanks mean nothing anyway.
 */
export function toCreatePayload(c: PendingCustomer, priceLevelId: number): Record<string, unknown> {
  const { cusId: _localId, cusPriceLevelId: _own, ...fields } = c;
  const payload: Record<string, unknown> = { cusPriceLevelId: priceLevelId };
  for (const [k, v] of Object.entries(fields)) if (v !== null && v !== '') payload[k] = v;
  return payload;
}

export type UploadStatus = 'uploaded' | 'linked' | 'refused';

export interface UploadOutcome {
  /** The phone's id before the upload. */
  localId: string;
  name: string;
  status: UploadStatus;
  /** VK Nex's id and code once uploaded or linked. */
  serverId?: string;
  serverCode?: string | null;
  /** Why it was refused ("CUSTOMER_UNKNOWN_GROUP: …"). */
  error?: string;
}

export interface UploadDeps {
  create(payload: Record<string, unknown>): Promise<SavedCustomer>;
  search(name: string): Promise<CustomerSearchRow[]>;
  /** Swap the phone's id for VK Nex's and clear the upload flag (one transaction). */
  markSynced(localId: string, saved: { cusId: string; cusCode: string | null }, priceLevelId: number): void;
  /** Keep it waiting, with the reason to show. */
  markRefused(localId: string, error: string): void;
  onProgress?(done: number, total: number): void;
}

export interface UploadResult {
  outcomes: UploadOutcome[];
  /** Set when the run stopped early (server gone, sign-in lost …); the rest stay waiting. */
  stoppedBy?: unknown;
}

const isApi = (e: unknown): e is ApiError => (e as { kind?: unknown } | null)?.kind === 'api';

/**
 * Refusals about this one customer (bad group, duplicate name …): note it and go on with the
 * next. Anything else (no network, 5xx, sign-in, rights, app too old) stops the whole run.
 */
const isRecordRefusal = (e: unknown): e is ApiError => isApi(e) && [400, 404, 409, 422].includes(e.status);

/** VK Nex refuses a second customer with a name it already has. */
const DUPLICATE_CODES = ['CUSTOMER_NAME_EXISTS', 'CUSTOMER_DUPLICATE'];

const sameText = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();
const digits = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '').slice(-10);

/**
 * Is this VK Nex customer the shop we tried to upload? Same name, plus the same mobile or
 * GSTIN. Happens when an earlier upload got through but its answer was lost (timeout).
 */
export function isSameShop(c: PendingCustomer, s: CustomerSearchRow): boolean {
  if (!sameText(c.cusName, s.cusName)) return false;
  return (!!c.cusPhone1 && digits(c.cusPhone1) === digits(s.cusPhone1)) || (!!c.cusGstNo && sameText(c.cusGstNo, s.cusGstNo));
}

const reason = (e: ApiError) => (e.code ? `${e.code}: ${e.message}` : e.message);

/**
 * Sends every waiting customer, one request each, in the order they were added. Each one is
 * marked synced as soon as VK Nex has it, so a run that stops halfway loses nothing.
 */
export async function uploadCustomers(
  pending: readonly PendingCustomer[],
  defaultPriceLevelId: number | null,
  deps: UploadDeps,
): Promise<UploadResult> {
  const outcomes: UploadOutcome[] = [];
  for (const [i, c] of pending.entries()) {
    deps.onProgress?.(i, pending.length);
    const name = c.cusName ?? '';
    const priceLevelId = c.cusPriceLevelId ?? defaultPriceLevelId;
    if (priceLevelId === null) {
      const error = 'NO_PRICE_LEVEL: VK Nex has no price level to give this customer.';
      deps.markRefused(c.cusId, error);
      outcomes.push({ localId: c.cusId, name, status: 'refused', error });
      continue;
    }
    try {
      const saved = await deps.create(toCreatePayload(c, priceLevelId));
      deps.markSynced(c.cusId, saved, priceLevelId);
      outcomes.push({ localId: c.cusId, name, status: 'uploaded', serverId: saved.cusId, serverCode: saved.cusCode });
    } catch (e) {
      if (!isRecordRefusal(e)) return { outcomes, stoppedBy: e };
      if (e.code && DUPLICATE_CODES.includes(e.code)) {
        let match: CustomerSearchRow | undefined;
        try {
          match = (await deps.search(name)).find((s) => isSameShop(c, s));
        } catch (lookupError) {
          return { outcomes, stoppedBy: lookupError };
        }
        if (match) {
          deps.markSynced(c.cusId, match, priceLevelId);
          outcomes.push({ localId: c.cusId, name, status: 'linked', serverId: match.cusId, serverCode: match.cusCode });
          continue;
        }
      }
      deps.markRefused(c.cusId, reason(e));
      outcomes.push({ localId: c.cusId, name, status: 'refused', error: reason(e) });
    }
  }
  deps.onProgress?.(pending.length, pending.length);
  return { outcomes };
}
