// Pure TypeScript (no React Native imports) so `npm test` can run it in Node.
import type { customers } from '@/db/schema';

import type { ApiError } from './vk-nex-api';

/** A VK Nex customer as the phone stores it: every synced column, none of the app_* ones. */
export type DownloadedCustomer = Omit<typeof customers.$inferInsert, `app${string}`>;

/** One row of GET /mobile/customers/list (only the id is needed here). */
export interface CustomerListRow {
  cusId: string;
}

export interface DownloadDeps {
  /** GET /mobile/customers/list?page=…: all VK Nex customers that aren't deleted, by name. */
  listPage(page: number): Promise<{ items: CustomerListRow[]; hasMore: boolean }>;
  /** GET /mobile/customers/get?cusId=…: the whole customer, in VK Nex's field names. */
  get(cusId: string): Promise<Record<string, unknown>>;
  onProgress?(done: number, total: number): void;
}

export interface DownloadResult {
  /** The customers read in full, ready to save. */
  rows: DownloadedCustomer[];
  /** Every id VK Nex listed. A synced phone customer missing from it was deleted on VK Nex. */
  listedIds: string[];
  /** Listed, but `get` refused it (gone in between, or an id VK Nex can't read). */
  skipped: number;
}

const isApi = (e: unknown): e is ApiError => (e as { kind?: unknown } | null)?.kind === 'api';

/** Safety stop for the paging loop (200 a page × 500 = 100 000 customers). */
const MAX_PAGES = 500;

const str = (v: unknown): string | null => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null);
const int = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.trunc(n) : null;
};
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
/** Decimal → exact text, as the phone keeps money ('232', '12.5000'). */
const dec = (v: unknown): string => str(v) ?? '0';
/** @db.Date arrives as '2026-11-03T00:00:00.000Z'; the phone keeps 'YYYY-MM-DD'. */
const day = (v: unknown): string | null => {
  const s = str(v);
  return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};

/**
 * VK Nex's customer (GET /mobile/customers/get, the desktop payload) → the phone's row. Same field
 * names on both sides; only the types are turned into SQLite's. Extra fields VK Nex sends
 * (cusAreaName, balance …) are left out.
 */
