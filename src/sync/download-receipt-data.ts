// Pure TypeScript (no React Native imports) so `npm test` can run it in Node.
import type { openBills, receiptSettings, tenders } from '@/db/schema';

import { itemKind } from '../features/receipts/settle.ts';

import type { MobileOpenBill, MobileTender, OpenBillsPage, ReceiptOptions } from './vk-nex-api';

export type LocalTender = typeof tenders.$inferInsert;
export type LocalOpenBill = typeof openBills.$inferInsert;
export type LocalReceiptSettings = typeof receiptSettings.$inferInsert;

/** The tender types a receipt from the phone may carry: cash, card, UPI, wallet, cheque, bank. */
const PHONE_TENDER_TYPES = new Set([1, 2, 3, 4, 5, 6]);

/** '5' or 5 → 5; junk → 0. VK Nex sends tender type ids as text in some answers. */
const int = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isInteger(n) ? n : 0;
};

/** VK Nex amounts are rupees (numbers or text) → whole paise. */
export const rupeesToPaise = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

/** '1.50' or 1.5 → '1.50'-style exact text; junk → '0'. */
const decimalText = (v: unknown): string => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? String(v).trim() : '0';
};

/** A company's tenders, in the office's order, only the types the phone can send. */
export function toLocalTenders(companyId: string, opts: ReceiptOptions): LocalTender[] {
  return opts.tenders
    .filter((t: MobileTender) => typeof t.tenderId === 'string' && t.tenderId !== '' && PHONE_TENDER_TYPES.has(int(t.typeId)))
    .map((t, i) => ({
      companyId,
      tndId: t.tenderId,
      tndTypeId: int(t.typeId),
      tndTypeCode: t.typeCode ?? null,
      tndName: t.name?.trim() || t.shortName?.trim() || t.typeCode || '—',
      appNeedsRef: t.needsRef === true,
      appRefLabel: t.refLabel?.trim() || null,
      appIsDefault: t.isDefault === true,
      tndSurchargePerc: decimalText(t.surchargePerc),
      tndSurchargeAmount: decimalText(t.surchargeAmount),
      position: i,
      // Older VK Nex sends no flag: a cheque always needs its bank (VCH_CHEQUE_DETAILS).
      appRequiresBank: t.requiresBank === true || int(t.typeId) === 5,
    }));
}

/** The company's receipt rules; an older VK Nex sends none (then: due-date order, nothing mandatory, no PPD). */
export function toLocalReceiptSettings(companyId: string, opts: ReceiptOptions, syncedOn: string): LocalReceiptSettings {
  const s = opts.settings ?? {};
  return {
    companyId,
    billSort: s.receiptBillSort ?? null,
    salesmanMandatory: s.salesmanMandatory === true,
    pdcPostingMode: s.pdcPostingMode ?? null,
    ppdEnabled: s.ppdEnabled === true,
    syncedOn,
  };
}

/** VK Nex's PPD schedule → the phone's JSON [{ tillDate, perc }], or null when there is none. */
export function ppdScheduleJson(rows: MobileOpenBill['ppdSchedule']): string | null {
  const slabs = (rows ?? [])
    .map((r) => ({ tillDate: String(r?.tillDate ?? '').slice(0, 10), perc: Number(r?.perc) }))
    .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.tillDate) && Number.isFinite(r.perc) && r.perc > 0);
  return slabs.length ? JSON.stringify(slabs) : null;
}

/** One company's open bills, in VK Nex's order (seq carries it), with what is still pending. */
export function toLocalOpenBills(companyId: string, rows: readonly MobileOpenBill[], syncedOn: string, seqStart = 0): LocalOpenBill[] {
  return rows
    .filter((b) => b.billId && b.billAccYear && b.partyId && rupeesToPaise(b.pendingAmount) > 0)
    .map((b, i) => ({
      billId: b.billId,
      billAccYear: b.billAccYear,
      companyId,
      partyId: b.partyId,
      seq: seqStart + i,
      billType: b.billType ?? null,
      docRefno: b.docRefno ?? '—',
      docDate: (b.docDate ?? '').slice(0, 10),
      dueDate: b.dueDate ? b.dueDate.slice(0, 10) : null,
      billAmountPaise: rupeesToPaise(b.billAmount),
      pendingPaise: rupeesToPaise(b.pendingAmount),
      syncedOn,
      kind: itemKind(b.kind),
      paidPaise: rupeesToPaise(b.paidAmount),
      pdcHeldPaise: rupeesToPaise(b.pdcHeld),
      ppdSchedule: ppdScheduleJson(b.ppdSchedule),
    }));
}

export interface ReceiptDataDeps {
  /** GET /mobile/receipts/options?companyId=: the company's tenders. */
  options(companyId: string): Promise<ReceiptOptions>;
  /** One page of the company's open bills, all customers. */
  openBillsPage(companyId: string, page: number): Promise<OpenBillsPage>;
  onProgress?(done: number, total: number): void;
}

export interface ReceiptData {
  tenders: LocalTender[];
  bills: LocalOpenBill[];
  settings: LocalReceiptSettings[];
  /** The companies read in full: their old tenders and bills are replaced. */
  companyIds: string[];
}

/** Safety stop for the paging loop. */
const MAX_PAGES = 400;

/**
 * Reads every company's tenders and open bills. Throws on the first failure (no answer, a
 * refusal, a route VK Nex does not have yet): the caller keeps what the phone had.
 */
export async function downloadReceiptData(companyIds: readonly string[], deps: ReceiptDataDeps, syncedOn: string): Promise<ReceiptData> {
  const out: ReceiptData = { tenders: [], bills: [], settings: [], companyIds: [] };
  for (const [i, companyId] of companyIds.entries()) {
    deps.onProgress?.(i, companyIds.length);
    const opts = await deps.options(companyId);
    out.tenders.push(...toLocalTenders(companyId, opts));
    out.settings.push(toLocalReceiptSettings(companyId, opts, syncedOn));
    let seq = 0;
    for (let page = 1; page <= MAX_PAGES; page++) {
      const p = await deps.openBillsPage(companyId, page);
      const rows = toLocalOpenBills(companyId, p.items, syncedOn, seq);
      out.bills.push(...rows);
      seq += p.items.length;
      if (!p.hasMore || p.items.length === 0) break;
    }
    out.companyIds.push(companyId);
  }
  deps.onProgress?.(companyIds.length, companyIds.length);
  return out;
}
