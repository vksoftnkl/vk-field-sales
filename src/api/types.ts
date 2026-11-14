/**
 * API contract between the app and the VK Nex server PC.
 * The /mobile/* endpoints are NEW and must be added to NestJS (see docs/SYNC-API.md).
 * There is no user login on the server: the phone is trusted once the office APPROVES it,
 * and salesmen sign in on the phone against the users pulled during sync.
 */
import type { OutboxEntity } from '@/db/schema';

/* ── Device registration ── */
export type DeviceStatus = 'PENDING' | 'APPROVED' | 'BLOCKED' | 'WIPE';

export interface RegisterDeviceResponse {
  status: DeviceStatus;
  /** Seller details for GST on the phone (CGST+SGST vs IGST). Sent once APPROVED. */
  company?: {
    id: string;
    name: string;
    stateCode: string | null;
    branchId?: string | null;
  } | null;
  salesmanId?: string | null;
  invoiceSeries?: string | null;
}

/* ── Push (phone → server) ── */
export interface PushRecord {
  entity: OutboxEntity;
  clientUuid: string;
  op: 'UPSERT' | 'CANCEL';
  payload: unknown;
  createdAt: string;
}

export interface PushRequest {
  deviceId: string;
  records: PushRecord[];
}

export type PushResultStatus = 'ACKED' | 'REJECTED' | 'RETRY';

export interface PushResult {
  clientUuid: string;
  entity: OutboxEntity;
  status: PushResultStatus;
  serverId?: string | null;
  /** Server document number, e.g. 'SO1/25-26/0042'. */
  docNo?: string | null;
  error?: string | null;
}

export interface PushResponse {
  results: PushResult[];
  /** Server tells the phone to stop / wipe (lost phone). */
  deviceStatus?: DeviceStatus;
}

/* ── Pull (server → phone) ── */
/** Pulled in this order. users comes first so a brand-new phone can sign in after one sync. */
export type PullScope = 'users' | 'customers' | 'items' | 'item_prices';

export interface PullResponse<Row> {
  rows: Row[];
  /** Server ids removed or deactivated since the cursor. */
  deletedIds: string[];
  nextCursor: string | null;
  hasMore: boolean;
}

/** A salesman allowed to sign in on phones (active, not locked, mobile login on). */
export interface UserDTO {
  id: string;
  loginName: string;
  displayName?: string | null;
  /** VK Nex's own `scrypt$<salt>$<hash>` — checked on the phone, never the plain password. */
  passwordHash: string;
  isActive?: boolean;
  updatedAt?: string;
}

export interface CustomerDTO {
  id: string;
  code?: string | null;
  name: string;
  mobile?: string | null;
  gstin?: string | null;
  stateCode?: string | null;
  address?: string | null;
  beatId?: string | null;
  priceLevel?: string | null;
  creditLimitPaise?: number;
  creditBillLimit?: number;
  outstandingPaise?: number;
  isActive?: boolean;
  updatedAt?: string;
}

export interface ItemDTO {
  id: string;
  code?: string | null;
  name: string;
  barcode?: string | null;
  hsn?: string | null;
  unit?: string;
  mrpPaise?: number;
  gstRateBp: number;
  cessRateBp?: number;
  taxInclusive?: boolean;
  isActive?: boolean;
  updatedAt?: string;
}

export interface ItemPriceDTO {
  itemId: string;
  priceLevel: string;
  ratePaise: number;
}
