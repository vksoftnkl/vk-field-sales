/**
 * Local SQLite schema (on the phone).
 *
 * After editing this file run `npm run db:generate` to create a new migration in /drizzle.
 */
import { sql } from 'drizzle-orm';
import { index, integer, numeric, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

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

/**
 * Branches of each company (VK Nex's branch_master), from Sync: with the companies in GET
 * /mobile/items/options, else GET /master-lookups/branches/by-company/:id (https only). Switch
 * company picks one, and pulls them again when a company has none; new orders are saved for it.
 */
export const branches = sqliteTable(
  'branches',
  {
    id: text('id').primaryKey(),
    companyId: text('company_id').notNull(),
    name: text('name').notNull(),
    /** VK Nex's order for the company's list. */
    position: integer('position').notNull().default(0),
    /** The company's default branch (br_is_default); Switch company starts on it (migration 0017). */
    isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [index('ix_branches_company').on(t.companyId)],
);

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
    /**
     * A customer from VK Nex edited on this phone (mobiles, Aadhaar, PAN), not yet sent. Sync
     * sends it with PUT /mobile/customers/update; the Upload button counts these too.
     */
    appPendingUpdate: integer('app_pending_update', { mode: 'boolean' }).notNull().default(false),
    /** Which of those fields the salesman changed ('cusPhone1' …): only these are sent. */
    appEditedFields: text('app_edited_fields', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    /** Why VK Nex refused the last upload ("CODE: message"); null when none. Cleared once it goes through. */
    appSyncError: text('app_sync_error'),
  },
  (t) => [
    index('idx_cus_area').on(t.cusAreaId),
    index('idx_cus_phone1').on(t.cusPhone1),
    index('idx_cus_gst_no').on(t.cusGstNo),
    index('idx_cus_active').on(t.cusIsActive),
    index('idx_cus_name').on(t.cusName),
  ],
);

/**
 * Price levels, a copy of VK Nex's inventory item_price_levels (only the columns Sync brings,
 * from GET /mobile/customers/options). VK Nex needs one on every customer.
 */
export const itemPriceLevels = sqliteTable('item_price_levels', {
  iplId: integer('ipl_id').primaryKey(),
  iplName: text('ipl_name').notNull(),
});

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

/**
 * VK Nex's financial years of the company Sync signs in to (public.fiscal_years, only the
 * columns the ledger needs). Sync brings this year and last year.
 */
export const fiscalYears = sqliteTable('fiscal_years', {
  /** fy_year_name, e.g. '2026-2027': the accYear of VK Nex's reports. */
  fyYearName: text('fy_year_name').primaryKey(),
  /** YYYY-MM-DD */
  fyBeginDate: text('fy_begin_date').notNull(),
  fyEndDate: text('fy_end_date').notNull(),
});

/**
 * One customer's ledger statement for one financial year, as VK Nex's Ledger Statement
 * (reports/ledger-statement/vouchers) gave it at the last Sync. Signed paise: debit (the
 * customer owes) is +, credit is −.
 */
export const ledgerYears = sqliteTable(
  'ledger_years',
  {
    customerId: text('customer_id').notNull(),
    accYear: text('acc_year').notNull(),
    /** The period read: the year's first day … today (this year) or the year's last day. */
    fromDate: text('from_date').notNull(),
    toDate: text('to_date').notNull(),
    /** Balance brought forward at fromDate. */
    openingPaise: integer('opening_paise').notNull(),
    /** Balance at toDate. */
    closingPaise: integer('closing_paise').notNull(),
    /** When Sync read it (ISO time). */
    syncedOn: text('synced_on').notNull(),
  },
  (t) => [primaryKey({ columns: [t.customerId, t.accYear] })],
);

/** The vouchers of a ledger year, one row each, in VK Nex's order (VoucherRow fields). */
export const ledgerRows = sqliteTable(
  'ledger_rows',
  {
    customerId: text('customer_id').notNull(),
    voucherId: text('voucher_id').notNull(),
    accYear: text('acc_year').notNull(),
    /** Position in VK Nex's order within the year (date, voucher serial, id). */
    seq: integer('seq').notNull(),
    /** YYYY-MM-DD */
    date: text('date').notNull(),
    voucherTypeName: text('voucher_type_name'),
    voucherNo: text('voucher_no'),
    /** 'NORMAL' | 'CANCELLED' | 'REVERSAL' */
    rowKind: text('row_kind').notNull(),
    particulars: text('particulars'),
    narration: text('narration'),
    /** Where the voucher came from: 'SALES' + 'SALE_BILL' is a sales bill (Recent bills). */
    srcModule: text('src_module'),
    srcDocType: text('src_doc_type'),
    billRefs: text('bill_refs', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    debitPaise: integer('debit_paise').notNull(),
    creditPaise: integer('credit_paise').notNull(),
    /** Running balance after this voucher (signed, DR +). */
    balancePaise: integer('balance_paise').notNull(),
  },
  (t) => [primaryKey({ columns: [t.customerId, t.voucherId] }), index('ix_ledger_rows_customer_year').on(t.customerId, t.accYear, t.seq)],
);

/** Item groups for the Order entry filter (VK Nex inventory.item_group_master: only what the phone needs). */
export const itemGroupMaster = sqliteTable('item_group_master', {
  itgId: text('itg_id').primaryKey(),
  itgName: text('itg_name').notNull(),
  itgSort: integer('itg_sort').notNull().default(0),
});

/** Item brands for the Order entry filter (VK Nex inventory.item_brand_master). */
export const itemBrandMaster = sqliteTable('item_brand_master', {
  brandId: text('brand_id').primaryKey(),
  brandName: text('brand_name').notNull(),
  brandSort: integer('brand_sort').notNull().default(0),
});

/** Items a salesman can order (VK Nex inventory.item_master, from GET /mobile/items/list). */
export const itemMaster = sqliteTable(
  'item_master',
  {
    itemId: text('item_id').primaryKey(),
    itemCode: text('item_code'),
    itemNameEn: text('item_name_en').notNull(),
    itemNameTa: text('item_name_ta'),
    /** null = shared by every company. */
    itemCompanyId: text('item_company_id'),
    itemGroupId: text('item_group_id').notNull(),
    itemBrandId: text('item_brand_id'),
    itemAllowLoading: integer('item_allow_loading', { mode: 'boolean' }).notNull().default(false),
    itemAllowFreight: integer('item_allow_freight', { mode: 'boolean' }).notNull().default(false),
    itemAllowPromo: integer('item_allow_promo', { mode: 'boolean' }).notNull().default(false),
    itemInclTax: integer('item_incl_tax', { mode: 'boolean' }).notNull().default(false),
    itemSortOrder: integer('item_sort_order'),
    itemHsnCode: text('item_hsn_code'),
    /** The item's default tax rate % as VK Nex resolved it ('5.000'; '0.000' when the company is not GST applicable). */
    appTaxPerc: text('app_tax_perc'),
    /** VK Nex's tax_rate_master id of that tax. */
    appTaxId: text('app_tax_id'),
  },
  (t) => [index('ix_item_group').on(t.itemGroupId), index('ix_item_brand').on(t.itemBrandId)],
);

/**
 * One orderable unit of an item in one company: VK Nex's item_unit_conversion (iuc_*) with the
 * price row (ipm_*) and the available stock (isb_*) that apply in that company. Money and
 * quantities as exact text ('168.00'), as VK Nex sends them.
 */
export const itemUnits = sqliteTable(
  'item_units',
  {
    /** The company these prices and this stock are for. */
    appCompanyId: text('app_company_id').notNull(),
    iucId: text('iuc_id').notNull(),
    iucItemId: text('iuc_item_id').notNull(),
    appUnitName: text('app_unit_name').notNull(),
    iucToBaseFactor: numeric('iuc_to_base_factor').notNull(),
    iucIsDefaultUnit: integer('iuc_is_default_unit', { mode: 'boolean' }).notNull().default(false),
    iucUomWeight: numeric('iuc_uom_weight').notNull(),
    /**
     * Whether a live VK Nex price row prices this unit today. false = every ipm_* below is null,
     * and the unit must not be offered at a price.
     */
    appPriced: integer('app_priced', { mode: 'boolean' }).notNull().default(true),
    /** Sales price per price level 1..4 (A..D); null when VK Nex has none for that level. */
    ipmSalesPriceA: numeric('ipm_sales_price_a'),
    ipmSalesPriceB: numeric('ipm_sales_price_b'),
    ipmSalesPriceC: numeric('ipm_sales_price_c'),
    ipmSalesPriceD: numeric('ipm_sales_price_d'),
    /** MRP (price level 5). */
    ipmMaxPrice: numeric('ipm_max_price'),
    /** The lowest the line may sell at (price level 6). */
    ipmMinPrice: numeric('ipm_min_price'),
    /** Cooly (loading) and freight per unit. */
    ipmLoadingCharge: numeric('ipm_loading_charge'),
    ipmFreightCharge: numeric('ipm_freight_charge'),
    /**
     * Saleable stock free to sell in the company (all branches and godowns, on hand − reserved),
     * in this unit, at the last Sync (this phone's unsent orders not taken off).
     */
    isbAvailableQty: numeric('isb_available_qty').notNull(),
  },
  (t) => [primaryKey({ columns: [t.appCompanyId, t.iucId] }), index('ix_item_units_item').on(t.appCompanyId, t.iucItemId)],
);

/**
 * Sales orders taken on the phone (a copy of VK Nex's sales.sale_order, only the columns the
 * phone fills). Sync sends each one to POST /mobile/orders/create with so_id as soClientUuid, so a
 * resend after a lost answer finds the order VK Nex already saved. VK Nex gives it its own id and
 * number (so_order_refno) and saves it as DRAFT for the office to confirm.
 */
export const saleOrder = sqliteTable(
  'sale_order',
  {
    soId: text('so_id').primaryKey(),
    soCompanyId: text('so_company_id').notNull(),
    /**
     * The branch picked in Switch company when the order was taken (migration 0016); VK Nex saves
     * the order there. Null on older orders: VK Nex then uses the phone's Device List branch.
     */
    soBranchId: text('so_branch_id'),
    soPriceLevel: integer('so_price_level'),
    /** YYYY-MM-DD and ISO time. */
    soOrderDate: text('so_order_date').notNull(),
    soOrderDatetime: text('so_order_datetime').notNull(),
    soCustId: text('so_cust_id').notNull(),
    soCustName: text('so_cust_name').notNull(),
    soHasLoad: integer('so_has_load', { mode: 'boolean' }).notNull().default(false),
    soHasFreight: integer('so_has_freight', { mode: 'boolean' }).notNull().default(false),
    /** The phone's salesman (users.id). */
    soUserId: text('so_user_id').notNull(),
    soTotItems: integer('so_tot_items').notNull(),
    /** Total quantity ("bags"). */
    soTotBags: numeric('so_tot_bags').notNull(),
    soGrossAmt: numeric('so_gross_amt').notNull(),
    soItemDisc: numeric('so_item_disc').notNull(),
    soFreightAmt: numeric('so_freight_amt').notNull(),
    soLoadAmt: numeric('so_load_amt').notNull(),
    soOrderAmt: numeric('so_order_amt').notNull(),
    soRemarks: text('so_remarks'),
    soCreatedOn: text('so_created_on').notNull(),
    /** VK Nex's order number, status and financial year, from its answer to the upload. */
    soOrderRefno: text('so_order_refno'),
    /** 'DRAFT' when VK Nex saved it; a resend reads the status VK Nex has by then. */
    soStatus: text('so_status'),
    soAccYear: text('so_acc_year'),
    // Since the 3b workflow (migration 0015). Null on orders saved before it; the upload then
    // leaves the key out and VK Nex fills its default, as it did for those orders.
    /** The phone's own reference ('3F9A-181126-03'), shown until VK Nex numbers the order. */
    soUsrRefno: text('so_usr_refno'),
    /** 'CREDIT', or 'CASH' when the customer may not buy on credit. */
    soOrderType: text('so_order_type'),
    /** YYYY-MM-DD, never before the order date. */
    soDeliveryDate: text('so_delivery_date'),
    /** 'NORMAL' | 'URGENT' (urgent needs a remark). */
    soPriority: text('so_priority'),
    /** The order date + 30 days. */
    soValidUntil: text('so_valid_until'),
    /** The customer's promotion flag when the order was taken. */
    soHasPromo: integer('so_has_promo', { mode: 'boolean' }),
    soTaxableAmt: numeric('so_taxable_amt'),
    soCgstAmt: numeric('so_cgst_amt'),
    soSgstAmt: numeric('so_sgst_amt'),
    soIgstAmt: numeric('so_igst_amt'),
    soTaxAmt: numeric('so_tax_amt'),
    soRoundOff: numeric('so_round_off'),
    /** Phone only: the visit check-in (time and GPS) the order was taken at. Not sent yet. */
    appCheckinAt: text('app_checkin_at'),
    appCheckinLat: real('app_checkin_lat'),
    appCheckinLng: real('app_checkin_lng'),
    appCheckinAccuracyM: real('app_checkin_accuracy_m'),
    /** Phone only: VK Nex's order has no vehicle column (the Qt app put it in the remarks). */
    appVehicleNo: text('app_vehicle_no'),
    /** Not yet on VK Nex. */
    appPendingUpload: integer('app_pending_upload', { mode: 'boolean' }).notNull().default(true),
    appSyncError: text('app_sync_error'),
    /** VK Nex's so_id (the phone's so_id is the client uuid it was sent with). */
    appServerSoId: text('app_server_so_id'),
    /** When VK Nex took it (ISO time). */
    appSyncedOn: text('app_synced_on'),
  },
  (t) => [index('ix_so_cust').on(t.soCustId), index('ix_so_pending').on(t.appPendingUpload)],
);

/** Lines of a phone order (VK Nex's sales.sale_order_item, the columns the phone fills). */
export const saleOrderItem = sqliteTable(
  'sale_order_item',
  {
    soiId: text('soi_id').primaryKey(),
    soiOrderId: text('soi_order_id').notNull(),
    soiLineNo: integer('soi_line_no').notNull(),
    soiItemId: text('soi_item_id').notNull(),
    soiItemUnitId: text('soi_item_unit_id').notNull(),
    soiPriceLevel: integer('soi_price_level'),
    soiIsPromo: integer('soi_is_promo', { mode: 'boolean' }).notNull().default(false),
    soiOrderQty: numeric('soi_order_qty').notNull(),
    soiNetQty: numeric('soi_net_qty').notNull(),
    soiRate: numeric('soi_rate').notNull(),
    soiMaxPrice: numeric('soi_max_price').notNull(),
    soiItemDiscPerc: numeric('soi_item_disc_perc').notNull(),
    /** Discount in rupees per unit (the Qt app's "Disc (qty)"). */
    soiItemDiscQty: numeric('soi_item_disc_qty').notNull(),
    soiItemDiscAmt: numeric('soi_item_disc_amt').notNull(),
    soiGrossAmt: numeric('soi_gross_amt').notNull(),
    soiFreightQty: numeric('soi_freight_qty').notNull(),
    soiFreightAmt: numeric('soi_freight_amt').notNull(),
    soiLoadQty: numeric('soi_load_qty').notNull(),
    soiLoadAmt: numeric('soi_load_amt').notNull(),
    /**
     * The whole line: taxable + GST + its freight and cooly (VK Nex's meaning). Orders saved before
     * migration 0015 hold gross − discount here.
     */
    soiNetAmt: numeric('soi_net_amt').notNull(),
    // Since the 3b workflow (migration 0015); null on older lines, which are then sent as before.
    soiToBaseFactor: numeric('soi_to_base_factor'),
    soiHsnCode: text('soi_hsn_code'),
    soiTaxId: text('soi_tax_id'),
    soiIsTaxIncl: integer('soi_is_tax_incl', { mode: 'boolean' }),
    soiMinPrice: numeric('soi_min_price'),
    soiTaxableAmt: numeric('soi_taxable_amt'),
    soiTaxPerc: numeric('soi_tax_perc'),
    soiTaxAmt: numeric('soi_tax_amt'),
    soiCgstPerc: numeric('soi_cgst_perc'),
    soiCgstAmt: numeric('soi_cgst_amt'),
    soiSgstPerc: numeric('soi_sgst_perc'),
    soiSgstAmt: numeric('soi_sgst_amt'),
    soiIgstPerc: numeric('soi_igst_perc'),
    soiIgstAmt: numeric('soi_igst_amt'),
    /** Phone only: names as ordered, so My orders reads the same after a Sync changes the items. */
    appItemName: text('app_item_name'),
    appItemNameTa: text('app_item_name_ta'),
    appUnitName: text('app_unit_name'),
    /** Phone only: how the discount was typed: 'perc' | 'perUnit' | 'total'. */
    appDiscMode: text('app_disc_mode'),
  },
  (t) => [index('ix_soi_order').on(t.soiOrderId), index('ix_soi_unit').on(t.soiItemUnitId)],
);

/**
 * Bills made on the phone (Sales): a copy of VK Nex's sales.sale_bill, only the columns the phone
 * fills, same names. sb_id is made on the phone and would go up as the client uuid. Every bill is
 * a credit bill (the Qt app's payment step was never finished). The number is the phone's own
 * series (see features/sales/bill-number.ts).
 *
 * VK Nex has no route for phone bills yet (its bill lines also need a godown the phone doesn't
 * have), so Sync does not send these: they stay on the phone with app_pending_upload set.
 */
export const saleBill = sqliteTable(
  'sale_bill',
  {
    sbId: text('sb_id').primaryKey(),
    sbCompanyId: text('sb_company_id').notNull(),
    /** '2026-2027'. */
    sbAccYear: text('sb_acc_year').notNull(),
    /** 'MOBILE' and the phone's device uid ('VKSMAN-…'). */
    sbDeviceType: text('sb_device_type').notNull(),
    sbDeviceId: text('sb_device_id').notNull(),
    sbDocType: text('sb_doc_type').notNull().default('TAX_INVOICE'),
    /** 'CREDIT' (VK Nex: CASH | CREDIT). */
    sbBillType: text('sb_bill_type').notNull(),
    sbPriceLevel: integer('sb_price_level').notNull(),
    /** Serial in the phone's series for this company and year, and the printed number. */
    sbBillSlno: integer('sb_bill_slno').notNull(),
    sbBillRefno: text('sb_bill_refno').notNull(),
    /** YYYY-MM-DD and ISO time. */
    sbBillDate: text('sb_bill_date').notNull(),
    sbBillDatetime: text('sb_bill_datetime').notNull(),
    sbDueDays: integer('sb_due_days'),
    sbDueDate: text('sb_due_date'),
    sbCustId: text('sb_cust_id').notNull(),
    sbCustName: text('sb_cust_name').notNull(),
    sbCustGstin: text('sb_cust_gstin'),
    sbCustStcd: text('sb_cust_stcd'),
    sbHasLoad: integer('sb_has_load', { mode: 'boolean' }).notNull().default(false),
    sbHasFreight: integer('sb_has_freight', { mode: 'boolean' }).notNull().default(false),
    /** The phone's salesman (users.id). */
    sbUserId: text('sb_user_id').notNull(),
    sbTotItems: integer('sb_tot_items').notNull(),
    sbTotBags: numeric('sb_tot_bags').notNull(),
    sbGrossAmt: numeric('sb_gross_amt').notNull(),
    sbItemDisc: numeric('sb_item_disc').notNull(),
    /** The bill discount (before tax). */
    sbCashDisc: numeric('sb_cash_disc').notNull(),
    sbTaxableAmt: numeric('sb_taxable_amt').notNull(),
    sbCgstAmt: numeric('sb_cgst_amt').notNull(),
    sbSgstAmt: numeric('sb_sgst_amt').notNull(),
    sbIgstAmt: numeric('sb_igst_amt').notNull(),
    sbTaxAmt: numeric('sb_tax_amt').notNull(),
    sbRoundOff: numeric('sb_round_off').notNull(),
    sbBillAmt: numeric('sb_bill_amt').notNull(),
    sbCreditAmt: numeric('sb_credit_amt').notNull(),
    sbBalanceAmt: numeric('sb_balance_amt').notNull(),
    sbPayStatus: text('sb_pay_status').notNull().default('UNPAID'),
    sbRemarks: text('sb_remarks'),
    sbCreatedOn: text('sb_created_on').notNull(),
    /** Not yet on VK Nex. */
    appPendingUpload: integer('app_pending_upload', { mode: 'boolean' }).notNull().default(true),
    appSyncError: text('app_sync_error'),
  },
  (t) => [
    index('ix_sb_cust').on(t.sbCustId),
    index('ix_sb_pending').on(t.appPendingUpload),
    index('ix_sb_series').on(t.sbCompanyId, t.sbDeviceId, t.sbAccYear, t.sbBillSlno),
  ],
);

/** Lines of a phone bill (VK Nex's sales.sale_bill_item, the columns the phone fills). */
export const saleBillItem = sqliteTable(
  'sale_bill_item',
  {
    sbiId: text('sbi_id').primaryKey(),
    sbiBillId: text('sbi_bill_id').notNull(),
    sbiLineNo: integer('sbi_line_no').notNull(),
    sbiItemId: text('sbi_item_id').notNull(),
    sbiItemUnitId: text('sbi_item_unit_id').notNull(),
    /** Base units in one of this unit: this phone's bills take stock off the item in base units. */
    sbiToBaseFactor: numeric('sbi_to_base_factor').notNull(),
    sbiHsnCode: text('sbi_hsn_code'),
    sbiPriceLevel: integer('sbi_price_level'),
    sbiIsTaxIncl: integer('sbi_is_tax_incl', { mode: 'boolean' }).notNull().default(false),
    sbiIsPromo: integer('sbi_is_promo', { mode: 'boolean' }).notNull().default(false),
    sbiBillQty: numeric('sbi_bill_qty').notNull(),
    sbiNetQty: numeric('sbi_net_qty').notNull(),
    /** Stock left in the unit when the bill was made. */
    sbiAvailableStock: numeric('sbi_available_stock').notNull(),
    sbiRate: numeric('sbi_rate').notNull(),
    sbiRatePreTax: numeric('sbi_rate_pre_tax').notNull(),
    sbiMaxPrice: numeric('sbi_max_price'),
    sbiMinPrice: numeric('sbi_min_price'),
    sbiItemDiscPerc: numeric('sbi_item_disc_perc').notNull(),
    /** Discount in rupees per unit (the Qt app's "Disc (qty)"). */
    sbiItemDiscQty: numeric('sbi_item_disc_qty').notNull(),
    sbiItemDiscAmt: numeric('sbi_item_disc_amt').notNull(),
    /** This line's share of the bill discount. */
    sbiCashDiscPerc: numeric('sbi_cash_disc_perc').notNull(),
    sbiCashDiscAmt: numeric('sbi_cash_disc_amt').notNull(),
    sbiGrossAmt: numeric('sbi_gross_amt').notNull(),
    sbiTaxId: text('sbi_tax_id'),
    sbiTaxableAmt: numeric('sbi_taxable_amt').notNull(),
    sbiTaxPerc: numeric('sbi_tax_perc').notNull(),
    sbiTaxAmt: numeric('sbi_tax_amt').notNull(),
    sbiCgstPerc: numeric('sbi_cgst_perc').notNull(),
    sbiCgstAmt: numeric('sbi_cgst_amt').notNull(),
    sbiSgstPerc: numeric('sbi_sgst_perc').notNull(),
    sbiSgstAmt: numeric('sbi_sgst_amt').notNull(),
    sbiIgstPerc: numeric('sbi_igst_perc').notNull(),
    sbiIgstAmt: numeric('sbi_igst_amt').notNull(),
    /** Taxable + GST. */
    sbiNetAmt: numeric('sbi_net_amt').notNull(),
  },
  (t) => [index('ix_sbi_bill').on(t.sbiBillId), index('ix_sbi_item').on(t.sbiItemId)],
);

/**
 * Sales returns made on the phone (credit notes): a copy of VK Nex's sales.sale_return, only the
 * columns the phone fills, same names. A phone return is a FREE return (sr_is_against_bill false:
 * not tied to a bill line), priced at today's price, settled ADJUST (VK Nex sets it against the
 * shop's open bills). The number is the phone's own series, 'R' + the bill series code.
 *
 * VK Nex has no route for phone returns yet (its lines also need a godown the phone doesn't
 * have), so Sync does not send these: they stay on the phone with app_pending_upload set.
 */
export const saleReturn = sqliteTable(
  'sale_return',
  {
    srId: text('sr_id').primaryKey(),
    srCompanyId: text('sr_company_id').notNull(),
    /** '2026-2027'. */
    srAccYear: text('sr_acc_year').notNull(),
    /** 'MOBILE' and the phone's device uid ('VKSMAN-…'). */
    srDeviceType: text('sr_device_type').notNull(),
    srDeviceId: text('sr_device_id').notNull(),
    srDocType: text('sr_doc_type').notNull().default('CREDIT_NOTE'),
    /** Serial in the phone's return series for this company and year, and the printed number. */
    srReturnSlno: integer('sr_return_slno').notNull(),
    srReturnRefno: text('sr_return_refno').notNull(),
    /** YYYY-MM-DD and ISO time. */
    srReturnDate: text('sr_return_date').notNull(),
    srReturnDatetime: text('sr_return_datetime').notNull(),
    srIsAgainstBill: integer('sr_is_against_bill', { mode: 'boolean' }).notNull().default(false),
    srCustId: text('sr_cust_id').notNull(),
    srCustName: text('sr_cust_name').notNull(),
    srCustGstin: text('sr_cust_gstin'),
    srCustStcd: text('sr_cust_stcd'),
    srPriceLevel: integer('sr_price_level'),
    /** The phone's salesman (users.id). */
    srUserId: text('sr_user_id').notNull(),
    srTotItems: integer('sr_tot_items').notNull(),
    srTotBags: numeric('sr_tot_bags').notNull(),
    srGrossAmt: numeric('sr_gross_amt').notNull(),
    srTaxableAmt: numeric('sr_taxable_amt').notNull(),
    srCgstAmt: numeric('sr_cgst_amt').notNull(),
    srSgstAmt: numeric('sr_sgst_amt').notNull(),
    srIgstAmt: numeric('sr_igst_amt').notNull(),
    srTaxAmt: numeric('sr_tax_amt').notNull(),
    srRoundOff: numeric('sr_round_off').notNull(),
    srReturnAmt: numeric('sr_return_amt').notNull(),
    /** VK Nex: CASH | ADJUST | ADVANCE. */
    srSettleMode: text('sr_settle_mode').notNull().default('ADJUST'),
    srCreatedOn: text('sr_created_on').notNull(),
    /** Not yet on VK Nex. */
    appPendingUpload: integer('app_pending_upload', { mode: 'boolean' }).notNull().default(true),
    appSyncError: text('app_sync_error'),
  },
  (t) => [
    index('ix_sr_cust').on(t.srCustId),
    index('ix_sr_pending').on(t.appPendingUpload),
    index('ix_sr_series').on(t.srCompanyId, t.srDeviceId, t.srAccYear, t.srReturnSlno),
  ],
);

/** Lines of a phone return (VK Nex's sales.sale_return_item, the columns the phone fills). */
export const saleReturnItem = sqliteTable(
  'sale_return_item',
  {
    sriId: text('sri_id').primaryKey(),
    sriReturnId: text('sri_return_id').notNull(),
    sriLineNo: integer('sri_line_no').notNull(),
    sriItemId: text('sri_item_id').notNull(),
    sriItemUnitId: text('sri_item_unit_id').notNull(),
    sriToBaseFactor: numeric('sri_to_base_factor').notNull(),
    sriHsnCode: text('sri_hsn_code'),
    sriTaxId: text('sri_tax_id'),
    sriBatchNo: text('sri_batch_no'),
    /** YYYY-MM-DD. */
    sriBatchDate: text('sri_batch_date'),
    sriExpiryDate: text('sri_expiry_date'),
    /** DAMAGED | EXPIRED (VK Nex also has RESTOCK | SCRAP). */
    sriCondition: text('sri_condition').notNull(),
    /** The stock bucket it goes back to: the same word as the condition, so never saleable stock. */
    sriBucket: text('sri_bucket').notNull(),
    sriReturnQty: numeric('sri_return_qty').notNull(),
    sriNetQty: numeric('sri_net_qty').notNull(),
    sriRate: numeric('sri_rate').notNull(),
    sriRatePreTax: numeric('sri_rate_pre_tax').notNull(),
    sriMaxPrice: numeric('sri_max_price'),
    sriPriceLevel: integer('sri_price_level').notNull(),
    sriIsTaxIncl: integer('sri_is_tax_incl', { mode: 'boolean' }).notNull().default(false),
    /** TODAY_PRICE: not against a bill, so the price is today's (VK Nex: BILL | LAST_SALE | TODAY_PRICE). */
    sriRateSource: text('sri_rate_source').notNull().default('TODAY_PRICE'),
    sriGrossAmt: numeric('sri_gross_amt').notNull(),
    sriTaxableAmt: numeric('sri_taxable_amt').notNull(),
    sriTaxPerc: numeric('sri_tax_perc').notNull(),
    sriTaxAmt: numeric('sri_tax_amt').notNull(),
    sriCgstPerc: numeric('sri_cgst_perc').notNull(),
    sriCgstAmt: numeric('sri_cgst_amt').notNull(),
    sriSgstPerc: numeric('sri_sgst_perc').notNull(),
    sriSgstAmt: numeric('sri_sgst_amt').notNull(),
    sriIgstPerc: numeric('sri_igst_perc').notNull(),
    sriIgstAmt: numeric('sri_igst_amt').notNull(),
    /** Taxable + GST. */
    sriNetAmt: numeric('sri_net_amt').notNull(),
    /** The salesman's notes on the line (VK Nex: 250 long). */
    sriRemarks: text('sri_remarks'),
  },
  (t) => [index('ix_sri_return').on(t.sriReturnId)],
);

/**
 * A customer's open bills in one company, as VK Nex gave them at the last Sync (its
 * /receipts/open-items: what is still pending on each bill, in its own order, due date first).
 * Replaced per company on every Sync. Amounts in paise.
 */
export const openBills = sqliteTable(
  'open_bills',
  {
    billId: text('bill_id').notNull(),
    /** The year the bill was raised in ('2026-2027'): with billId it names the bill. */
    billAccYear: text('bill_acc_year').notNull(),
    companyId: text('company_id').notNull(),
    /** The customer (VK Nex's party id = cus_id). */
    partyId: text('party_id').notNull(),
    /** Position in VK Nex's order: the order it fills bills in when it posts a receipt. */
    seq: integer('seq').notNull(),
    /** SALES | OPENING | INTEREST | JOURNAL | PURCHASE_RETURN. */
    billType: text('bill_type'),
    docRefno: text('doc_refno').notNull(),
    /** YYYY-MM-DD */
    docDate: text('doc_date').notNull(),
    dueDate: text('due_date'),
    billAmountPaise: integer('bill_amount_paise').notNull(),
    pendingPaise: integer('pending_paise').notNull(),
    /** When Sync read it (ISO time). */
    syncedOn: text('synced_on').notNull(),
  },
  (t) => [primaryKey({ columns: [t.billId, t.billAccYear] }), index('ix_open_bills_party').on(t.partyId, t.companyId, t.seq)],
);

/**
 * The ways a company takes money (VK Nex's accounts.acc_tender_master: Cash, UPI, the bank
 * account for transfers, Cheques in hand …), as GET /mobile/receipts/options gave them at Sync.
 */
export const tenders = sqliteTable(
  'tenders',
  {
    companyId: text('company_id').notNull(),
    tndId: text('tnd_id').notNull(),
    /** VK Nex's tender type: 1 cash, 2 card, 3 UPI, 4 wallet, 5 cheque, 6 bank transfer. */
    tndTypeId: integer('tnd_type_id').notNull(),
    tndTypeCode: text('tnd_type_code'),
    tndName: text('tnd_name').notNull(),
    /** A reference must be typed (UTR, card last 4 …). */
    appNeedsRef: integer('app_needs_ref', { mode: 'boolean' }).notNull().default(false),
    /** What to call that reference ('UTR No', 'Cheque No'). */
    appRefLabel: text('app_ref_label'),
    /** The office's default tender: a new receipt starts with it. */
    appIsDefault: integer('app_is_default', { mode: 'boolean' }).notNull().default(false),
    /** Surcharge the customer pays on top: % of the amount, plus a flat amount (exact text). */
    tndSurchargePerc: numeric('tnd_surcharge_perc').notNull().default('0'),
    tndSurchargeAmount: numeric('tnd_surcharge_amount').notNull().default('0'),
    position: integer('position').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.companyId, t.tndId] })],
);

