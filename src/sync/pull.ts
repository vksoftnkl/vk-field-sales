import { eq, inArray } from 'drizzle-orm';

import { api } from '@/api/endpoints';
import type { CustomerDTO, ItemDTO, ItemPriceDTO, PullScope, UserDTO } from '@/api/types';
import { SYNC } from '@/config/env';
import { db, type Tx } from '@/db/client';
import { customers, itemPrices, items, syncCursors, users } from '@/db/schema';

/**
 * Incremental download of masters. Each scope keeps its own cursor; a page of rows
 * and the new cursor are written in ONE transaction, so a crash mid-pull never
 * skips or half-applies data. Re-running is always safe (upserts).
 */
interface ScopeHandler<Row> {
  apply(tx: Tx, rows: Row[], deletedIds: string[]): void;
}

interface DtoFor {
  users: UserDTO;
  customers: CustomerDTO;
  items: ItemDTO;
  item_prices: ItemPriceDTO;
}

const handlers: { [S in PullScope]: ScopeHandler<DtoFor[S]> } = {
  users: {
    apply(tx, rows, deletedIds) {
      for (const u of rows) {
        const loginName = u.loginName.trim();
        const isActive = u.isActive ?? true;
        const v = {
          loginName,
          displayName: u.displayName?.trim() || loginName,
          // Keep a hash only for users who may sign in.
          passwordHash: isActive ? u.passwordHash : '',
          isActive,
          serverUpdatedAt: u.updatedAt ?? null,
        };
        tx.insert(users).values({ id: u.id, ...v }).onConflictDoUpdate({ target: users.id, set: v }).run();
      }
      if (deletedIds.length) {
        tx.update(users).set({ isActive: false, passwordHash: '' }).where(inArray(users.id, deletedIds)).run();
      }
    },
  },
  customers: {
    apply(tx, rows, deletedIds) {
      for (const c of rows) {
        const v = {
          code: c.code ?? null,
          name: c.name,
          mobile: c.mobile ?? null,
          gstin: c.gstin ?? null,
          stateCode: c.stateCode ?? null,
          address: c.address ?? null,
          beatId: c.beatId ?? null,
          priceLevel: c.priceLevel ?? null,
          creditLimitPaise: c.creditLimitPaise ?? 0,
          creditBillLimit: c.creditBillLimit ?? 0,
          outstandingPaise: c.outstandingPaise ?? 0,
          isActive: c.isActive ?? true,
          serverUpdatedAt: c.updatedAt ?? null,
        };
        tx.insert(customers).values({ id: c.id, ...v }).onConflictDoUpdate({ target: customers.id, set: v }).run();
      }
      if (deletedIds.length) tx.update(customers).set({ isActive: false }).where(inArray(customers.id, deletedIds)).run();
    },
  },
  items: {
    apply(tx, rows, deletedIds) {
      for (const i of rows) {
        const v = {
          code: i.code ?? null,
          name: i.name,
          barcode: i.barcode ?? null,
          hsn: i.hsn ?? null,
          unit: i.unit ?? 'NOS',
          mrpPaise: i.mrpPaise ?? 0,
          gstRateBp: i.gstRateBp,
          cessRateBp: i.cessRateBp ?? 0,
          taxInclusive: i.taxInclusive ?? false,
          isActive: i.isActive ?? true,
          serverUpdatedAt: i.updatedAt ?? null,
        };
        tx.insert(items).values({ id: i.id, ...v }).onConflictDoUpdate({ target: items.id, set: v }).run();
      }
      if (deletedIds.length) tx.update(items).set({ isActive: false }).where(inArray(items.id, deletedIds)).run();
    },
  },
  item_prices: {
    apply(tx, rows, deletedIds) {
      // deletedIds here are item ids whose price rows were all removed.
      if (deletedIds.length) tx.delete(itemPrices).where(inArray(itemPrices.itemId, deletedIds)).run();
      for (const p of rows) {
        tx.insert(itemPrices)
          .values(p)
          .onConflictDoUpdate({ target: [itemPrices.itemId, itemPrices.priceLevel], set: { ratePaise: p.ratePaise } })
          .run();
      }
    },
  },
};

/** Order matters: users first (so a new phone can sign in), items before prices. */
export const PULL_SCOPES: PullScope[] = ['users', 'customers', 'items', 'item_prices'];

function getCursor(scope: PullScope): string | null {
  return db.select().from(syncCursors).where(eq(syncCursors.scope, scope)).get()?.cursor ?? null;
}

export async function pullScope(scope: PullScope): Promise<number> {
  let cursor = getCursor(scope);
  let total = 0;
  for (;;) {
    const page = await api.sync.pull<never>(scope, cursor, SYNC.pullPageSize);
    const now = new Date().toISOString();
    db.transaction((tx) => {
      (handlers[scope] as ScopeHandler<unknown>).apply(tx, page.rows, page.deletedIds);
      tx.insert(syncCursors)
        .values({ scope, cursor: page.nextCursor, lastPulledAt: now })
        .onConflictDoUpdate({ target: syncCursors.scope, set: { cursor: page.nextCursor, lastPulledAt: now } })
        .run();
    });
    total += page.rows.length;
    cursor = page.nextCursor;
    if (!page.hasMore) break;
  }
  return total;
}

export async function pullAll(): Promise<number> {
  let n = 0;
  for (const scope of PULL_SCOPES) n += await pullScope(scope);
  return n;
}

/** Force a full re-download of one scope (e.g. "Refresh items" in settings). */
export function resetCursor(scope: PullScope): void {
  db.delete(syncCursors).where(eq(syncCursors.scope, scope)).run();
}

/**
 * Server said WIPE (lost phone): forget everything that came from VK Nex — users and
 * their password hashes, customers, items, prices — and reset the cursors so the next
 * approved sync downloads it all again. Unsent orders and the outbox are kept.
 */
export function clearMasters(): void {
  db.transaction((tx) => {
    tx.delete(users).run();
    tx.delete(itemPrices).run();
    tx.delete(items).run();
    tx.delete(customers).run();
    tx.delete(syncCursors).run();
  });
}
