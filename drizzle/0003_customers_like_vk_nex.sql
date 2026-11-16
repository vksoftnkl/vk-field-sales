-- Customers now copy VK Nex's sales.customers table (cus_* columns). SQLite can't rename this
-- many columns in place, so the table is rebuilt and every existing row is copied across:
-- test shops and shops already added on the phone keep their ids, bills and trip status.
-- Old rows get state Tamil Nadu (33), which the server requires.
CREATE TABLE `__new_customers` (
	`cus_id` text PRIMARY KEY NOT NULL,
	`cus_title` text,
	`cus_short` text,
	`cus_code` text,
	`cus_name` text,
	`cus_addr1` text,
	`cus_addr2` text,
	`cus_addr3` text,
	`cus_city` text,
	`cus_district` text,
	`cus_state_name` text NOT NULL,
	`cus_country` text DEFAULT 'India',
	`cus_state_code` text NOT NULL,
	`cus_landmark` text,
	`cus_pin` text,
	`cus_tel` text,
	`cus_phone1` text,
	`cus_phone2` text,
	`cus_whatsapp_no` text,
	`cus_email` text,
	`cus_aadhar_no` text,
	`cus_contact_person` text,
	`cus_distance_km` integer,
	`cus_credit_allowed` integer DEFAULT false NOT NULL,
	`cus_credit_bill_limit` integer DEFAULT 0 NOT NULL,
	`cus_credit_amt_limit` numeric DEFAULT '0' NOT NULL,
	`cus_credit_days` integer DEFAULT 0 NOT NULL,
	`cus_debit_balance` numeric DEFAULT '0' NOT NULL,
	`cus_disc_perc` numeric DEFAULT '0' NOT NULL,
	`cus_debit_grace_days` integer DEFAULT 0 NOT NULL,
	`cus_enable_sms` integer DEFAULT false NOT NULL,
	`cus_overdue_sms` integer DEFAULT false NOT NULL,
	`cus_overdue_billing` integer DEFAULT false NOT NULL,
	`cus_allow_promotion` integer DEFAULT false NOT NULL,
	`cus_allow_loyalty` integer DEFAULT false NOT NULL,
	`cus_allow_discount` integer DEFAULT true NOT NULL,
	`cus_sort_order` integer DEFAULT 0 NOT NULL,
	`cus_region_name` text,
	`cus_region_addr1` text,
	`cus_region_addr2` text,
	`cus_region_addr3` text,
	`cus_region_city` text,
	`cus_region_district` text,
	`cus_region_state_name` text,
	`cus_region_country` text DEFAULT 'India',
	`cus_birth_date` text,
	`cus_marriage_date` text,
	`cus_transport_name` text,
	`cus_freight_charge` integer DEFAULT false NOT NULL,
	`cus_loading_charge` integer DEFAULT false NOT NULL,
	`cus_unloading_charge` integer DEFAULT false NOT NULL,
	`cus_gst_no` text,
	`cus_pan_no` text,
	`cus_form60_on` text,
	`cus_pan_verified_on` text,
	`cus_gst_type` text,
	`cus_ecommerce_gstin` text,
	`cus_tcs_applicable` integer DEFAULT false NOT NULL,
	`cus_itcoll_exempted` integer DEFAULT false NOT NULL,
	`cus_itcoll_type` text,
	`cus_geo_location` text,
	`sup_collection_days` text DEFAULT '[]' NOT NULL,
	`cus_default_salesman` text,
	`cus_price_level_id` integer,
	`cus_billed_date` text,
	`cus_billed_count` integer DEFAULT 0 NOT NULL,
	`cus_notes` text,
	`cus_company_id` text,
	`cus_branch_id` text,
	`cus_area_id` text NOT NULL,
	`cus_group_id` text NOT NULL,
	`cus_is_active` integer DEFAULT true NOT NULL,
	`cus_is_deleted` integer DEFAULT false NOT NULL,
	`cus_sync_date` text,
	`cus_created_on` text NOT NULL,
	`cus_created_by` text,
	`cus_modified_on` text NOT NULL,
	`cus_modified_by` text,
	`app_billed` integer DEFAULT false NOT NULL,
	`app_order_status` text,
	`app_received` integer DEFAULT false NOT NULL,
	`app_pending_upload` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_customers` (`cus_id`, `cus_code`, `cus_name`, `cus_addr1`, `cus_city`, `cus_district`, `cus_state_name`, `cus_state_code`, `cus_pin`, `cus_phone1`, `cus_phone2`, `cus_aadhar_no`, `cus_sort_order`, `cus_gst_no`, `cus_gst_type`, `cus_area_id`, `cus_group_id`, `cus_is_active`, `cus_created_on`, `cus_created_by`, `cus_modified_on`, `app_billed`, `app_order_status`, `app_received`, `app_pending_upload`)
SELECT id, code, name, address, place, district, 'Tamil Nadu', '33', pincode, mobile, mobile2, aadhaar, position, gstin, upper(gst_type), coalesce(beat_id, ''), coalesce(type_id, ''), is_active, coalesce(created_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), created_by, coalesce(created_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), billed, order_status, received, pending_upload FROM `customers`;
--> statement-breakpoint
DROP TABLE `customers`;
--> statement-breakpoint
ALTER TABLE `__new_customers` RENAME TO `customers`;
--> statement-breakpoint
CREATE INDEX `idx_cus_area` ON `customers` (`cus_area_id`);
--> statement-breakpoint
CREATE INDEX `idx_cus_phone1` ON `customers` (`cus_phone1`);
--> statement-breakpoint
CREATE INDEX `idx_cus_gst_no` ON `customers` (`cus_gst_no`);
--> statement-breakpoint
CREATE INDEX `idx_cus_active` ON `customers` (`cus_is_active`);
--> statement-breakpoint
CREATE INDEX `idx_cus_name` ON `customers` (`cus_name`);
