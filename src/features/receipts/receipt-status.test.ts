// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { plannedRows, type ReceiptItem } from './receipt-plan.ts';
import { surchargePaise } from './receipt-math.ts';
import { amountInWords, collectionTotals, parseAdjusted, parsePdc, rcState, refusalHint, savedReceiptMoney, settledBreakdown, splitRefusal } from './receipt-status.ts';
import { settle } from './settle.ts';

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

test("a saved receipt's total is every payment line plus its surcharge", () => {
  // Cash 100 and UPI 200 at 1%, saved with the fee inside td_amount (202.00).
  const lines = [
    { amount: '100.00', surcharge: '0.00' },
    { amount: '202.00', surcharge: '2.00' },
  ];
  assert.deepEqual(savedReceiptMoney(lines), { receivedPaise: 30000, surchargePaise: 200, totalPaise: 30200 });
  // Lines saved before surcharges were kept (null): no fee.
  assert.deepEqual(savedReceiptMoney([{ amount: '500.00', surcharge: null }]), { receivedPaise: 50000, surchargePaise: 0, totalPaise: 50000 });
});

test('what the bills got, less credits, discount and round-off, plus on account is the money received', () => {
  const item = (key: string, kind: ReceiptItem['kind'], pendingPaise: number, ppd: ReceiptItem['ppd'] = []): ReceiptItem => ({
    billId: key,
    billAccYear: '2026-2027',
    companyId: 'co',
    kind,
    docRefno: key,
    docDate: '2026-11-01',
    dueDate: null,
    billAmountPaise: pendingPaise,
    pendingPaise,
    paidPaise: 0,
    pdcHeldPaise: 0,
    ppdSchedule: null,
    key: `${key}|2026-2027`,
    ppd,
  });
  // A 50 return held, B1 1000 with 2% off till month end, B2 800 (one by hand with round-off), 1500 received.
  const items = [item('R1', 'SALES_RETURN', 5000), item('B1', 'BILL', 100000, [{ tillDate: '2026-11-30', perc: 2 }]), item('B2', 'BILL', 80000)];
  const sum = settle({
    amountPaise: 150000,
    date: '2026-11-20',
    items,
    typedBills: { 'B2|2026-2027': { receivePaise: 79950, discountPaise: 0, roundoffPaise: 50 } },
  });
  const rows = plannedRows(sum, items).map((p) => ({
    kind: p.kind,
    settledPaise: Math.round(Number(p.amount) * 100) + (p.kind === 'BILL' ? Math.round(Number(p.credit) * 100) + Math.round(Number(p.discount) * 100) + Math.round(Number(p.roundoff) * 100) : 0),
    discountPaise: Math.round(Number(p.discount) * 100),
    roundoffPaise: Math.round(Number(p.roundoff) * 100),
  }));
  const b = settledBreakdown(rows);
  assert.equal(b.creditsPaise, 5000);
  assert.equal(b.roundoffPaise, 50);
  assert.equal(b.billsPaise, sum.settledPaise);
  assert.equal(b.cashPaise + sum.onAccountPaise, 150000);
  // Paid by UPI at 1%: the slip's total is that money plus the fee.
  const fee = surchargePaise(150000, '1.000', '0');
  assert.equal(savedReceiptMoney([{ amount: ((150000 + fee) / 100).toFixed(2), surcharge: (fee / 100).toFixed(2) }]).totalPaise, 150000 + fee);
});
