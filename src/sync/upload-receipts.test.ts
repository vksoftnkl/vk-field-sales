// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { downloadReceiptData, rupeesToPaise, toLocalOpenBills, toLocalTenders } from './download-receipt-data.ts';
import { RECEIPT_CUSTOMER_NOT_SENT, toReceiptPayload, uploadReceipts, type PendingReceipt } from './upload-receipts.ts';
import { ApiError, NetworkError, type CreatedReceipt } from './vk-nex-api.ts';

const receipt = (id: string, more: Partial<PendingReceipt> = {}): PendingReceipt => ({
  header: {
    avhClientUuid: id,
    avhCompanyId: 'co1',
    avhPartyId: 'cus1',
    appPartyName: 'Sri Murugan Stores',
    avhVoucherDate: '2026-11-17',
    avhUsrRefno: 'R3F9A/2627/00001',
    appSlno: 1,
    appAccYear: '2026-2027',
    avhDeviceId: 'VKSMAN-000000003F9A',
    avhDocAmount: '16350.00',
    avhRemarks: null,
    appUserId: 'u1',
    avhCreatedOn: '2026-11-17T10:00:00.000Z',
    appPendingUpload: true,
    appSyncError: null,
    avhVoucherId: null,
    avhVoucherRefno: null,
    avhVoucherStatus: null,
    appSyncedOn: null,
  },
  lines: [
    {
      tdId: 't2',
      tdSrcDocId: id,
      tdRowNo: 2,
      tdTenderId: 'bank',
      tdTenderTypeId: 6,
      appTenderName: 'Bank transfer',
      tdAmount: '10000.00',
      tdSurchargeAmt: '0',
      tdRefNo: 'UTR4417',
      tdBankName: null,
      tdInstrumentDate: null,
    },
    {
      tdId: 't1',
      tdSrcDocId: id,
      tdRowNo: 1,
      tdTenderId: 'cash',
      tdTenderTypeId: 1,
      appTenderName: 'Cash',
      tdAmount: '6350.00',
      tdSurchargeAmt: '0',
      tdRefNo: null,
      tdBankName: null,
      tdInstrumentDate: null,
    },
  ],
  customerPending: false,
  ...more,
});

const created = (dup = false): CreatedReceipt => ({
  avhVoucherId: 'v1',
  avhVoucherRefno: 'RCT/2627/0007',
  avhVoucherStatus: 'POSTED',
  avhAccYear: '2026-2027',
  duplicate: dup,
});

test('the payload carries only the money, in row order, with no row numbers or empty keys', () => {
  const p = toReceiptPayload(receipt('r1'));
  assert.deepEqual(p, {
    avhClientUuid: 'r1',
    avhCompanyId: 'co1',
    avhPartyId: 'cus1',
    avhVoucherDate: '2026-11-17',
    avhUsrRefno: 'R3F9A/2627/00001',
    tenders: [
      { tdTenderId: 'cash', tdTenderTypeId: 1, tdAmount: 6350 },
      { tdTenderId: 'bank', tdTenderTypeId: 6, tdAmount: 10000, tdRefNo: 'UTR4417' },
    ],
  });
});

test('upload: sent, already there, refused, waiting for its customer', async () => {
  const synced: string[] = [];
  const refused: [string, string][] = [];
  const answers: (CreatedReceipt | Error)[] = [created(), created(true), new ApiError(400, 'Year closed', [{ message: 'Year closed', code: 'VCH_YEAR_CLOSED' }])];
  const r = await uploadReceipts([receipt('a'), receipt('b'), receipt('c'), receipt('d', { customerPending: true })], {
    create: async () => {
      const next = answers.shift()!;
      if (next instanceof Error) throw next;
      return next;
    },
    markSynced: (id) => synced.push(id),
    markRefused: (id, e) => refused.push([id, e]),
  });
  assert.deepEqual(
    r.outcomes.map((o) => o.status),
    ['uploaded', 'alreadySaved', 'refused', 'waiting'],
  );
  assert.deepEqual(synced, ['a', 'b']);
  assert.equal(refused[1]![1], RECEIPT_CUSTOMER_NOT_SENT);
  assert.equal(r.outcomes[0]!.voucherRefno, 'RCT/2627/0007');
});

