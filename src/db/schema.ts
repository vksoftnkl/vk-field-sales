/**
 * Local SQLite schema (on the phone).
 *
 * Rules:
 *  - Money is stored as INTEGER paise (₹1 = 100). Never floats.
 *  - Percentages are INTEGER basis points (18% = 1800).
 *  - Master tables (users, customers, items, item_prices) are a read-only copy pulled from
 *    VK Nex during Sync; their primary key is the server's UUID.
 *  - Documents created on the phone (orders, later sales/receipts/returns) use a client UUIDv7
 *    as primary key. The server upserts on it, so re-sending is always safe.
 *
 * After editing this file run `npm run db:generate` to create a new migration in /drizzle.
 */
import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const timestamps = {
  createdAt: text('created_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
};

/* ───────────────────────── Device & sync state ───────────────────────── */

/** Small key/value store for device identity and settings (invoice series, salesman id…). */
export const deviceMeta = sqliteTable('device_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

/** One pull cursor per master scope ("customers", "items", …). */
export const syncCursors = sqliteTable('sync_cursors', {
  scope: text('scope').primaryKey(),
  cursor: text('cursor'),
  lastPulledAt: text('last_pulled_at'),
});

/** Upload queue. A row leaves only when the server ACKs that client_uuid. */
export const outbox = sqliteTable(
  'outbox',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    entity: text('entity', { enum: ['order', 'sale', 'receipt', 'return', 'visit', 'expense'] }).notNull(),
    clientUuid: text('client_uuid').notNull(),
    op: text('op', { enum: ['UPSERT', 'CANCEL'] }).notNull().default('UPSERT'),
    payload: text('payload').notNull(), // JSON snapshot taken at save time
    status: text('status', { enum: ['PENDING', 'SENDING', 'ACKED', 'REJECTED'] }).notNull().default('PENDING'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: text('next_attempt_at'),
    lastError: text('last_error'),
    serverId: text('server_id'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('ux_outbox_entity_uuid').on(t.entity, t.clientUuid),
    index('ix_outbox_status_next').on(t.status, t.nextAttemptAt),
  ],
);

/* ───────────────────────── Masters (pulled from VK Nex) ───────────────────────── */

/**
 * Salesmen allowed to sign in on this phone. Pulled from VK Nex during Sync so login
 * works with no server connection. password_hash is VK Nex's own `scrypt$<salt>$<hash>`;
 * the plain password never leaves the server or the phone.
 */
export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(), // server UUID
    loginName: text('login_name').notNull(),
    displayName: text('display_name').notNull(),
    passwordHash: text('password_hash').notNull(),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    serverUpdatedAt: text('server_updated_at'),
  },
  (t) => [index('ix_users_login').on(t.loginName)],
);

export const customers = sqliteTable(
  'customers',
  {
    id: text('id').primaryKey(), // server UUID
    code: text('code'),
    name: text('name').notNull(),
    mobile: text('mobile'),
    gstin: text('gstin'),
    stateCode: text('state_code'), // 2-digit GST state code, decides CGST+SGST vs IGST
    address: text('address'),
    beatId: text('beat_id'),
    priceLevel: text('price_level'),
    creditLimitPaise: integer('credit_limit_paise').notNull().default(0),
    creditBillLimit: integer('credit_bill_limit').notNull().default(0),
    outstandingPaise: integer('outstanding_paise').notNull().default(0),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    serverUpdatedAt: text('server_updated_at'),
  },
  (t) => [index('ix_customers_name').on(t.name), index('ix_customers_beat').on(t.beatId)],
);

export const items = sqliteTable(
  'items',
  {
    id: text('id').primaryKey(),
    code: text('code'),
    name: text('name').notNull(),
    barcode: text('barcode'),
    hsn: text('hsn'),
    unit: text('unit').notNull().default('NOS'),
    mrpPaise: integer('mrp_paise').notNull().default(0),
    gstRateBp: integer('gst_rate_bp').notNull().default(0),
    cessRateBp: integer('cess_rate_bp').notNull().default(0),
    taxInclusive: integer('tax_inclusive', { mode: 'boolean' }).notNull().default(false),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    serverUpdatedAt: text('server_updated_at'),
  },
  (t) => [index('ix_items_name').on(t.name), index('ix_items_barcode').on(t.barcode)],
);

/** Selling rate per item per price level (A/B/C…). */
export const itemPrices = sqliteTable(
  'item_prices',
  {
    itemId: text('item_id').notNull(),
    priceLevel: text('price_level').notNull(),
    ratePaise: integer('rate_paise').notNull(),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.priceLevel] })],
);

/* ───────────────────────── Documents (created on the phone) ───────────────────────── */

export const orders = sqliteTable(
  'orders',
  {
    clientUuid: text('client_uuid').primaryKey(),
    serverId: text('server_id'),
    orderNo: text('order_no'), // assigned by server on ACK
    customerId: text('customer_id').notNull(),
    /** users.id of the salesman signed in when the order was taken. */
    createdBy: text('created_by'),
    /** Optional second salesman working with them (multi-user mode on the login screen). */
    secondUserId: text('second_user_id'),
    orderDate: text('order_date').notNull(), // YYYY-MM-DD
    status: text('status', { enum: ['QUEUED', 'SYNCED', 'REJECTED', 'CANCELLED'] }).notNull().default('QUEUED'),
    interState: integer('inter_state', { mode: 'boolean' }).notNull().default(false),
    taxablePaise: integer('taxable_paise').notNull(),
    taxPaise: integer('tax_paise').notNull(),
    roundOffPaise: integer('round_off_paise').notNull(),
    totalPaise: integer('total_paise').notNull(),
    remarks: text('remarks'),
    ...timestamps,
  },
  (t) => [index('ix_orders_customer').on(t.customerId), index('ix_orders_date').on(t.orderDate)],
);

export const orderLines = sqliteTable(
  'order_lines',
  {
    id: text('id').primaryKey(),
    orderUuid: text('order_uuid')
      .notNull()
      .references(() => orders.clientUuid, { onDelete: 'cascade' }),
    lineNo: integer('line_no').notNull(),
    itemId: text('item_id').notNull(),
    qty: real('qty').notNull(),
    ratePaise: integer('rate_paise').notNull(),
    discBp: integer('disc_bp').notNull().default(0),
    gstRateBp: integer('gst_rate_bp').notNull(),
    cessRateBp: integer('cess_rate_bp').notNull().default(0),
    taxablePaise: integer('taxable_paise').notNull(),
    cgstPaise: integer('cgst_paise').notNull(),
    sgstPaise: integer('sgst_paise').notNull(),
    igstPaise: integer('igst_paise').notNull(),
    cessPaise: integer('cess_paise').notNull(),
    totalPaise: integer('total_paise').notNull(),
  },
  (t) => [index('ix_order_lines_order').on(t.orderUuid)],
);

export type User = typeof users.$inferSelect;
export type Customer = typeof customers.$inferSelect;
export type Item = typeof items.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type OrderLine = typeof orderLines.$inferSelect;
export type OutboxRow = typeof outbox.$inferSelect;
export type OutboxEntity = OutboxRow['entity'];
