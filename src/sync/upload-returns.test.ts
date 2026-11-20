// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { downloadReturnData } from './download-return-data.ts';
import { answerStatus, RETURN_CUSTOMER_NOT_SENT, RETURN_SEND_TRIED, toReturnPayload, uploadReturns, type PendingReturn, type ReturnHeader, type ReturnItemRow } from './upload-returns.ts';
import { ApiError, NetworkError, pageHasMore, type CreatedReturn } from './vk-nex-api.ts';

const header = (o: Partial<ReturnHeader> = {}): ReturnHeader =>
  ({
    srId: 'sr1',
    srCompanyId: 'co1',
    srAccYear: '2026-2027',
    srDeviceType: 'MOBILE',
    srDeviceId: 'VKSMAN-000000003F9A',
    srDocType: 'CREDIT_NOTE',
    srReturnSlno: 5,
    srReturnRefno: 'R3F9A/2627/00005',
    srReturnDate: '2026-11-20',
    srReturnDatetime: '2026-11-20T11:42:00.000Z',
    srIsAgainstBill: true,
    srCustId: 'cus1',
    srCustName: 'Sri Murugan Stores',
    srReturnAmt: '1732.00',
    srSettleMode: 'ADJUST',
    srBranchId: 'br1',
    srBillId: 'sb2107',
    srBillAccYear: '2026-2027',
    srReasonId: 'reason-damaged',
    srGodownId: null,
    srUsrRefno: null,
    srUsrRefdate: null,
    srRemarks: 'Oil tins leaking',
    appAdjust: null,
    appStatus: 'WAITING',
    appSyncError: null,
    ...o,
  }) as ReturnHeader;

const line = (o: Partial<ReturnItemRow>): ReturnItemRow =>
  ({
    sriId: 'l1',
    sriReturnId: 'sr1',
    sriLineNo: 1,
    sriSplitNo: 0,
    sriBillItemId: 'sbi1',
    sriBillAccYear: '2026-2027',
    sriItemId: 'oil',
    sriItemUnitId: 'pcs',
    sriReturnQty: '3',
    sriCondition: 'RESTOCK',
    sriRemarks: null,
    sriBatchNo: null,
    sriExpiryDate: null,
    ...o,
  }) as ReturnItemRow;

const pending = (o: Partial<PendingReturn> = {}): PendingReturn => ({
  header: header(),
  lines: [line({}), line({ sriId: 'l2', sriLineNo: 2, sriSplitNo: 1, sriReturnQty: '2', sriCondition: 'DAMAGED', sriRemarks: 'tins leaking' })],
  customerPending: false,
  ...o,
});

test('the upload names the bill lines, never money, and the phone ref as srMobileRefno', () => {
  const p = toReturnPayload(pending());
  assert.equal(p.srClientUuid, 'sr1');
  assert.equal(p.srMobileRefno, 'R3F9A/2627/00005');
  assert.equal(p.srIsAgainstBill, true);
  assert.equal(p.srSettleMode, 'ADJUST');
  assert.equal(p.adjustments, undefined);
  const lines = p.lines as Record<string, unknown>[];
  assert.equal(lines.length, 2);
  assert.equal(lines[0]!.sriSplitNo, 1);
  assert.deepEqual(lines[1], { sriLineNo: 2, sriSplitNo: 2, sriBillItemId: 'sbi1', sriBillAccYear: '2026-2027', sriItemId: 'oil', sriItemUnitId: 'pcs', sriReturnQty: 2, sriCondition: 'DAMAGED', sriRemarks: 'tins leaking' });
  for (const l of lines) for (const k of Object.keys(l)) assert.ok(!/Amt|Rate|Tax/.test(k), k);
});

test("the salesman's own split goes only with ADJUST, rows with nothing left out", () => {
  const adjust = JSON.stringify([
    { billId: 'abl1', billAccYear: '2026-2027', refno: 'SB/2107', amount: '1500.00' },
    { billId: 'abl2', billAccYear: '2026-2027', refno: 'SB/1842', amount: '0.00' },
  ]);
  assert.deepEqual(toReturnPayload(pending({ header: header({ appAdjust: adjust }) })).adjustments, [{ billId: 'abl1', billAccYear: '2026-2027', amount: 1500 }]);
  assert.equal(toReturnPayload(pending({ header: header({ appAdjust: adjust, srSettleMode: 'ADVANCE' }) })).adjustments, undefined);
});

test('a no-bill line sends its batch and expiry; a bill line never does', () => {
  const p = toReturnPayload(
    pending({
      header: header({ srBillId: null, srBillAccYear: null, srSettleMode: 'ADVANCE' }),
      lines: [line({ sriBillItemId: null, sriBillAccYear: null, sriBatchNo: 'SX1026', sriExpiryDate: '2027-10-31' })],
    }),
  );
  assert.equal(p.srIsAgainstBill, false);
  assert.equal(p.srBillId, undefined);
  const l = (p.lines as Record<string, unknown>[])[0]!;
  assert.equal(l.sriBatchNo, 'SX1026');
  assert.equal(l.sriExpiryDate, '2027-10-31');
  assert.equal(l.sriBillItemId, undefined);
});

test('statuses: an unknown word counts as held', () => {
  assert.equal(answerStatus({ status: 'POSTED' }), 'POSTED');
  assert.equal(answerStatus({ status: 'sent_back' }), 'SENT_BACK');
  assert.equal(answerStatus({ status: 'DRAFT' }), 'HELD');
  assert.equal(answerStatus({ status: 'POSTED', srStatus: 'CANCELLED' }), 'CANCELLED');
});

