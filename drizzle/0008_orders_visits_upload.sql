PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_item_units` (
	`app_company_id` text NOT NULL,
	`iuc_id` text NOT NULL,
	`iuc_item_id` text NOT NULL,
	`app_unit_name` text NOT NULL,
	`iuc_to_base_factor` numeric NOT NULL,
	`iuc_is_default_unit` integer DEFAULT false NOT NULL,
	`iuc_uom_weight` numeric NOT NULL,
	`app_priced` integer DEFAULT true NOT NULL,
	`ipm_sales_price_a` numeric,
	`ipm_sales_price_b` numeric,
	`ipm_sales_price_c` numeric,
	`ipm_sales_price_d` numeric,
	`ipm_max_price` numeric,
	`ipm_min_price` numeric,
	`ipm_loading_charge` numeric,
	`ipm_freight_charge` numeric,
	`isb_available_qty` numeric NOT NULL,
	PRIMARY KEY(`app_company_id`, `iuc_id`)
);
--> statement-breakpoint
INSERT INTO `__new_item_units`("app_company_id", "iuc_id", "iuc_item_id", "app_unit_name", "iuc_to_base_factor", "iuc_is_default_unit", "iuc_uom_weight", "ipm_sales_price_a", "ipm_sales_price_b", "ipm_sales_price_c", "ipm_sales_price_d", "ipm_max_price", "ipm_min_price", "ipm_loading_charge", "ipm_freight_charge", "isb_available_qty") SELECT "app_company_id", "iuc_id", "iuc_item_id", "app_unit_name", "iuc_to_base_factor", "iuc_is_default_unit", "iuc_uom_weight", "ipm_sales_price_a", "ipm_sales_price_b", "ipm_sales_price_c", "ipm_sales_price_d", "ipm_max_price", "ipm_min_price", "ipm_loading_charge", "ipm_freight_charge", "isb_available_qty" FROM `item_units`;--> statement-breakpoint
DROP TABLE `item_units`;--> statement-breakpoint
ALTER TABLE `__new_item_units` RENAME TO `item_units`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `ix_item_units_item` ON `item_units` (`app_company_id`,`iuc_item_id`);--> statement-breakpoint
ALTER TABLE `item_master` ADD `item_hsn_code` text;--> statement-breakpoint
ALTER TABLE `item_master` ADD `app_tax_id` text;--> statement-breakpoint
ALTER TABLE `sale_order` ADD `so_order_refno` text;--> statement-breakpoint
ALTER TABLE `sale_order` ADD `so_status` text;--> statement-breakpoint
ALTER TABLE `sale_order` ADD `so_acc_year` text;--> statement-breakpoint
ALTER TABLE `sale_order` ADD `app_server_so_id` text;--> statement-breakpoint
ALTER TABLE `sale_order` ADD `app_synced_on` text;--> statement-breakpoint
ALTER TABLE `visits` ADD `company_id` text;--> statement-breakpoint
ALTER TABLE `visits` ADD `app_sync_error` text;--> statement-breakpoint
ALTER TABLE `visits` ADD `app_server_id` text;--> statement-breakpoint
ALTER TABLE `visits` ADD `app_synced_on` text;--> statement-breakpoint
CREATE INDEX `ix_visits_pending` ON `visits` (`app_pending_upload`);