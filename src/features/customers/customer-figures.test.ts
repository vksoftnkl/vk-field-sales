// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { byCustomer, receiptEffect, sideOf, toPhoneReceipts, withPhoneChanges, type PhoneReceipt, type SyncedFigures } from './customer-figures.ts';

// ₹12,000 of bills open and a ₹2,000 advance: outstanding 12,000, balance 10,000 Dr.
const synced: SyncedFigures = { balancePaise: 1_000_000, outstandingPaise: 1_200_000, billCount: 3, oldestBillDate: '2026-09-08' };
const receipt = (more: Partial<PhoneReceipt> = {}): PhoneReceipt => ({ customerId: 'c1', amountPaise: 500_000, postDatedPaise: 0, plan: null, ...more });

test('nothing on the phone: VK Nex figures as they came', () => {
  assert.deepEqual(withPhoneChanges(synced, [], []), { ...synced, changedOnPhone: false });
});

test('no Sync figures yet: unknown, unless the shop was made on this phone (then from 0)', () => {
  assert.deepEqual(withPhoneChanges(null, [receipt()], []), { balancePaise: null, outstandingPaise: null, billCount: null, oldestBillDate: null, changedOnPhone: false });
  assert.deepEqual(withPhoneChanges(null, [], [{ customerId: 'c1', amountPaise: 300_000 }], true), {
    balancePaise: 300_000,
    outstandingPaise: 300_000,
    billCount: null,
    oldestBillDate: null,
    changedOnPhone: true,
  });
});

test('a receipt without a plan: VK Nex fills the oldest bills, so the money comes off both', () => {
  const f = withPhoneChanges(synced, [receipt()], []);
  assert.equal(f.balancePaise, 500_000);
  assert.equal(f.outstandingPaise, 700_000);
  assert.equal(f.changedOnPhone, true);
  // The phone can't tell which bills closed: no count or oldest date while it differs from VK Nex.
  assert.equal(f.billCount, null);
  assert.equal(f.oldestBillDate, null);
});

test('more than the bills: outstanding stops at 0 (the rest goes on account), balance goes Cr', () => {
  const f = withPhoneChanges(synced, [receipt({ amountPaise: 1_500_000 })], []);
  assert.equal(f.outstandingPaise, 0);
  assert.equal(f.billCount, 0);
  assert.equal(f.balancePaise, -500_000);
});

test('a planned receipt: bills take the money set on them, the credits, the discount and the round-off', () => {
  // ₹4,000 paid: ₹3,000 on bills, ₹1,000 on account; a ₹500 credit spent; ₹100 discount; ₹0.40 round-off.
  const r = receipt({ amountPaise: 400_000, plan: { billMoneyPaise: 300_000, creditsPaise: 50_000, discountPaise: 10_000, roundoffPaise: 40 } });
  // The ledger: money + discount + round-off (spending a credit moves nothing there).
  assert.deepEqual(receiptEffect(r), { balancePaise: 410_040, billsPaise: 360_040 });
  const f = withPhoneChanges(synced, [r], []);
  assert.equal(f.balancePaise, 1_000_000 - 410_040);
  assert.equal(f.outstandingPaise, 1_200_000 - 360_040);
});

test('a post-dated cheque counts in neither figure until its date; money in hand fills the bills first', () => {
  // ₹5,000: ₹2,000 cash + ₹3,000 cheque dated next week, all planned on bills.
  const r = receipt({ amountPaise: 500_000, postDatedPaise: 300_000, plan: { billMoneyPaise: 500_000, creditsPaise: 0, discountPaise: 0, roundoffPaise: 0 } });
  assert.deepEqual(receiptEffect(r), { balancePaise: 200_000, billsPaise: 200_000 });
  // Bills take ₹3,000 and ₹2,000 is on account: the cash covers bill money, the cheque is all on account.
  const part = receipt({ amountPaise: 500_000, postDatedPaise: 200_000, plan: { billMoneyPaise: 300_000, creditsPaise: 0, discountPaise: 0, roundoffPaise: 0 } });
  assert.deepEqual(receiptEffect(part), { balancePaise: 300_000, billsPaise: 300_000 });
  // All post-dated, no plan: nothing yet.
  assert.deepEqual(receiptEffect(receipt({ postDatedPaise: 500_000 })), { balancePaise: 0, billsPaise: 0 });
});