/**
 * Receipts taken on the phone: a copy of VK Nex's accounts.acc_voucher_header, only the columns
 * the phone fills. Sync sends each one to POST /mobile/receipts/create with avh_client_uuid, so a
 * resend after a lost answer gets the receipt VK Nex already has. VK Nex posts it at once and
 * fills the customer's open bills oldest first; what is left stays on account.
 */
export const receipts = sqliteTable(
  'receipts',
  {
    avhClientUuid: text('avh_client_uuid').primaryKey(),
    avhCompanyId: text('avh_company_id').notNull(),
    avhPartyId: text('avh_party_id').notNull(),
    appPartyName: text('app_party_name').notNull(),
    /** YYYY-MM-DD */
    avhVoucherDate: text('avh_voucher_date').notNull(),
    /** The phone's own receipt number ('R3F9A/2627/00001'); VK Nex keeps it as its user ref. */
    avhUsrRefno: text('avh_usr_refno').notNull(),
    /** Serial in that series, per company and financial year. */
    appSlno: integer('app_slno').notNull(),
    appAccYear: text('app_acc_year').notNull(),
    avhDeviceId: text('avh_device_id').notNull(),
    avhDocAmount: numeric('avh_doc_amount').notNull(),
    avhRemarks: text('avh_remarks'),
    /** The phone's salesman (users.id). */
    appUserId: text('app_user_id').notNull(),
    avhCreatedOn: text('avh_created_on').notNull(),
    /** Not yet on VK Nex. */
    appPendingUpload: integer('app_pending_upload', { mode: 'boolean' }).notNull().default(true),
    appSyncError: text('app_sync_error'),
    /** VK Nex's voucher id, number and status from its answer. */
    avhVoucherId: text('avh_voucher_id'),
    avhVoucherRefno: text('avh_voucher_refno'),
    avhVoucherStatus: text('avh_voucher_status'),
    appSyncedOn: text('app_synced_on'),
  },
  (t) => [
    index('ix_rct_party').on(t.avhPartyId, t.avhCompanyId),
    index('ix_rct_pending').on(t.appPendingUpload),
    index('ix_rct_series').on(t.avhCompanyId, t.avhDeviceId, t.appAccYear, t.appSlno),
  ],
);

