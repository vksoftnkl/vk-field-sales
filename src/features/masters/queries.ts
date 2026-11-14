import { and, asc, eq, like, or } from 'drizzle-orm';

import { db } from '@/db/client';
import { customers, items } from '@/db/schema';

/** Search helpers — always local SQLite, never the network. Use with useLiveQuery. */
export const masterQueries = {
  customers: (search: string, limit = 200) => {
    const q = `%${search.trim()}%`;
    return db
      .select()
      .from(customers)
      .where(
        and(
          eq(customers.isActive, true),
          search.trim() ? or(like(customers.name, q), like(customers.code, q), like(customers.mobile, q)) : undefined,
        ),
      )
      .orderBy(asc(customers.name))
      .limit(limit);
  },

  items: (search: string, limit = 200) => {
    const q = `%${search.trim()}%`;
    return db
      .select()
      .from(items)
      .where(
        and(
          eq(items.isActive, true),
          search.trim() ? or(like(items.name, q), like(items.code, q), eq(items.barcode, search.trim())) : undefined,
        ),
      )
      .orderBy(asc(items.name))
      .limit(limit);
  },

  customerById: (id: string) => db.select().from(customers).where(eq(customers.id, id)),
};