export function toLocalCustomer(c: Record<string, unknown>, now: string): DownloadedCustomer {
  return {
    cusId: String(c.cusId),
    cusTitle: str(c.cusTitle),
    cusShort: str(c.cusShort),
    cusCode: str(c.cusCode),
    cusName: str(c.cusName),
    cusAddr1: str(c.cusAddr1),
    cusAddr2: str(c.cusAddr2),
    cusAddr3: str(c.cusAddr3),
    cusCity: str(c.cusCity),
    cusDistrict: str(c.cusDistrict),
    cusStateName: str(c.cusStateName) ?? '',
    cusCountry: str(c.cusCountry),
    cusStateCode: str(c.cusStateCode) ?? '',
    cusLandmark: str(c.cusLandmark),
    cusPin: str(c.cusPin),
    cusTel: str(c.cusTel),
    cusPhone1: str(c.cusPhone1),
    cusPhone2: str(c.cusPhone2),
    cusWhatsappNo: str(c.cusWhatsappNo),
    cusEmail: str(c.cusEmail),
    cusAadharNo: str(c.cusAadharNo),
    cusContactPerson: str(c.cusContactPerson),
    cusDistanceKm: int(c.cusDistanceKm),
    cusCreditAllowed: bool(c.cusCreditAllowed, false),
    cusCreditBillLimit: int(c.cusCreditBillLimit) ?? 0,
    cusCreditAmtLimit: dec(c.cusCreditAmtLimit),
    cusCreditDays: int(c.cusCreditDays) ?? 0,
    cusDebitBalance: dec(c.cusDebitBalance),
    cusDiscPerc: dec(c.cusDiscPerc),
    cusDebitGraceDays: int(c.cusDebitGraceDays) ?? 0,
    cusEnableSms: bool(c.cusEnableSms, false),
    cusOverdueSms: bool(c.cusOverdueSms, false),
    cusOverdueBilling: bool(c.cusOverdueBilling, false),
    cusAllowPromotion: bool(c.cusAllowPromotion, false),
    cusAllowLoyalty: bool(c.cusAllowLoyalty, false),
    cusAllowDiscount: bool(c.cusAllowDiscount, true),
    cusSortOrder: int(c.cusSortOrder) ?? 0,
    cusRegionName: str(c.cusRegionName),
    cusRegionAddr1: str(c.cusRegionAddr1),
    cusRegionAddr2: str(c.cusRegionAddr2),
    cusRegionAddr3: str(c.cusRegionAddr3),
    cusRegionCity: str(c.cusRegionCity),
    cusRegionDistrict: str(c.cusRegionDistrict),
    cusRegionStateName: str(c.cusRegionStateName),
    cusRegionCountry: str(c.cusRegionCountry),
    cusBirthDate: day(c.cusBirthDate),
    cusMarriageDate: day(c.cusMarriageDate),
    cusTransportName: str(c.cusTransportName),
    cusFreightCharge: bool(c.cusFreightCharge, false),
    cusLoadingCharge: bool(c.cusLoadingCharge, false),
    cusUnloadingCharge: bool(c.cusUnloadingCharge, false),
    cusGstNo: str(c.cusGstNo),
    cusPanNo: str(c.cusPanNo),
    cusForm60On: day(c.cusForm60On),
    cusPanVerifiedOn: day(c.cusPanVerifiedOn),
    cusGstType: str(c.cusGstType),
    cusEcommerceGstin: str(c.cusEcommerceGstin),
    cusTcsApplicable: bool(c.cusTcsApplicable, false),
    cusItcollExempted: bool(c.cusItcollExempted, false),
    cusItcollType: str(c.cusItcollType),
    cusGeoLocation: str(c.cusGeoLocation),
    cusCollectionDays: Array.isArray(c.cusCollectionDays) ? c.cusCollectionDays.filter((d): d is number => typeof d === 'number') : [],
    cusDefaultSalesman: str(c.cusDefaultSalesman),
    cusPriceLevelId: int(c.cusPriceLevelId),
    cusBilledDate: day(c.cusBilledDate),
    cusBilledCount: int(c.cusBilledCount) ?? 0,
    cusNotes: str(c.cusNotes),
    cusCompanyId: str(c.cusCompanyId),
    cusBranchId: str(c.cusBranchId),
    cusAreaId: String(c.cusAreaId),
    cusGroupId: String(c.cusGroupId),
    cusIsActive: bool(c.cusIsActive, true),
    cusIsDeleted: bool(c.cusIsDeleted, false),
    // When this phone last had it from VK Nex (as for an uploaded customer), not VK Nex's own value.
    cusSyncDate: now,
    cusCreatedOn: str(c.cusCreatedOn) ?? now,
    cusCreatedBy: str(c.cusCreatedBy),
    cusModifiedOn: str(c.cusModifiedOn) ?? now,
    cusModifiedBy: str(c.cusModifiedBy),
  };
}

/**
 * Reads every VK Nex customer: the list page by page for the ids, then each one in full (the list
 * has no area, type or address). Nothing is saved here; the caller saves it all in one go, so the
 * phone never shows half a download. Any failure other than one unreadable customer throws.
 */
export async function downloadCustomers(deps: DownloadDeps, now: string, concurrency = 4): Promise<DownloadResult> {
  deps.onProgress?.(0, 0);
  const ids: string[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const r = await deps.listPage(page);
    for (const it of r.items) {
      // A customer added on VK Nex while paging can push a row onto the next page twice.
      if (!seen.has(it.cusId)) {
        seen.add(it.cusId);
        ids.push(it.cusId);
      }
    }
    if (!r.hasMore || r.items.length === 0) break;
  }

  const rows: (DownloadedCustomer | null)[] = new Array(ids.length).fill(null);
  let next = 0;
  let done = 0;
  let skipped = 0;
  let failure: { error: unknown } | null = null;
  deps.onProgress?.(0, ids.length);
  const worker = async () => {
    while (!failure && next < ids.length) {
      const i = next++;
      try {
        rows[i] = toLocalCustomer(await deps.get(ids[i]!), now);
      } catch (e) {
        if (!isApi(e) || (e.status !== 400 && e.status !== 404)) {
          // The other workers stop at their next customer.
          failure ??= { error: e };
          return;
        }
        skipped++;
      }
      deps.onProgress?.(++done, ids.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker));
  if (failure) throw (failure as { error: unknown }).error;

  return { rows: rows.filter((r): r is DownloadedCustomer => r !== null), listedIds: ids, skipped };
}