test('an order not sent yet goes on both, after the receipts came off', () => {
  // Receipt first clears the bills to 0, then the order adds ₹3,000 (a receipt never settles an order).
  const f = withPhoneChanges({ ...synced, outstandingPaise: 200_000 }, [receipt()], [{ customerId: 'c1', amountPaise: 300_000 }]);
  assert.equal(f.outstandingPaise, 300_000);
  assert.equal(f.balancePaise, 1_000_000 - 500_000 + 300_000);
  assert.equal(f.billCount, null);
});

test('an older VK Nex without the outstanding: the balance still moves, the outstanding stays unknown', () => {
  const f = withPhoneChanges({ ...synced, outstandingPaise: null, billCount: null }, [receipt()], [{ customerId: 'c1', amountPaise: 100_000 }]);
  assert.equal(f.balancePaise, 600_000);
  assert.equal(f.outstandingPaise, null);
});

test('Dr / Cr side, none on a figure that shows as ₹0', () => {
  assert.deepEqual(sideOf(845_000), { paise: 845_000, side: 'Dr' });
  assert.deepEqual(sideOf(-200_000), { paise: 200_000, side: 'Cr' });
  assert.deepEqual(sideOf(0), { paise: 0, side: null });
  assert.deepEqual(sideOf(-40), { paise: 40, side: null });
});

test('byCustomer groups rows by shop, in order', () => {
  const m = byCustomer([
    { customerId: 'a', n: 1 },
    { customerId: 'b', n: 2 },
    { customerId: 'a', n: 3 },
  ]);
  assert.deepEqual(m.get('a')?.map((r) => r.n), [1, 3]);
  assert.deepEqual(m.get('b')?.map((r) => r.n), [2]);
});

test('receipt rows → the rule: plan sums, post-dated cheques after today only, surcharge left out', () => {
  const got = toPhoneReceipts(
    [
      { id: 'r1', customerId: 'c1', amount: '5000.00', onAccount: '0.00' },
      { id: 'r2', customerId: 'c2', amount: '1000.00', onAccount: null },
    ],
    [
      { receiptId: 'r1', typeId: 1, amount: '2000.00', surcharge: '0', instrumentDate: null },
      // ₹3,000 cheque dated after today, ₹30 surcharge inside its amount.
      { receiptId: 'r1', typeId: 5, amount: '3030.00', surcharge: '30.00', instrumentDate: '2026-11-27' },
      // A cheque dated today counts already.
      { receiptId: 'r2', typeId: 5, amount: '1000.00', surcharge: '0', instrumentDate: '2026-11-20' },
    ],
    [
      { receiptId: 'r1', kind: 'BILL', amount: '4000.00', credit: '500.00', discount: '100.00', roundoff: '0.40' },
      { receiptId: 'r1', kind: 'BILL', amount: '1000.00', credit: '0', discount: '0', roundoff: '0' },
      { receiptId: 'r1', kind: 'CREDIT', amount: '500.00', credit: '0', discount: '0', roundoff: '0' },
    ],
    '2026-11-20',
  );
  assert.deepEqual(got, [
    { customerId: 'c1', amountPaise: 500_000, postDatedPaise: 300_000, plan: { billMoneyPaise: 500_000, creditsPaise: 50_000, discountPaise: 10_000, roundoffPaise: 40 } },
    { customerId: 'c2', amountPaise: 100_000, postDatedPaise: 0, plan: null },
  ]);
});
