// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { downloadReceiptData, rupeesToPaise, toLocalBanks, toLocalOpenBills, toLocalReceiptSettings, toLocalTenders } from './download-receipt-data.ts';
import { RECEIPT_CUSTOMER_NOT_SENT, RECEIPT_SEND_TRIED, toReceiptPayload, uploadReceipts, type PendingReceipt } from './upload-receipts.ts';
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

test('an older VK Nex without the receipts route: every receipt waits, none is marked refused', async () => {
  const refused: string[] = [];
  const missing = new ApiError(404, 'Cannot POST /api/v1/mobile/receipts/create', [{ field: 'request', code: 'HTTP_404', message: 'Cannot POST /api/v1/mobile/receipts/create' }]);
  const r = await uploadReceipts([receipt('a'), receipt('b')], {
    create: async () => Promise.reject(missing),
    markSynced: () => {},
    markRefused: (id) => refused.push(id),
  });
  assert.ok(r.routeMissing);
  assert.deepEqual(refused, []);
  // A real refusal of one receipt (VK Nex's own code) is still per receipt.
  const party = new ApiError(404, 'Party not found', [{ code: 'VCH_PARTY_NOT_FOUND', message: 'Party not found' }]);
  const one = await uploadReceipts([receipt('c')], { create: async () => Promise.reject(party), markSynced: () => {}, markRefused: (id) => refused.push(id) });
  assert.equal(one.routeMissing, undefined);
  assert.deepEqual(refused, ['c']);
});

test('a desktop-rule receipt sends its plan: bills, credits, on account, refs and cheque details', () => {
  const base = receipt('r9');
  const p = toReceiptPayload({
    ...base,
    header: { ...base.header, avhBranchId: 'br1', avhDocRefno: '1187', avhDocDate: '2026-11-17', appOnAccount: '0.00' } as PendingReceipt['header'],
    lines: [{ ...base.lines[0]!, tdTenderTypeId: 5, appChequeBranch: 'Tirunelveli Jn', appChequeIfsc: null, appChequeDrawer: '' } as PendingReceipt['lines'][number]],
    allocations: [
      { ralId: 'a1', ralReceiptId: 'r9', ralSource: 'PLANNED', ralKind: 'BILL', ralBillId: 'b1', ralBillAccYear: '2026-2027', appDocRefno: 'SB/1', ralAmount: '6700.00', ralCredit: '1750.00', ralDiscount: '0', ralRoundoff: '0' },
      { ralId: 'a2', ralReceiptId: 'r9', ralSource: 'PLANNED', ralKind: 'BILL', ralBillId: 'b2', ralBillAccYear: '2026-2027', appDocRefno: 'SB/2', ralAmount: '12474.00', ralCredit: '0', ralDiscount: '126.00', ralRoundoff: '0.40' },
      { ralId: 'a3', ralReceiptId: 'r9', ralSource: 'PLANNED', ralKind: 'BILL', ralBillId: 'b3', ralBillAccYear: '2026-2027', appDocRefno: 'SB/3', ralAmount: '0', ralCredit: '0', ralDiscount: '0', ralRoundoff: '0' },
      { ralId: 'a4', ralReceiptId: 'r9', ralSource: 'PLANNED', ralKind: 'CREDIT', ralBillId: 'sr31', ralBillAccYear: '2026-2027', appDocRefno: 'SR/31', ralAmount: '1250.00', ralCredit: '0', ralDiscount: '0', ralRoundoff: '0' },
      { ralId: 'a5', ralReceiptId: 'r9', ralSource: 'POSTED', ralKind: 'BILL', ralBillId: 'b9', ralBillAccYear: '2026-2027', appDocRefno: 'SB/9', ralAmount: '1.00', ralCredit: '0', ralDiscount: '0', ralRoundoff: '0' },
    ],
  });
  assert.equal(p.avhBranchId, 'br1');
  assert.deepEqual([p.avhDocRefno, p.avhDocDate], ['1187', '2026-11-17']);
  assert.deepEqual(p.allocations, [
    { billId: 'b1', billAccYear: '2026-2027', amount: 8450 },
    { billId: 'b2', billAccYear: '2026-2027', amount: 12474, discount: 126, roundoff: 0.4 },
  ]);
  assert.deepEqual(p.creditsApplied, [{ billId: 'sr31', billAccYear: '2026-2027', amount: 1250 }]);
  assert.equal(p.onAccount, 0);
  assert.deepEqual((p.tenders as Record<string, unknown>[])[0]!.cheque, { bankBranch: 'Tirunelveli Jn' });
});

test('an older receipt (no plan) still sends only the money', () => {
  const p = toReceiptPayload(receipt('r10'));
  for (const k of ['allocations', 'creditsApplied', 'onAccount', 'avhBranchId', 'avhDocRefno', 'avhDocDate']) assert.equal(k in p, false, k);
  assert.equal('cheque' in (p.tenders as Record<string, unknown>[])[0]!, false);
});

