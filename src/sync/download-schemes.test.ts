// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { downloadSchemes, toLocalSchemes } from './download-schemes.ts';
import type { ActiveSchemes, MobileScheme } from './vk-nex-api.ts';

const scheme = (id: string, over: Partial<MobileScheme> = {}): MobileScheme => ({
  prm_id: id,
  prm_comp_id: 'co-1',
  prm_branch_id: null,
  prm_code: 'FRRE',
  prm_name: 'Buy 5 get 1',
  prm_status: 'APPROVED',
  prm_apply_on: 'ITEM_QTY',
  prm_benefit: 'FREE_ITEM',
  prm_priority: 2,
  prm_stack_mode: 'EXCLUSIVE',
  prm_auto_apply: true,
  prm_allow_with_manual_disc: false,
  prm_calc_on_amount_type: 'NET_AMOUNT',
  prm_include_tax: false,
  prm_bill_type: 'ALL',
  prm_min_bill_amount: '0.00',
  prm_min_qty: '0.000',
  prm_branch_scope: 'LIST',
  prm_cust_scope: 'LIST',
  prm_item_scope: 'LIST',
  prm_price_level_id: null,
  prm_max_benefit_per_bill: '0.00',
  prm_coupon_batch_id: null,
  prm_start_date: '2026-08-24',
  prm_end_date: '2027-08-24',
  prm_valid_from_time: null,
  prm_valid_to_time: null,
  prm_valid_weekdays: 'MON,TUE',
  prm_remarks: null,
  prm_modified_on: '2026-08-24T10:00:00+05:30',
  branches: [{ prb_id: 'b1', prb_branch_id: 'br-1', prb_branch_name: 'Head Office', prb_is_exclude: false }],
  parties: [{ prp_id: 'p1', prp_kind: 'CUSTOMER_GROUP', prp_scope_id: 'grp-1', prp_scope_name: 'Retail', prp_is_exclude: false, prp_match_priority: 1 }],
  items: [
    {
      pri_id: 'i1',
      pri_kind: 'ITEM',
      pri_scope_id: 'item-1',
      pri_scope_name: 'Glucose Biscuit',
      pri_unit_id: 'unit-pcs',
      pri_unit_name: 'PCS',
      pri_is_exclude: false,
      pri_disc_perc: '0.0000',
      pri_disc_qty: '0.0000',
      pri_disc_amt: '0.00',
      pri_min_qty: '0.000',
      pri_factor: '1.0000',
      pri_max_benefit: '0.00',
      pri_match_priority: 4,
    },
  ],
  slabs: [
    {
      prs_id: 's1',
      prs_slno: 1,
      prs_benefit: 'FREE_ITEM',
      prs_exceeds: '5.000',
      prs_upto: '10.000',
      prs_each: '1.000',
      prs_is_repeat: false,
      prs_max_repeats: 0,
      prs_free_item_id: 'item-1',
      prs_free_item_name: 'Glucose Biscuit',
      prs_free_unit_id: 'unit-pcs',
      prs_free_unit_name: 'PCS',
      prs_free_unit_factor: '1.000000',
      prs_free_qty: '1.000',
      prs_free_stock_check: true,
      prs_disc_perc: '0.0000',
      prs_disc_qty: '0.0000',
      prs_disc_amt: '0.00',
      prs_fixed_price: null,
      prs_max_benefit_amt: '0.00',
    },
  ],
  ...over,
});

const answer = (schemes: MobileScheme[]): ActiveSchemes => ({ companyId: 'co-1', asOf: '2026-11-19', schemes });

test('a scheme and its rows keep VK Nex keys, exact text and their scheme id', () => {
  const got = toLocalSchemes(answer([scheme('prm-1')]), 'co-1', '2026-11-19T05:00:00.000Z');
  assert.equal(got.schemes.length, 1);
  const s = got.schemes[0]!;
  assert.equal(s.prmCode, 'FRRE');
  assert.equal(s.prmPriority, 2);
  assert.equal(s.prmMinQty, '0.000');
  assert.equal(s.prmValidWeekdays, 'MON,TUE');
  assert.equal(s.appSyncedOn, '2026-11-19T05:00:00.000Z');
  assert.deepEqual(got.branches, [{ prbId: 'b1', prbPrmId: 'prm-1', prbBranchId: 'br-1', prbBranchName: 'Head Office', prbIsExclude: false }]);
  assert.equal(got.parties[0]!.prpKind, 'CUSTOMER_GROUP');
  assert.equal(got.parties[0]!.prpPrmId, 'prm-1');
  assert.equal(got.items[0]!.priUnitId, 'unit-pcs');
  assert.equal(got.items[0]!.priMatchPriority, 4);
  const b = got.slabs[0]!;
  assert.deepEqual([b.prsExceeds, b.prsUpto, b.prsFreeQty, b.prsFreeItemId, b.prsIsRepeat], ['5.000', '10.000', '1.000', 'item-1', false]);
});

test("another company's scheme in the answer is left out", () => {
  const got = toLocalSchemes(answer([scheme('prm-1'), scheme('prm-x', { prm_comp_id: 'co-2' })]), 'co-1', 'now');
  assert.deepEqual(
    got.schemes.map((s) => s.prmId),
    ['prm-1'],
  );
});

test('every company is read before anything is saved; a failure stops the run', async () => {
  const asked: string[] = [];
  const all = await downloadSchemes(['co-1', 'co-2'], async (c) => {
    asked.push(c);
    return c === 'co-1' ? answer([scheme('prm-1')]) : { companyId: 'co-2', asOf: '2026-11-19', schemes: [] };
  }, 'now');
  assert.deepEqual(asked, ['co-1', 'co-2']);
  assert.deepEqual(
    all.map((c) => [c.companyId, c.schemes.length]),
    [
      ['co-1', 1],
      ['co-2', 0],
    ],
  );
  await assert.rejects(
    downloadSchemes(['co-1'], async () => {
      throw new Error('offline');
    }, 'now'),
    /offline/,
  );
});
