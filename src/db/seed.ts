import { count } from 'drizzle-orm';

import { db } from './client';
import { companies, users } from './schema';
import { TEST_COMPANIES } from './test-companies';
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
