/**
 * Local SQLite schema (on the phone).
 *
 * After editing this file run `npm run db:generate` to create a new migration in /drizzle.
 */
import { sql } from 'drizzle-orm';
import { index, integer, numeric, sqliteTable, text } from 'drizzle-orm/sqlite-core';

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

/** Companies (firms) the salesman sells for, like the Qt app's company_master. */
export const companies = sqliteTable('companies', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  /** Town shown under the name in Choose company. */
  place: text('place'),
  position: integer('position').notNull().default(0),
});

/** Beats (routes / areas) a salesman covers, like the Qt app's area_master. */
export const beats = sqliteTable('beats', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  /** Route order set in VK Nex; lists sort by it before the name. */
  position: integer('position').notNull().default(0),
});

/** Customer types (retail, wholesale, …), like the Qt app's customer_types. */
export const customerTypes = sqliteTable('customer_types', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  position: integer('position').notNull().default(0),
});

/**
 * Customers (shops): a copy of VK Nex's `sales.customers` table
 * (ERP server prisma/sales/customer.prisma), with the same column names, so Sync can move rows
 * across unchanged. Types are SQLite's: uuid and varchar → text, Decimal → numeric (kept as a
 * string, exact), Date → 'YYYY-MM-DD' text, timestamptz → ISO text, Int[] → JSON text.
 *
 * Differences from the server, on purpose:
 *  - cus_price_level_id may be empty: a shop added on the phone has none until VK Nex gives it
 *    one at upload (the server requires it).
 *  - the app_* columns at the end exist only on the phone and are never synced.
 */
