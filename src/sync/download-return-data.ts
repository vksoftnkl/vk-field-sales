// Pure TypeScript (no React Native imports) so `npm test` can run it in Node.
import type { returnBillLines, returnBills, returnGodowns, returnReasons, returnSettings } from '@/db/schema';

import { pageHasMore, type ReturnBillsPage, type ReturnOptions } from './vk-nex-api.ts';

/**
 * What a sales return needs from VK Nex (canvas 6b), per company: the reasons, the branch's
 * godowns, the rules and rights (GET /mobile/returns/options), and the posted bills a return can
 * come back on with their lines (GET /mobile/returns/bill-lines, paged). Read in full before
 * anything is saved, so a failure keeps what the phone had.
 */
export interface ReturnData {
  companyIds: string[];
  reasons: (typeof returnReasons.$inferInsert)[];
  godowns: (typeof returnGodowns.$inferInsert)[];
  settings: (typeof returnSettings.$inferInsert)[];
  bills: (typeof returnBills.$inferInsert)[];
  lines: (typeof returnBillLines.$inferInsert)[];
}

export interface ReturnDataDeps {
  options(companyId: string, branchId: string | null): Promise<ReturnOptions>;
  billsPage(companyId: string, branchId: string | null, page: number): Promise<ReturnBillsPage>;
  onProgress?(done: number, total: number): void;
}

const text = (v: string | number | null | undefined, fallback = '0'): string => (v === null || v === undefined || v === '' ? fallback : String(v));
const CONDITIONS = ['RESTOCK', 'DAMAGED', 'EXPIRED', 'SCRAP'];
/** At most this many pages a company (200 bills each). */
const PAGE_CAP = 100;

export async function downloadReturnData(companies: readonly { companyId: string; branchId: string | null }[], deps: ReturnDataDeps, syncedOn: string): Promise<ReturnData> {
  const out: ReturnData = { companyIds: [], reasons: [], godowns: [], settings: [], bills: [], lines: [] };
  for (const [i, c] of companies.entries()) {
    deps.onProgress?.(i, companies.length);
    const o = await deps.options(c.companyId, c.branchId);
    const branchId = o.branchId ?? c.branchId;
    o.reasons.forEach((r, k) =>
      out.reasons.push({
        companyId: c.companyId,
        reasonId: r.reasonId,
        code: r.code ?? null,
        name: r.name,
        defaultCondition: r.defaultCondition && CONDITIONS.includes(r.defaultCondition) ? r.defaultCondition : null,
        refundCharges: r.refundCharges ?? null,
        isClaim: !!r.isClaim,
        sortOrder: r.sortOrder ?? k,
      }),
    );
    o.godowns.forEach((g, k) => out.godowns.push({ companyId: c.companyId, godownId: g.godownId, branchId, name: g.name, isDefault: !!g.isDefault, position: k }));

    let asOf: string | null = null;
    let billDays = o.settings?.billDays ?? null;
    for (let page = 1; page <= PAGE_CAP; page++) {
      const p = await deps.billsPage(c.companyId, branchId, page);
      const bills = p.bills ?? [];
      asOf ??= p.asOf ?? null;
      billDays ??= p.billDays ?? null;
      for (const b of bills) {
        out.bills.push({
          sbId: b.sbId,
          accYear: b.accYear,
          companyId: c.companyId,
          branchId: b.branchId ?? branchId,
          custId: b.custId,
          refno: b.refno,
          billDate: b.date.slice(0, 10),
          billAmount: text(b.billAmount),
          due: b.due === null || b.due === undefined ? null : String(b.due),
          payMode: b.payMode ?? null,
          returnedAmt: b.returnedAmt === null || b.returnedAmt === undefined ? null : String(b.returnedAmt),
          returnStatus: b.returnStatus ?? null,
          syncedOn,
        });
        for (const l of b.lines ?? []) {
          out.lines.push({
            billItemId: l.billItemId,
            accYear: l.accYear,
            sbId: b.sbId,
            sbAccYear: b.accYear,
            companyId: c.companyId,
            lineNo: l.lineNo,
            itemId: l.itemId,
            itemName: l.itemName ?? null,
            itemUnitId: l.itemUnitId,
            unitName: l.unitName ?? null,
            toBaseFactor: text(l.toBaseFactor, '1'),
            billQty: text(l.billQty),
            billQtyBase: text(l.billQtyBase),
            returnedQtyBase: text(l.returnedQtyBase),
            qtyLeftBase: text(l.qtyLeftBase),
            onOtherDraftsBase: text(l.onOtherDraftsBase),
            ratePreTaxBase: text(l.ratePreTaxBase),
            rate: l.rate === null || l.rate === undefined ? null : String(l.rate),
            taxPerc: text(l.taxPerc),
            cgstPerc: text(l.cgstPerc),
            sgstPerc: text(l.sgstPerc),
            igstPerc: text(l.igstPerc),
            lotId: l.lotId ?? null,
            batchNo: l.batchNo ?? null,
            expiryDate: l.expiryDate ? l.expiryDate.slice(0, 10) : null,
            godownId: l.godownId ?? null,
            isFree: !!l.isFree,
            allowReturn: l.allowReturn !== false,
          });
        }
      }
      if (!pageHasMore(p, bills.length)) break;
    }
    const s = o.settings ?? {};
    out.settings.push({
      companyId: c.companyId,
      branchId,
      returnWindowDays: s.returnWindowDays ?? 0,
      freeReturnAllowed: s.freeReturnAllowed !== false,
      settleDefault: s.settleDefault ?? null,
      expiredLotDays: s.expiredLotDays ?? null,
      billDays: billDays ?? 90,
      canPost: o.rights?.post ?? null,
      billsAsOf: asOf ?? syncedOn,
      syncedOn,
    });
    out.companyIds.push(c.companyId);
  }
  deps.onProgress?.(companies.length, companies.length);
  return out;
}
