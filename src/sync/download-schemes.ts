// Pure TypeScript (no React Native imports) so `npm test` can run it in Node.
import type { promotionScheme, promotionSchemeBranch, promotionSchemeItem, promotionSchemeParty, promotionSchemeSlab } from '@/db/schema';

import type { ActiveSchemes } from './vk-nex-api';

export type LocalScheme = typeof promotionScheme.$inferInsert;
export type LocalSchemeBranch = typeof promotionSchemeBranch.$inferInsert;
export type LocalSchemeParty = typeof promotionSchemeParty.$inferInsert;
export type LocalSchemeItem = typeof promotionSchemeItem.$inferInsert;
export type LocalSchemeSlab = typeof promotionSchemeSlab.$inferInsert;

/** One company's offers as the phone's rows (its set is replaced as a whole). */
export interface CompanySchemes {
  companyId: string;
  schemes: LocalScheme[];
  branches: LocalSchemeBranch[];
  parties: LocalSchemeParty[];
  items: LocalSchemeItem[];
  slabs: LocalSchemeSlab[];
}

/**
 * VK Nex's answer for one company → the phone's promotion_scheme* rows, keys as VK Nex's columns.
 * A scheme of another company (never expected) is left out, so it can't replace that company's set.
 */
export function toLocalSchemes(answer: ActiveSchemes, companyId: string, syncedOn: string): CompanySchemes {
  const out: CompanySchemes = { companyId, schemes: [], branches: [], parties: [], items: [], slabs: [] };
  for (const s of answer.schemes) {
    if (s.prm_comp_id !== companyId) continue;
    out.schemes.push({
      prmId: s.prm_id,
      prmCompId: s.prm_comp_id,
      prmBranchId: s.prm_branch_id,
      prmCode: s.prm_code,
      prmName: s.prm_name,
      prmStatus: s.prm_status,
      prmApplyOn: s.prm_apply_on,
      prmBenefit: s.prm_benefit,
      prmPriority: s.prm_priority,
      prmStackMode: s.prm_stack_mode,
      prmAutoApply: s.prm_auto_apply,
      prmAllowWithManualDisc: s.prm_allow_with_manual_disc,
      prmCalcOnAmountType: s.prm_calc_on_amount_type,
      prmIncludeTax: s.prm_include_tax,
      prmBillType: s.prm_bill_type,
      prmMinBillAmount: s.prm_min_bill_amount,
      prmMinQty: s.prm_min_qty,
      prmBranchScope: s.prm_branch_scope,
      prmCustScope: s.prm_cust_scope,
      prmItemScope: s.prm_item_scope,
      prmPriceLevelId: s.prm_price_level_id,
      prmMaxBenefitPerBill: s.prm_max_benefit_per_bill,
      prmCouponBatchId: s.prm_coupon_batch_id,
      prmStartDate: s.prm_start_date,
      prmEndDate: s.prm_end_date,
      prmValidFromTime: s.prm_valid_from_time,
      prmValidToTime: s.prm_valid_to_time,
      prmValidWeekdays: s.prm_valid_weekdays,
      prmRemarks: s.prm_remarks,
      prmModifiedOn: s.prm_modified_on,
      appSyncedOn: syncedOn,
    });
    for (const b of s.branches ?? [])
      out.branches.push({ prbId: b.prb_id, prbPrmId: s.prm_id, prbBranchId: b.prb_branch_id, prbBranchName: b.prb_branch_name, prbIsExclude: b.prb_is_exclude });
    for (const p of s.parties ?? [])
      out.parties.push({
        prpId: p.prp_id,
        prpPrmId: s.prm_id,
        prpKind: p.prp_kind,
        prpScopeId: p.prp_scope_id,
        prpScopeName: p.prp_scope_name,
        prpIsExclude: p.prp_is_exclude,
        prpMatchPriority: p.prp_match_priority,
      });
    for (const i of s.items ?? [])
      out.items.push({
        priId: i.pri_id,
        priPrmId: s.prm_id,
        priKind: i.pri_kind,
        priScopeId: i.pri_scope_id,
        priScopeName: i.pri_scope_name,
        priUnitId: i.pri_unit_id,
        priUnitName: i.pri_unit_name,
        priIsExclude: i.pri_is_exclude,
        priDiscPerc: i.pri_disc_perc,
        priDiscQty: i.pri_disc_qty,
        priDiscAmt: i.pri_disc_amt,
        priMinQty: i.pri_min_qty,
        priFactor: i.pri_factor,
        priMaxBenefit: i.pri_max_benefit,
        priMatchPriority: i.pri_match_priority,
      });
    for (const b of s.slabs ?? [])
      out.slabs.push({
        prsId: b.prs_id,
        prsPrmId: s.prm_id,
        prsSlno: b.prs_slno,
        prsBenefit: b.prs_benefit,
        prsExceeds: b.prs_exceeds,
        prsUpto: b.prs_upto,
        prsEach: b.prs_each,
        prsIsRepeat: b.prs_is_repeat,
        prsMaxRepeats: b.prs_max_repeats,
        prsFreeItemId: b.prs_free_item_id,
        prsFreeItemName: b.prs_free_item_name,
        prsFreeUnitId: b.prs_free_unit_id,
        prsFreeUnitName: b.prs_free_unit_name,
        prsFreeUnitFactor: b.prs_free_unit_factor,
        prsFreeQty: b.prs_free_qty,
        prsFreeStockCheck: b.prs_free_stock_check,
        prsDiscPerc: b.prs_disc_perc,
        prsDiscQty: b.prs_disc_qty,
        prsDiscAmt: b.prs_disc_amt,
        prsFixedPrice: b.prs_fixed_price,
        prsMaxBenefitAmt: b.prs_max_benefit_amt,
      });
  }
  return out;
}

/**
 * Every company's offers, one GET each. All companies are read before anything is saved: a
 * failure stops the run and the phone keeps the offers it had.
 */
export async function downloadSchemes(
  companyIds: readonly string[],
  get: (companyId: string) => Promise<ActiveSchemes>,
  syncedOn: string,
  onProgress: (done: number, total: number) => void = () => {},
): Promise<CompanySchemes[]> {
  const out: CompanySchemes[] = [];
  for (const [i, companyId] of companyIds.entries()) {
    onProgress(i, companyIds.length);
    out.push(toLocalSchemes(await get(companyId), companyId, syncedOn));
  }
  onProgress(companyIds.length, companyIds.length);
  return out;
}