test('a bill cleared by a credit alone is sent, money and credit add up in paise', () => {
  const base = receipt('r11');
  const p = toReceiptPayload({
    ...base,
    header: { ...base.header, appOnAccount: '0.00' } as PendingReceipt['header'],
    allocations: [
      { ralId: 'c1', ralReceiptId: 'r11', ralSource: 'PLANNED', ralKind: 'CREDIT', ralBillId: 'sr1', ralBillAccYear: '2026-2027', appDocRefno: 'SR/1', ralAmount: '1250.00', ralCredit: '0', ralDiscount: '0', ralRoundoff: '0' },
      { ralId: 'c2', ralReceiptId: 'r11', ralSource: 'PLANNED', ralKind: 'BILL', ralBillId: 'b1', ralBillAccYear: '2026-2027', appDocRefno: 'SB/1', ralAmount: '0.00', ralCredit: '1000.00', ralDiscount: '0', ralRoundoff: '0' },
      { ralId: 'c3', ralReceiptId: 'r11', ralSource: 'PLANNED', ralKind: 'BILL', ralBillId: 'b2', ralBillAccYear: '2026-2027', appDocRefno: 'SB/2', ralAmount: '3000.10', ralCredit: '250.20', ralDiscount: '0', ralRoundoff: '0' },
    ],
  });
  assert.deepEqual(p.allocations, [
    { billId: 'b1', billAccYear: '2026-2027', amount: 1000 },
    { billId: 'b2', billAccYear: '2026-2027', amount: 3250.3 },
  ]);
});

test('everything kept on account while bills were open sends an empty plan, not the old fill', () => {
  const base = receipt('r12');
  const p = toReceiptPayload({ ...base, header: { ...base.header, appOnAccount: '5000.00' } as PendingReceipt['header'], allocations: [] });
  assert.deepEqual(p.allocations, []);
  assert.equal('creditsApplied' in p, false);
  assert.equal(p.onAccount, 5000);
});

test('a receipt is marked as being sent: a lost answer keeps the mark, no route puts the old note back', async () => {
  const notes = new Map<string, string | null>();
  const deps = {
    markSynced: (id: string) => notes.set(id, null),
    markRefused: (id: string, e: string) => notes.set(id, e),
    markTried: (id: string, e: string | null) => notes.set(id, e),
  };
  await uploadReceipts([receipt('a')], { ...deps, create: async () => Promise.reject(new NetworkError('down')) });
  assert.equal(notes.get('a'), RECEIPT_SEND_TRIED);

  const missing = new ApiError(404, 'Cannot POST /api/v1/mobile/receipts/create', [{ field: 'request', code: 'HTTP_404', message: 'Cannot POST' }]);
  const back = receipt('b');
  back.header.appSyncError = 'ACC_COLLECTOR_REQUIRED: needs the salesman';
  await uploadReceipts([back], { ...deps, create: async () => Promise.reject(missing) });
  assert.equal(notes.get('b'), 'ACC_COLLECTOR_REQUIRED: needs the salesman');

  await uploadReceipts([receipt('c')], { ...deps, create: async () => created() });
  assert.equal(notes.get('c'), null);
});

test("a transfer's type goes as tdTransferType only once VK Nex takes it, and only on the transfer", () => {
  const base = receipt('r10');
  const withType = { ...base, lines: base.lines.map((l) => ({ ...l, tdTransferType: 'NEFT' }) as PendingReceipt['lines'][number]) };
  const keys = (r: PendingReceipt) => (toReceiptPayload(r).tenders as Record<string, unknown>[]).map((t) => [t.tdTenderTypeId, t.tdTransferType]);
  // An older VK Nex refuses keys it doesn't know: the type stays on the phone.
  assert.deepEqual(keys(withType), [
    [1, undefined],
    [6, undefined],
  ]);
  assert.deepEqual(keys({ ...withType, takesTransferType: true }), [
    [1, undefined],
    [6, 'NEFT'],
  ]);
  // A transfer saved before the type was asked for goes without it.
  assert.deepEqual(keys({ ...base, takesTransferType: true }), [
    [1, undefined],
    [6, undefined],
  ]);
});

test('options: listing transferTypes means VK Nex takes the type', () => {
  const opts = { branchId: null, tenders: [] };
  assert.equal(toLocalReceiptSettings('co1', opts, 'now').appTakesTransferType, false);
  assert.equal(toLocalReceiptSettings('co1', { ...opts, transferTypes: [] }, 'now').appTakesTransferType, false);
  assert.equal(toLocalReceiptSettings('co1', { ...opts, transferTypes: ['NEFT', 'IMPS', 'RTGS'] }, 'now').appTakesTransferType, true);
});

test('bank list (GET /mobile/banks/list): VK Nex order kept, names once, junk rows dropped, no list = keep the old', () => {
  assert.equal(toLocalBanks(undefined), null);
  assert.equal(toLocalBanks(null), null);
  assert.deepEqual(toLocalBanks([]), []);
  assert.deepEqual(
    toLocalBanks([
      { bankId: 'b1', name: ' Karur Vysya Bank ', shortName: 'KVB' },
      { bankId: 'b2', name: 'karur vysya bank' },
      { bankId: '', name: 'No id' },
      { bankId: 'b3', name: '  ' },
      { bankId: 'b4', name: 'Indian Bank', shortName: '' },
    ]),
    [
      { bnkId: 'b1', bnkName: 'Karur Vysya Bank', bnkShortName: 'KVB', position: 0 },
      { bnkId: 'b4', bnkName: 'Indian Bank', bnkShortName: null, position: 1 },
    ],
  );
});
