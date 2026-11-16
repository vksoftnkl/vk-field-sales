import { count } from 'drizzle-orm';

import { db } from './client';
import { users } from './schema';
import { TEST_SALESMEN } from './test-salesmen';

/** TEMPORARY: fills an empty users table with the test salesmen. Remove when Sync is added back. */
export function seedTestSalesmen(): void {
  const existing = db.select({ n: count() }).from(users).get()?.n ?? 0;
  if (existing > 0) return;
  db.insert(users).values([...TEST_SALESMEN]).run();
}

