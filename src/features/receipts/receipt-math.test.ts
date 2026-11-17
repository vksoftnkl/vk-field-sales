// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  afterReceipts,
  amountPaise,
  autoAdjust,
  billState,
  daysFrom,
  payUpTo,
  receiptProblem,
  receiptSummary,
  surchargeInside,
  surchargePaise,
  tenderAmountFor,
  tenderBalance,
  tenderProblem,
  TENDER_TYPE,
  type PayableBill,
  type TenderLineInput,
} from './receipt-math.ts';

// The mockup's four bills, oldest first.
const bills: PayableBill[] = [
  { key: 'a', pendingPaise: 400000 },
  { key: 'b', pendingPaise: 1235000 },
  { key: 'c', pendingPaise: 1300000 },
  { key: 'd', pendingPaise: 910000 },
];

test('auto adjust pays the oldest bills first', () => {
  const alloc = autoAdjust(1635000, bills);
  assert.deepEqual(alloc, { a: 400000, b: 1235000 });
  const s = receiptSummary(1635000, bills, alloc);
  assert.equal(s.adjustedPaise, 1635000);
  assert.equal(s.onAccountPaise, 0);
  assert.equal(s.stillPending, 2);
  assert.equal(s.billCount, 4);
});

test('a part payment leaves the rest pending', () => {
  const alloc = autoAdjust(500000, bills);
  assert.deepEqual(alloc, { a: 400000, b: 100000 });
  assert.deepEqual(billState(bills[1]!, alloc), { kind: 'part', leftPaise: 1135000 });
  assert.deepEqual(billState(bills[0]!, alloc), { kind: 'completed', leftPaise: 0 });
  assert.deepEqual(billState(bills[2]!, alloc), { kind: 'none', leftPaise: 1300000 });
});

test('more than every bill goes on account', () => {
  const alloc = autoAdjust(4000000, bills);
  const s = receiptSummary(4000000, bills, alloc);
  assert.equal(s.adjustedPaise, 3845000);
  assert.equal(s.onAccountPaise, 155000);
});

test('bills ticked by hand raise the receipt amount', () => {
  const s = receiptSummary(0, bills, { c: 1300000 });
  assert.equal(s.amountPaise, 1300000);
  assert.equal(s.onAccountPaise, 0);
});

test('problems', () => {
  assert.equal(receiptProblem(receiptSummary(0, bills, {}), bills, {}), 'noAmount');
  assert.equal(receiptProblem(receiptSummary(0, bills, { a: 500000 }), bills, { a: 500000 }), 'overPending');
  assert.equal(receiptProblem(receiptSummary(100, bills, {}), bills, {}), null);
});

test('payment lines must add up to the receipt', () => {
  assert.deepEqual(tenderBalance(1635000, [{ amount: '6,350.00' }, { amount: '10000' }]), { tenderPaise: 1635000, balancePaise: 0 });
  assert.deepEqual(tenderBalance(1635000, [{ amount: '' }]), { tenderPaise: 0, balancePaise: 1635000 });
  assert.equal(amountPaise('abc'), 0);
});

test('bill age in days', () => {
  assert.equal(daysFrom('2026-09-10', '2026-11-14'), 65);
  assert.equal(daysFrom('2026-11-14', '2026-11-14'), 0);
});

test('the phone’s unsent receipts come off the oldest bills first', () => {
  const left = afterReceipts(bills, [500000, 100000]);
  assert.deepEqual(
    left.map((b) => b.pendingPaise),
    [0, 1035000, 1300000, 910000],
  );
});

test('pay up to a bill covers it and every older one', () => {
  assert.equal(payUpTo(bills, 0), 400000);
  assert.equal(payUpTo(bills, 1), 1635000);
  const alloc = autoAdjust(payUpTo(bills, 1), bills);
  assert.equal(billState(bills[1]!, alloc).kind, 'completed');
  assert.equal(billState(bills[2]!, alloc).kind, 'none');
});

test('payment lines VK Nex would refuse', () => {
  const base: TenderLineInput = { amount: '100', typeId: TENDER_TYPE.CASH, needsRef: false, refNo: '', bankName: '', instrumentDate: null };
  assert.equal(tenderProblem(base), null);
  assert.equal(tenderProblem({ ...base, amount: '' }), 'noAmount');
  const cheque = { ...base, typeId: TENDER_TYPE.CHEQUE };
  assert.equal(tenderProblem(cheque), 'chequeNo');
  assert.equal(tenderProblem({ ...cheque, refNo: '004417' }), 'bankName');
  assert.equal(tenderProblem({ ...cheque, refNo: '004417', bankName: 'IOB' }), 'chequeDate');
  assert.equal(tenderProblem({ ...cheque, refNo: '004417', bankName: 'IOB', instrumentDate: '2026-11-20' }), null);
  const card = { ...base, typeId: TENDER_TYPE.CARD, needsRef: true };
  assert.equal(tenderProblem({ ...card, refNo: '12' }), 'cardLast4');
  assert.equal(tenderProblem({ ...card, refNo: '1234' }), null);
  assert.equal(tenderProblem({ ...base, typeId: TENDER_TYPE.UPI, needsRef: true }), 'refNo');
  assert.equal(tenderProblem({ ...base, typeId: TENDER_TYPE.UPI }), null);
});

test('a tender surcharge: VK Nex back-calculates it, so the phone sends what leaves the principal', () => {
  // 200 by UPI at 1% goes as 202.00.
  assert.equal(tenderAmountFor(20000, '1.00', '0'), 20200);
  assert.equal(surchargePaise(20000, '1.00', '0'), 200);
  // With a %, the flat amount is not used.
  assert.equal(surchargePaise(20000, '1.000', '5.00'), 200);
  // With no %, the flat amount, once per line.
  assert.equal(tenderAmountFor(20000, '0', '5.00'), 20500);
  assert.equal(surchargeInside(20500, '0.000', '5.00'), 500);
  // No surcharge, or nothing typed.
  assert.equal(surchargePaise(20000, '0.000', '0.00'), 0);
  assert.equal(tenderAmountFor(0, '1.00', '5.00'), 0);
});

test('every amount round-trips through VK Nex’s back-calculation exactly', () => {
  for (const perc of ['0.5', '1.000', '1.8', '2.5', '3.333', '18']) {
    for (let principal = 1; principal <= 30000; principal += 7) {
      const t = tenderAmountFor(principal, perc, '0');
      assert.equal(t - surchargeInside(t, perc, '0'), principal, `${perc}% of ${principal}`);
    }
  }
});