export const customers = sqliteTable(
  'customers',
  {
    cusId: text('cus_id').primaryKey(),
    // 1) Identity / Code
    cusTitle: text('cus_title'),
    cusShort: text('cus_short'),
    cusCode: text('cus_code'),
    cusName: text('cus_name'),
    // 2) Address / Contact
    cusAddr1: text('cus_addr1'),
    cusAddr2: text('cus_addr2'),
    cusAddr3: text('cus_addr3'),
    cusCity: text('cus_city'),
    cusDistrict: text('cus_district'),
    cusStateName: text('cus_state_name').notNull(),
    cusCountry: text('cus_country').default('India'),
    /** GST state code, e.g. '33' (Tamil Nadu). */
    cusStateCode: text('cus_state_code').notNull(),
    cusLandmark: text('cus_landmark'),
    cusPin: text('cus_pin'),
    cusTel: text('cus_tel'),
    cusPhone1: text('cus_phone1'),
    cusPhone2: text('cus_phone2'),
    cusWhatsappNo: text('cus_whatsapp_no'),
    cusEmail: text('cus_email'),
    cusAadharNo: text('cus_aadhar_no'),
    cusContactPerson: text('cus_contact_person'),
    cusDistanceKm: integer('cus_distance_km'),
    // 3) Credit / Billing Control
    cusCreditAllowed: integer('cus_credit_allowed', { mode: 'boolean' }).notNull().default(false),
    cusCreditBillLimit: integer('cus_credit_bill_limit').notNull().default(0),
    cusCreditAmtLimit: numeric('cus_credit_amt_limit').notNull().default('0'),
    cusCreditDays: integer('cus_credit_days').notNull().default(0),
    cusDebitBalance: numeric('cus_debit_balance').notNull().default('0'),
    cusDiscPerc: numeric('cus_disc_perc').notNull().default('0'),
    cusDebitGraceDays: integer('cus_debit_grace_days').notNull().default(0),
    cusEnableSms: integer('cus_enable_sms', { mode: 'boolean' }).notNull().default(false),
    cusOverdueSms: integer('cus_overdue_sms', { mode: 'boolean' }).notNull().default(false),
    cusOverdueBilling: integer('cus_overdue_billing', { mode: 'boolean' }).notNull().default(false),
    cusAllowPromotion: integer('cus_allow_promotion', { mode: 'boolean' }).notNull().default(false),
    cusAllowLoyalty: integer('cus_allow_loyalty', { mode: 'boolean' }).notNull().default(false),
    cusAllowDiscount: integer('cus_allow_discount', { mode: 'boolean' }).notNull().default(true),
    /** Visiting order within the beat. */
    cusSortOrder: integer('cus_sort_order').notNull().default(0),
    // 4) Region / Tally Ledger style
    cusRegionName: text('cus_region_name'),
    cusRegionAddr1: text('cus_region_addr1'),
    cusRegionAddr2: text('cus_region_addr2'),
    cusRegionAddr3: text('cus_region_addr3'),
    cusRegionCity: text('cus_region_city'),
    cusRegionDistrict: text('cus_region_district'),
    cusRegionStateName: text('cus_region_state_name'),
    cusRegionCountry: text('cus_region_country').default('India'),
    // 5) Dates / Logistics / Charges
    cusBirthDate: text('cus_birth_date'),
    cusMarriageDate: text('cus_marriage_date'),
    cusTransportName: text('cus_transport_name'),
    cusFreightCharge: integer('cus_freight_charge', { mode: 'boolean' }).notNull().default(false),
    cusLoadingCharge: integer('cus_loading_charge', { mode: 'boolean' }).notNull().default(false),
    cusUnloadingCharge: integer('cus_unloading_charge', { mode: 'boolean' }).notNull().default(false),
    // 6) GST / Tax
    cusGstNo: text('cus_gst_no'),
    cusPanNo: text('cus_pan_no'),
    cusForm60On: text('cus_form60_on'),
    cusPanVerifiedOn: text('cus_pan_verified_on'),
    /** REGULAR | COMPOSITION | SEZ | OVERSEAS | UNREGISTERED (the server's codes). */
    cusGstType: text('cus_gst_type'),
    cusEcommerceGstin: text('cus_ecommerce_gstin'),
    cusTcsApplicable: integer('cus_tcs_applicable', { mode: 'boolean' }).notNull().default(false),
    cusItcollExempted: integer('cus_itcoll_exempted', { mode: 'boolean' }).notNull().default(false),
    cusItcollType: text('cus_itcoll_type'),
    // 7) Geo / Salesman / Price Level
    cusGeoLocation: text('cus_geo_location'),
    /** The server's column really is named sup_collection_days. */
    cusCollectionDays: text('sup_collection_days', { mode: 'json' }).$type<number[]>().notNull().default(sql`'[]'`),
    cusDefaultSalesman: text('cus_default_salesman'),
    cusPriceLevelId: integer('cus_price_level_id'),
    // 8) Billing Stats / Notes
    cusBilledDate: text('cus_billed_date'),
    cusBilledCount: integer('cus_billed_count').notNull().default(0),
    cusNotes: text('cus_notes'),
    // 9) Scope / Status / Sync / Audit
    cusCompanyId: text('cus_company_id'),
    cusBranchId: text('cus_branch_id'),
    /** Beat (VK Nex area_master). */
    cusAreaId: text('cus_area_id').notNull(),
    /** Customer type (VK Nex cust_groups). */
    cusGroupId: text('cus_group_id').notNull(),
    cusIsActive: integer('cus_is_active', { mode: 'boolean' }).notNull().default(true),
    cusIsDeleted: integer('cus_is_deleted', { mode: 'boolean' }).notNull().default(false),
    cusSyncDate: text('cus_sync_date'),
    cusCreatedOn: text('cus_created_on').notNull().$defaultFn(() => new Date().toISOString()),
    cusCreatedBy: text('cus_created_by'),
    cusModifiedOn: text('cus_modified_on').notNull().$defaultFn(() => new Date().toISOString()),
    cusModifiedBy: text('cus_modified_by'),
    // Phone only, never synced. What happened at the shop on this trip, set on the phone and
    // cleared by Sync (the Qt app's sale_status / order_status / receipt_status).
    appBilled: integer('app_billed', { mode: 'boolean' }).notNull().default(false),
    /** 'ordered' | 'no_order' (visited, no order taken) | null (no order activity). */
    appOrderStatus: text('app_order_status', { enum: ['ordered', 'no_order'] }),
    appReceived: integer('app_received', { mode: 'boolean' }).notNull().default(false),
    /** Added on this phone and not yet sent to VK Nex; the Upload button counts these. */
    appPendingUpload: integer('app_pending_upload', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [
    index('idx_cus_area').on(t.cusAreaId),
    index('idx_cus_phone1').on(t.cusPhone1),
    index('idx_cus_gst_no').on(t.cusGstNo),
    index('idx_cus_active').on(t.cusIsActive),
    index('idx_cus_name').on(t.cusName),
  ],
);

/** Unpaid bills per customer, like the Qt app's customer_balance. Amounts in paise. */
export const customerBills = sqliteTable(
  'customer_bills',
  {
    id: text('id').primaryKey(),
    customerId: text('customer_id').notNull(),
    billNo: text('bill_no').notNull(),
    /** YYYY-MM-DD */
    billDate: text('bill_date').notNull(),
    balancePaise: integer('balance_paise').notNull(),
  },
  (t) => [index('ix_customer_bills_customer').on(t.customerId)],
);

export type Customer = typeof customers.$inferSelect;