/** How a phone receipt was paid, one line per tender (VK Nex's accounts.acc_tender_detail, the columns the phone fills). */
export const receiptTenders = sqliteTable(
  'receipt_tenders',
  {
    tdId: text('td_id').primaryKey(),
    /** The receipt (receipts.avh_client_uuid). */
    tdSrcDocId: text('td_src_doc_id').notNull(),
    tdRowNo: integer('td_row_no').notNull(),
    tdTenderId: text('td_tender_id').notNull(),
    tdTenderTypeId: integer('td_tender_type_id').notNull(),
    appTenderName: text('app_tender_name').notNull(),
    /** What the line pays, surcharge included (as VK Nex takes it). */
    tdAmount: numeric('td_amount').notNull(),
    /** The tender's surcharge inside tdAmount (0 for most). */
    tdSurchargeAmt: numeric('td_surcharge_amt').notNull().default('0'),
    /** UTR, cheque number, card last 4 … */
    tdRefNo: text('td_ref_no'),
    /** The customer's bank (cheques). */
    tdBankName: text('td_bank_name'),
    /** Cheque date (YYYY-MM-DD); after the receipt date it is post-dated. */
    tdInstrumentDate: text('td_instrument_date'),
  },
  (t) => [index('ix_td_receipt').on(t.tdSrcDocId)],
);

