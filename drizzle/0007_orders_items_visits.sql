CREATE TABLE `item_brand_master` (
	`brand_id` text PRIMARY KEY NOT NULL,
	`brand_name` text NOT NULL,
	`brand_sort` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `item_group_master` (
	`itg_id` text PRIMARY KEY NOT NULL,
	`itg_name` text NOT NULL,
	`itg_sort` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `item_master` (
	`item_id` text PRIMARY KEY NOT NULL,
	`item_code` text,
	`item_name_en` text NOT NULL,
	`item_name_ta` text,
	`item_company_id` text,
	`item_group_id` text NOT NULL,
	`item_brand_id` text,
	`item_allow_loading` integer DEFAULT false NOT NULL,
	`item_allow_freight` integer DEFAULT false NOT NULL,
	`item_allow_promo` integer DEFAULT false NOT NULL,
	`item_incl_tax` integer DEFAULT false NOT NULL,
	`item_sort_order` integer,
	`app_tax_perc` text
);
--> statement-breakpoint
CREATE INDEX `ix_item_group` ON `item_master` (`item_group_id`);--> statement-breakpoint
CREATE INDEX `ix_item_brand` ON `item_master` (`item_brand_id`);--> statement-breakpoint
CREATE TABLE `item_units` (
	`app_company_id` text NOT NULL,
	`iuc_id` text NOT NULL,
	`iuc_item_id` text NOT NULL,
	`app_unit_name` text NOT NULL,
	`iuc_to_base_factor` numeric NOT NULL,
	`iuc_is_default_unit` integer DEFAULT false NOT NULL,
	`iuc_uom_weight` numeric NOT NULL,
	`ipm_sales_price_a` numeric,
	`ipm_sales_price_b` numeric,
	`ipm_sales_price_c` numeric,
	`ipm_sales_price_d` numeric,
	`ipm_max_price` numeric NOT NULL,
	`ipm_min_price` numeric NOT NULL,
	`ipm_loading_charge` numeric NOT NULL,
	`ipm_freight_charge` numeric NOT NULL,
	`isb_available_qty` numeric NOT NULL,
	PRIMARY KEY(`app_company_id`, `iuc_id`)
);
--> statement-breakpoint
CREATE INDEX `ix_item_units_item` ON `item_units` (`app_company_id`,`iuc_item_id`);--> statement-breakpoint
CREATE TABLE `sale_order` (
	`so_id` text PRIMARY KEY NOT NULL,
	`so_company_id` text NOT NULL,
	`so_price_level` integer,
	`so_order_date` text NOT NULL,
	`so_order_datetime` text NOT NULL,
	`so_cust_id` text NOT NULL,
	`so_cust_name` text NOT NULL,
	`so_has_load` integer DEFAULT false NOT NULL,
	`so_has_freight` integer DEFAULT false NOT NULL,
	`so_user_id` text NOT NULL,
	`so_tot_items` integer NOT NULL,
	`so_tot_bags` numeric NOT NULL,
	`so_gross_amt` numeric NOT NULL,
	`so_item_disc` numeric NOT NULL,
	`so_freight_amt` numeric NOT NULL,
	`so_load_amt` numeric NOT NULL,
	`so_order_amt` numeric NOT NULL,
	`so_remarks` text,
	`so_created_on` text NOT NULL,
	`app_vehicle_no` text,
	`app_pending_upload` integer DEFAULT true NOT NULL,
	`app_sync_error` text
);
--> statement-breakpoint
CREATE INDEX `ix_so_cust` ON `sale_order` (`so_cust_id`);--> statement-breakpoint
CREATE INDEX `ix_so_pending` ON `sale_order` (`app_pending_upload`);--> statement-breakpoint
CREATE TABLE `sale_order_item` (
	`soi_id` text PRIMARY KEY NOT NULL,
	`soi_order_id` text NOT NULL,
	`soi_line_no` integer NOT NULL,
	`soi_item_id` text NOT NULL,
	`soi_item_unit_id` text NOT NULL,
	`soi_price_level` integer,
	`soi_is_promo` integer DEFAULT false NOT NULL,
	`soi_order_qty` numeric NOT NULL,
	`soi_net_qty` numeric NOT NULL,
	`soi_rate` numeric NOT NULL,
	`soi_max_price` numeric NOT NULL,
	`soi_item_disc_perc` numeric NOT NULL,
	`soi_item_disc_qty` numeric NOT NULL,
	`soi_item_disc_amt` numeric NOT NULL,
	`soi_gross_amt` numeric NOT NULL,
	`soi_freight_qty` numeric NOT NULL,
	`soi_freight_amt` numeric NOT NULL,
	`soi_load_qty` numeric NOT NULL,
	`soi_load_amt` numeric NOT NULL,
	`soi_net_amt` numeric NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ix_soi_order` ON `sale_order_item` (`soi_order_id`);--> statement-breakpoint
CREATE INDEX `ix_soi_unit` ON `sale_order_item` (`soi_item_unit_id`);--> statement-breakpoint
CREATE TABLE `visits` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`user_id` text NOT NULL,
	`reason` text,
	`remarks` text,
	`latitude` real,
	`longitude` real,
	`accuracy_m` real,
	`located_at` text,
	`visited_at` text NOT NULL,
	`app_pending_upload` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ix_visits_customer` ON `visits` (`customer_id`);