import { count, like, not } from 'drizzle-orm';

import { todayISO } from '@/lib/money';

import { db } from './client';
import { getMeta, setMeta } from './meta';
import { beats, companies, customerBills, customers, customerTypes, users } from './schema';
import { TEST_BEATS, TEST_COMPANIES, TEST_CUSTOMERS, TEST_CUSTOMERS_VERSION, TEST_CUSTOMER_TYPES } from './test-customers';
import { TEST_SALESMEN } from './test-salesmen';

/** TEMPORARY: fills an empty users table with the test salesmen. Remove when Sync is added back. */
export function seedTestSalesmen(): void {
  const existing = db.select({ n: count() }).from(users).get()?.n ?? 0;
  if (existing > 0) return;
  db.insert(users).values([...TEST_SALESMEN]).run();
}

/** TEMPORARY: fills an empty companies table with test companies. Remove when Sync is added back. */
export function seedTestCompanies(): void {
  const existing = db.select({ n: count() }).from(companies).get()?.n ?? 0;
  if (existing > 0) return;
  db.insert(companies).values([...TEST_COMPANIES]).run();
}

const VISIT = {
  B: { appBilled: true },
  O: { appOrderStatus: 'ordered' },
  N: { appOrderStatus: 'no_order' },
  R: { appReceived: true },
} as const;

function daysAgoISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return todayISO(d);
}

/**
 * TEMPORARY: fills the customers table with test beats, types and shops. Reloads them when
 * test-customers.ts changes (TEST_CUSTOMERS_VERSION), but never touches a table that holds
 * any other customer. Remove when Sync is added back.
 */
export function seedTestCustomers(): void {
  if (getMeta('testCustomersVersion') === TEST_CUSTOMERS_VERSION) return;
  const others = db.select({ n: count() }).from(customers).where(not(like(customers.cusId, 'test-cust-%'))).get()?.n ?? 0;
  if (others > 0) return;
  db.transaction((tx) => {
    tx.delete(customerBills).run();
    tx.delete(customers).run();
    tx.delete(beats).run();
    tx.delete(customerTypes).run();
    tx.insert(beats).values([...TEST_BEATS]).run();
    tx.insert(customerTypes).values([...TEST_CUSTOMER_TYPES]).run();
    TEST_CUSTOMERS.forEach((c, i) => {
      const id = `test-cust-${String(i + 1).padStart(3, '0')}`;
      tx.insert(customers)
        .values({
          cusId: id,
          cusCode: `C${String(i + 1).padStart(3, '0')}`,
          cusName: c.name,
          cusPhone1: c.mobile,
          cusCity: c.place,
          cusDistrict: 'Namakkal',
          cusStateName: 'Tamil Nadu',
          cusStateCode: '33',
          cusAreaId: c.beatId,
          cusGroupId: c.typeId,
          cusGstType: 'UNREGISTERED',
          cusSortOrder: i + 1,
          ...(c.visit ? VISIT[c.visit] : {}),
        })
        .run();
      c.bills.forEach(([daysAgo, rupees], j) => {
        tx.insert(customerBills)
          .values({
            id: `${id}-bill-${j + 1}`,
            customerId: id,
            billNo: `T${String(i + 1).padStart(3, '0')}${j + 1}`,
            billDate: daysAgoISO(daysAgo),
            balancePaise: rupees * 100,
          })
          .run();
      });
    });
  });
  setMeta('testCustomersVersion', TEST_CUSTOMERS_VERSION);
}
