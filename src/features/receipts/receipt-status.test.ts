// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { amountInWords, collectionTotals, parseAdjusted, parsePdc, rcState, refusalHint, splitRefusal } from './receipt-status.ts';

const base = { appPendingUpload: false, appSyncError: null, avhVoucherStatus: 'POSTED', appCancelledOn: null };

test('a receipt is waiting, sent back, posted or cancelled', () => {
  assert.equal(rcState({ ...base, appPendingUpload: true, avhVoucherStatus: null }), 'waiting');
  assert.equal(rcState({ ...base, appPendingUpload: true, avhVoucherStatus: null, appSyncError: 'CUSTOMER_NOT_SENT: The customer is not on VK Nex yet' }), 'waiting');
  assert.equal(rcState({ ...base, appPendingUpload: true, avhVoucherStatus: null, appSyncError: 'ACC_COLLECTOR_REQUIRED: needs the salesman' }), 'sentBack');
  assert.equal(rcState(base), 'posted');
  assert.equal(rcState({ ...base, avhVoucherStatus: 'cancelled' }), 'cancelled');
  assert.equal(rcState({ ...base, appCancelledOn: '2026-11-19T10:00:00Z' }), 'cancelled');
});

test('a refusal splits into its code and words, and gets a hint', () => {
  assert.deepEqual(splitRefusal('ACC_COLLECTOR_REQUIRED: The company needs the collecting salesman.'), {
    code: 'ACC_COLLECTOR_REQUIRED',
    message: 'The company needs the collecting salesman.',
  });
  assert.deepEqual(splitRefusal('No code here'), { code: null, message: 'No code here' });
  assert.deepEqual(splitRefusal(null), { code: null, message: '' });
  assert.equal(refusalHint('ACC_COLLECTOR_REQUIRED'), 'collector');
  assert.equal(refusalHint('MOBILE_RECEIPT_NO_EMPLOYEE'), 'collector');
  assert.equal(refusalHint('ACC_DOC_REFNO_TAKEN'), 'docRef');
  assert.equal(refusalHint('SOMETHING_NEW'), 'general');
  assert.equal(refusalHint('ACC_PDC_ALLOCATION'), 'pdcClearing');
  assert.equal(refusalHint(null), 'general');
});

test("VK Nex's adjusted[] and PDC vouchers are read safely", () => {
  assert.deepEqual(parseAdjusted(JSON.stringify([{ billId: 'b1', billAccYear: '2026-2027', docRefno: 'SB/1950', planned: '6200.00', applied: 0, reason: 'BILL_SETTLED' }])), [
    { billId: 'b1', billAccYear: '2026-2027', docRefno: 'SB/1950', plannedPaise: 620_000, appliedPaise: 0, reason: 'BILL_SETTLED' },
  ]);
  assert.deepEqual(parseAdjusted('not json'), []);
  assert.deepEqual(parseAdjusted(null), []);
  assert.deepEqual(parsePdc(JSON.stringify([{ voucherId: 'v', voucherRefno: 'PDC/87', chequeDate: '2026-11-25T00:00:00Z', amount: '5000.00', status: 'held' }])), [
    { voucherId: 'v', voucherRefno: 'PDC/87', chequeDate: '2026-11-25', amountPaise: 500_000, status: 'HELD' },
  ]);
});

test('collection totals by mode leave out receipts not given (cancelled)', () => {
  const lines = [
    { receiptId: 'a', typeId: 1, amount: '9174.00', surcharge: '0' },
    { receiptId: 'a', typeId: 5, amount: '10000.00', surcharge: '0' },
    { receiptId: 'b', typeId: 3, amount: '5050.00', surcharge: '50.00' },
    { receiptId: 'c', typeId: 6, amount: '700.00', surcharge: '0' },
    { receiptId: 'x', typeId: 1, amount: '999.00', surcharge: '0' },
  ];
  assert.deepEqual(collectionTotals(['a', 'b', 'c'], lines), {
    receipts: 3,
    totalPaise: 2_492_400,
    cashPaise: 917_400,
    chequePaise: 1_000_000,
    upiPaise: 505_000,
    otherPaise: 70_000,
  });
});

test('amount in words, Indian style', () => {
  assert.equal(amountInWords(1_917_400), 'Rupees nineteen thousand one hundred seventy-four only');
  assert.equal(amountInWords(2_885_640), 'Rupees twenty-eight thousand eight hundred fifty-six and forty paise only');
  assert.equal(amountInWords(1_250_000_000), 'Rupees one crore twenty-five lakh only');
  assert.equal(amountInWords(10_000), 'Rupees one hundred only');
  assert.equal(amountInWords(0), 'Rupees zero only');
});