/**
 * Shop visits without an order (Check in). Sync sends each one to POST /mobile/visits/create
 * (VK Nex's sales.customer_visit) with id as cvClientUuid, so a resend is never saved twice.
 */
export const visits = sqliteTable(
  'visits',
  {
    id: text('id').primaryKey(),
    /** The company the salesman worked for at the check-in (Choose company); null on rows made before it was kept. */
    companyId: text('company_id'),
    customerId: text('customer_id').notNull(),
    userId: text('user_id').notNull(),
    /** 'shopClosed' | 'noOrder' | 'shopBusy' | 'ownerAway' | 'paymentPending' | 'nextVisit' | null */
    reason: text('reason'),
    remarks: text('remarks'),
    latitude: real('latitude'),
    longitude: real('longitude'),
    /** Metres. */
    accuracyM: real('accuracy_m'),
    /** When the location was read (ISO); null when none could be read. */
    locatedAt: text('located_at'),
    visitedAt: text('visited_at').notNull(),
    appPendingUpload: integer('app_pending_upload', { mode: 'boolean' }).notNull().default(true),
    /** Why VK Nex refused it last time (shown on the Sync page); it stays waiting. */
    appSyncError: text('app_sync_error'),
    /** VK Nex's cv_id, and when it took the visit. */
    appServerId: text('app_server_id'),
    appSyncedOn: text('app_synced_on'),
  },
  (t) => [index('ix_visits_customer').on(t.customerId), index('ix_visits_pending').on(t.appPendingUpload)],
);

export type Customer = typeof customers.$inferSelect;