test('upload stops on no answer, and on a refusal of the phone itself', async () => {
  const deps = { markSynced: () => {}, markRefused: () => {} };
  const lost = await uploadReceipts([receipt('a'), receipt('b')], { ...deps, create: async () => Promise.reject(new NetworkError('down')) });
  assert.ok(lost.stoppedBy);
  assert.equal(lost.outcomes.length, 0);
  const denied = await uploadReceipts([receipt('a')], { ...deps, create: async () => Promise.reject(new ApiError(403, 'No post right')) });
  assert.ok(denied.refusedBy);
});

test('tenders: VK Nex keys, only the types a phone receipt can carry, surcharge kept', () => {
  const rows = toLocalTenders('co1', {
    branchId: 'br1',
    tenders: [
      { tenderId: 'cash', typeId: 1, typeCode: 'CASH', name: 'Cash', isDefault: true, surchargePerc: '0.00', surchargeAmount: '0.00' },
      { tenderId: 'upi', typeId: '3', typeCode: 'UPI', name: 'GPay', needsRef: true, refLabel: 'UTR No', surchargePerc: '1.000', surchargeAmount: '0.00' },
      { tenderId: 'credit', typeId: 9, name: 'Credit' },
    ],
  });
  assert.deepEqual(
    rows.map((r) => [r.tndId, r.tndTypeId, r.appNeedsRef, r.appRefLabel, r.appIsDefault, r.tndSurchargePerc, r.tndSurchargeAmount, r.position]),
    [
      ['cash', 1, false, null, true, '0', '0', 0],
      ['upi', 3, true, 'UTR No', false, '1.000', '0', 1],
    ],
  );
});

test('open bills: rupees to paise, order kept, settled ones dropped', () => {
  const rows = toLocalOpenBills(
    'co1',
    [
      { partyId: 'p', billId: 'b1', billAccYear: '2026-2027', docRefno: 'V/1', docDate: '2026-09-10', dueDate: null, billAmount: 4000, pendingAmount: '4000.00' },
      { partyId: 'p', billId: 'b2', billAccYear: '2026-2027', docRefno: 'V/2', docDate: '2026-10-02', billAmount: 100, pendingAmount: 0 },
    ],
    '2026-11-17T10:00:00Z',
    5,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.pendingPaise, 400000);
  assert.equal(rows[0]!.seq, 5);
  assert.equal(rupeesToPaise('12350.5'), 1235050);
});

test('download reads every page of every company', async () => {
  const pages: Record<string, { items: { partyId: string; billId: string; billAccYear: string; billAmount: number; pendingAmount: number }[]; hasMore: boolean }[]> = {
    co1: [
      { items: [{ partyId: 'p', billId: 'b1', billAccYear: 'y', billAmount: 1, pendingAmount: 1 }], hasMore: true },
      { items: [{ partyId: 'p', billId: 'b2', billAccYear: 'y', billAmount: 1, pendingAmount: 1 }], hasMore: false },
    ],
    co2: [{ items: [], hasMore: false }],
  };
  const got = await downloadReceiptData(
    ['co1', 'co2'],
    {
      options: async () => ({ branchId: null, tenders: [{ tenderId: 'cash', typeId: 1, name: 'Cash' }] }),
      openBillsPage: async (companyId, page) => pages[companyId]![page - 1]!,
    },
    'now',
  );
  assert.deepEqual(got.companyIds, ['co1', 'co2']);
  assert.deepEqual(
    got.bills.map((b) => [b.billId, b.seq]),
    [
      ['b1', 0],
      ['b2', 1],
    ],
  );
  assert.equal(got.tenders.length, 2);
});
