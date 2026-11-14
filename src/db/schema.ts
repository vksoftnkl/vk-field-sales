/**
 * Local SQLite schema (on the phone).
 *
 * After editing this file run `npm run db:generate` to create a new migration in /drizzle.
 */
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** Small key/value store for device settings (e.g. the salesman picked last time). */
export const deviceMeta = sqliteTable('device_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

/**
 * Salesmen allowed to sign in on this phone. password_hash uses VK Nex's own format,
 * `scrypt$<salt>$<hash>`, so the same rows can later come from VK Nex during Sync.
 * For now the table is filled with test salesmen (see seed.ts).
 */
export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    loginName: text('login_name').notNull(),
    displayName: text('display_name').notNull(),
    passwordHash: text('password_hash').notNull(),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  },
  (t) => [index('ix_users_login').on(t.loginName)],
);

export type User = typeof users.$inferSelect;