test('posted, held and sent back are each kept; a refusal to save is sent back with VK Nex words', async () => {
  const answers: CreatedReturn[] = [
    { srId: 'a', status: 'POSTED', srReturnRefno: 'SRT/2026-2027/P1/00011' },
    { srId: 'b', status: 'HELD', srReturnRefno: 'SRT/2026-2027/P1/00012', held: { code: 'SALES_RETURN_WINDOW', message: 'Past the window' } },
  ];
  const answered: string[] = [];
  const refused: string[] = [];
  const tried: (string | null)[] = [];
  const list = [pending({ header: header({ srId: 'a' }) }), pending({ header: header({ srId: 'b' }) }), pending({ header: header({ srId: 'c' }) }), pending({ header: header({ srId: 'd' }), customerPending: true })];
  const r = await uploadReturns(list, {
    create: async () => {
      const a = answers.shift();
      if (a) return a;
      throw new ApiError(422, 'Only 2 PCS can come back', [{ message: 'Only 2 PCS can come back', code: 'SALES_RETURN_OVER_QTY' }]);
    },
    markAnswered: (id) => answered.push(id),
    markRefused: (id, e) => refused.push(`${id} ${e}`),
    markTried: (_id, e) => tried.push(e),
  });
  assert.deepEqual(
    r.outcomes.map((o) => o.status),
    ['posted', 'held', 'refused', 'waiting'],
  );
  assert.equal(r.outcomes[1]!.error, 'SALES_RETURN_WINDOW: Past the window');
  assert.deepEqual(answered, ['a', 'b']);
  assert.deepEqual(refused, ['c SALES_RETURN_OVER_QTY: Only 2 PCS can come back']);
  assert.ok(tried.includes(RETURN_SEND_TRIED));
  assert.ok(tried.includes(RETURN_CUSTOMER_NOT_SENT));
});

test('no answer stops the run; an older VK Nex without the route leaves every return waiting', async () => {
  const deps = { markAnswered: () => {}, markRefused: () => assert.fail('not refused'), markTried: () => {} };
  const lost = await uploadReturns([pending()], { ...deps, create: async () => Promise.reject(new NetworkError('timeout')) });
  assert.ok(lost.stoppedBy);
  const missing = await uploadReturns([pending()], { ...deps, create: async () => Promise.reject(new ApiError(404, 'Cannot POST /api/v1/mobile/returns/create', [{ field: 'request', code: 'HTTP_404', message: 'Cannot POST /api/v1/mobile/returns/create' }])) });
  assert.ok(missing.routeMissing);
});

test('paging: hasMore, else page × size against total', () => {
  assert.equal(pageHasMore({ hasMore: false, total: 999 }, 200), false);
  assert.equal(pageHasMore({ page: 1, pageSize: 200, total: 250 }, 200), true);
  assert.equal(pageHasMore({ page: 2, pageSize: 200, total: 250 }, 50), false);
  assert.equal(pageHasMore({}, 0), false);
});

test('return data: reasons, godowns, rules and the bills with their lines, page by page', async () => {
  const pages = [
    {
      page: 1,
      pageSize: 1,
      total: 2,
      asOf: '2026-11-20T08:05:00Z',
      bills: [
        {
          sbId: 'sb1',
          accYear: '2026-2027',
          refno: 'SB/2627/02107',
          date: '2026-10-28',
          custId: 'cus1',
          billAmount: '12600.00',
          due: '12600.00',
          lines: [{ billItemId: 'sbi1', accYear: '2026-2027', lineNo: 1, itemId: 'oil', itemUnitId: 'pcs', toBaseFactor: 1, billQty: 20, billQtyBase: 20, returnedQtyBase: 0, qtyLeftBase: 20, ratePreTaxBase: '150.0000', taxPerc: '5', isFree: false }],
        },
      ],
    },
    { page: 2, pageSize: 1, total: 2, bills: [{ sbId: 'sb2', accYear: '2026-2027', refno: 'SB/2627/02149', date: '2026-11-05T00:00:00Z', custId: 'cus1', billAmount: 4212, lines: [] }] },
  ];
  const d = await downloadReturnData(
    [{ companyId: 'co1', branchId: 'br1' }],
    {
      options: async () => ({
        reasons: [
          { reasonId: 'r1', code: 'SR_DAMAGED', name: 'Damaged / leaking', defaultCondition: 'DAMAGED', refundCharges: true },
          { reasonId: 'r2', code: 'SR_EXPIRED_SHOP', name: 'Expired at the shop (claim)', defaultCondition: 'EXPIRED', isClaim: true },
        ],
        godowns: [{ godownId: 'g1', name: 'Coimbatore — Main', isDefault: true }],
        settings: { returnWindowDays: 45, freeReturnAllowed: true, settleDefault: null },
        rights: { post: false },
      }),
      billsPage: async (_c, _b, page) => pages[page - 1]!,
    },
    '2026-11-20T08:10:00Z',
  );
  assert.equal(d.reasons.length, 2);
  assert.equal(d.reasons[1]!.isClaim, true);
  assert.equal(d.godowns[0]!.isDefault, true);
  assert.equal(d.bills.length, 2);
  assert.equal(d.bills[1]!.billDate, '2026-11-05');
  assert.equal(d.lines.length, 1);
  assert.equal(d.lines[0]!.qtyLeftBase, '20');
  assert.equal(d.settings[0]!.returnWindowDays, 45);
  assert.equal(d.settings[0]!.billDays, 90);
  assert.equal(d.settings[0]!.canPost, false);
  assert.equal(d.settings[0]!.billsAsOf, '2026-11-20T08:05:00Z');
});
