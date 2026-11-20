CREATE TABLE `promotion_scheme` (
	`prm_id` text PRIMARY KEY NOT NULL,
	`prm_comp_id` text NOT NULL,
	`prm_branch_id` text,
	`prm_code` text NOT NULL,
	`prm_name` text NOT NULL,
	`prm_status` text DEFAULT 'APPROVED' NOT NULL,
	`prm_apply_on` text NOT NULL,
	`prm_benefit` text NOT NULL,
	`prm_priority` integer DEFAULT 1 NOT NULL,
	`prm_stack_mode` text DEFAULT 'EXCLUSIVE' NOT NULL,
	`prm_auto_apply` integer DEFAULT true NOT NULL,
	`prm_allow_with_manual_disc` integer DEFAULT false NOT NULL,
	`prm_calc_on_amount_type` text DEFAULT 'NET_AMOUNT' NOT NULL,
	`prm_include_tax` integer DEFAULT false NOT NULL,
	`prm_bill_type` text DEFAULT 'ALL' NOT NULL,
	`prm_min_bill_amount` numeric DEFAULT '0' NOT NULL,
	`prm_min_qty` numeric DEFAULT '0' NOT NULL,
	`prm_branch_scope` text DEFAULT 'ALL' NOT NULL,
	`prm_cust_scope` text DEFAULT 'ALL' NOT NULL,
	`prm_item_scope` text DEFAULT 'ALL' NOT NULL,
	`prm_price_level_id` integer,
	`prm_max_benefit_per_bill` numeric DEFAULT '0' NOT NULL,
	`prm_coupon_batch_id` text,
	`prm_start_date` text NOT NULL,
	`prm_end_date` text NOT NULL,
	`prm_valid_from_time` text,
	`prm_valid_to_time` text,
	`prm_valid_weekdays` text,
	`prm_remarks` text,
	`prm_modified_on` text,
	`app_synced_on` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ix_prm_comp` ON `promotion_scheme` (`prm_comp_id`,`prm_priority`);--> statement-breakpoint
CREATE TABLE `promotion_scheme_branch` (
	`prb_id` text PRIMARY KEY NOT NULL,
	`prb_prm_id` text NOT NULL,
	`prb_branch_id` text NOT NULL,
	`prb_branch_name` text,
	`prb_is_exclude` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ix_prb_prm` ON `promotion_scheme_branch` (`prb_prm_id`);--> statement-breakpoint
CREATE TABLE `promotion_scheme_item` (
	`pri_id` text PRIMARY KEY NOT NULL,
	`pri_prm_id` text NOT NULL,
	`pri_kind` text NOT NULL,
	`pri_scope_id` text NOT NULL,
	`pri_scope_name` text,
	`pri_unit_id` text,
	`pri_unit_name` text,
	`pri_is_exclude` integer DEFAULT false NOT NULL,
	`pri_disc_perc` numeric DEFAULT '0' NOT NULL,
	`pri_disc_qty` numeric DEFAULT '0' NOT NULL,
	`pri_disc_amt` numeric DEFAULT '0' NOT NULL,
	`pri_min_qty` numeric DEFAULT '0' NOT NULL,
	`pri_factor` numeric DEFAULT '1' NOT NULL,
	`pri_max_benefit` numeric DEFAULT '0' NOT NULL,
	`pri_match_priority` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ix_pri_prm` ON `promotion_scheme_item` (`pri_prm_id`);--> statement-breakpoint
CREATE INDEX `ix_pri_scope` ON `promotion_scheme_item` (`pri_kind`,`pri_scope_id`);--> statement-breakpoint
CREATE TABLE `promotion_scheme_party` (
	`prp_id` text PRIMARY KEY NOT NULL,
	`prp_prm_id` text NOT NULL,
	`prp_kind` text NOT NULL,
	`prp_scope_id` text NOT NULL,
	`prp_scope_name` text,
	`prp_is_exclude` integer DEFAULT false NOT NULL,
	`prp_match_priority` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ix_prp_prm` ON `promotion_scheme_party` (`prp_prm_id`);--> statement-breakpoint
CREATE TABLE `promotion_scheme_slab` (
	`prs_id` text PRIMARY KEY NOT NULL,
	`prs_prm_id` text NOT NULL,
	`prs_slno` integer DEFAULT 1 NOT NULL,
	`prs_benefit` text NOT NULL,
	`prs_exceeds` numeric DEFAULT '0' NOT NULL,
	`prs_upto` numeric,
	`prs_each` numeric DEFAULT '1' NOT NULL,
	`prs_is_repeat` integer DEFAULT false NOT NULL,
	`prs_max_repeats` integer DEFAULT 0 NOT NULL,
	`prs_free_item_id` text,
	`prs_free_item_name` text,
	`prs_free_unit_id` text,
	`prs_free_unit_name` text,
	`prs_free_unit_factor` numeric,
	`prs_free_qty` numeric DEFAULT '0' NOT NULL,
	`prs_free_stock_check` integer DEFAULT true NOT NULL,
	`prs_disc_perc` numeric DEFAULT '0' NOT NULL,
	`prs_disc_qty` numeric DEFAULT '0' NOT NULL,
	`prs_disc_amt` numeric DEFAULT '0' NOT NULL,
	`prs_fixed_price` numeric,
	`prs_max_benefit_amt` numeric DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ix_prs_prm` ON `promotion_scheme_slab` (`prs_prm_id`);--> statement-breakpoint
ALTER TABLE `beats` ADD `city_id` text;--> statement-breakpoint
ALTER TABLE `item_master` ADD `item_category_id` text;--> statement-breakpoint
ALTER TABLE `item_master` ADD `item_section_id` text;--> statement-breakpoint
ALTER TABLE `item_units` ADD `iuc_unit_id` text;--> statement-breakpoint
ALTER TABLE `sale_order` ADD `so_sch_disc` numeric;--> statement-breakpoint
ALTER TABLE `sale_order` ADD `so_bill_sch_disc` numeric;--> statement-breakpoint
ALTER TABLE `sale_order_item` ADD `soi_is_free` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `sale_order_item` ADD `soi_free_type` text;--> statement-breakpoint
ALTER TABLE `sale_order_item` ADD `soi_scheme_id` text;--> statement-breakpoint
ALTER TABLE `sale_order_item` ADD `soi_scheme_name` text;--> statement-breakpoint
ALTER TABLE `sale_order_item` ADD `soi_sch_disc_perc` numeric;--> statement-breakpoint
ALTER TABLE `sale_order_item` ADD `soi_sch_disc_qty` numeric;--> statement-breakpoint
ALTER TABLE `sale_order_item` ADD `soi_sch_disc_amt` numeric;--> statement-breakpoint
ALTER TABLE `sale_order_item` ADD `soi_bill_sch_perc` numeric;--> statement-breakpoint
ALTER TABLE `sale_order_item` ADD `soi_bill_sch_amt` numeric;