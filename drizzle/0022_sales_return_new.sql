CREATE TABLE `return_bill_lines` (
	`bill_item_id` text NOT NULL,
	`acc_year` text NOT NULL,
	`sb_id` text NOT NULL,
	`sb_acc_year` text NOT NULL,
	`company_id` text NOT NULL,
	`line_no` integer NOT NULL,
	`item_id` text NOT NULL,
	`item_name` text,
	`item_unit_id` text NOT NULL,
	`unit_name` text,
	`to_base_factor` numeric NOT NULL,
	`bill_qty` numeric NOT NULL,
	`bill_qty_base` numeric NOT NULL,
	`returned_qty_base` numeric NOT NULL,
	`qty_left_base` numeric NOT NULL,
	`on_other_drafts_base` numeric DEFAULT '0' NOT NULL,
	`rate_pre_tax_base` numeric NOT NULL,
	`rate` numeric,
	`tax_perc` numeric DEFAULT '0' NOT NULL,
	`cgst_perc` numeric DEFAULT '0' NOT NULL,
	`sgst_perc` numeric DEFAULT '0' NOT NULL,
	`igst_perc` numeric DEFAULT '0' NOT NULL,
	`lot_id` text,
	`batch_no` text,
	`expiry_date` text,
	`godown_id` text,
	`is_free` integer DEFAULT false NOT NULL,
	`allow_return` integer DEFAULT true NOT NULL,
	PRIMARY KEY(`bill_item_id`, `acc_year`)
);
--> statement-breakpoint
CREATE INDEX `ix_return_bill_lines_bill` ON `return_bill_lines` (`sb_id`,`sb_acc_year`);--> statement-breakpoint
CREATE INDEX `ix_return_bill_lines_item` ON `return_bill_lines` (`company_id`,`item_id`);--> statement-breakpoint
CREATE TABLE `return_bills` (
	`sb_id` text NOT NULL,
	`acc_year` text NOT NULL,
	`company_id` text NOT NULL,
	`branch_id` text,
	`cust_id` text NOT NULL,
	`refno` text NOT NULL,
	`bill_date` text NOT NULL,
	`bill_amount` numeric NOT NULL,
	`due` numeric,
	`pay_mode` text,
	`returned_amt` numeric,
	`return_status` text,
	`synced_on` text NOT NULL,
	PRIMARY KEY(`sb_id`, `acc_year`)
);
--> statement-breakpoint
CREATE INDEX `ix_return_bills_cust` ON `return_bills` (`cust_id`,`company_id`,`bill_date`);--> statement-breakpoint
CREATE TABLE `return_godowns` (
	`company_id` text NOT NULL,
	`godown_id` text NOT NULL,
	`branch_id` text,
	`name` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`company_id`, `godown_id`)
);
--> statement-breakpoint
CREATE TABLE `return_reasons` (
	`company_id` text NOT NULL,
	`reason_id` text NOT NULL,
	`code` text,
	`name` text NOT NULL,
	`default_condition` text,
	`refund_charges` integer,
	`is_claim` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`company_id`, `reason_id`)
);
--> statement-breakpoint
CREATE TABLE `return_settings` (
	`company_id` text PRIMARY KEY NOT NULL,
	`branch_id` text,
	`return_window_days` integer DEFAULT 0 NOT NULL,
	`free_return_allowed` integer DEFAULT true NOT NULL,
	`settle_default` text,
	`expired_lot_days` integer,
	`bill_days` integer DEFAULT 90 NOT NULL,
	`can_post` integer,
	`bills_as_of` text,
	`synced_on` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `sale_return` ADD `sr_branch_id` text;--> statement-breakpoint
ALTER TABLE `sale_return` ADD `sr_bill_id` text;--> statement-breakpoint
ALTER TABLE `sale_return` ADD `sr_bill_acc_year` text;--> statement-breakpoint
ALTER TABLE `sale_return` ADD `app_bill_refno` text;--> statement-breakpoint
ALTER TABLE `sale_return` ADD `app_bill_date` text;--> statement-breakpoint
ALTER TABLE `sale_return` ADD `sr_reason_id` text;--> statement-breakpoint
ALTER TABLE `sale_return` ADD `sr_return_reason` text;--> statement-breakpoint
ALTER TABLE `sale_return` ADD `sr_godown_id` text;--> statement-breakpoint
ALTER TABLE `sale_return` ADD `sr_usr_refno` text;--> statement-breakpoint
ALTER TABLE `sale_return` ADD `sr_usr_refdate` text;--> statement-breakpoint
ALTER TABLE `sale_return` ADD `sr_remarks` text;--> statement-breakpoint
ALTER TABLE `sale_return` ADD `app_adjust` text;--> statement-breakpoint
ALTER TABLE `sale_return` ADD `app_status` text DEFAULT 'WAITING' NOT NULL;--> statement-breakpoint
ALTER TABLE `sale_return` ADD `app_vk_refno` text;--> statement-breakpoint
ALTER TABLE `sale_return` ADD `app_vk_amt` numeric;--> statement-breakpoint
ALTER TABLE `sale_return` ADD `app_synced_on` text;--> statement-breakpoint
ALTER TABLE `sale_return` ADD `app_vk_note` text;--> statement-breakpoint
ALTER TABLE `sale_return` ADD `app_vk_settle` text;--> statement-breakpoint
ALTER TABLE `sale_return` ADD `app_vk_totals` text;--> statement-breakpoint
ALTER TABLE `sale_return` ADD `app_vk_lines` text;--> statement-breakpoint
ALTER TABLE `sale_return` ADD `app_cancelled_on` text;--> statement-breakpoint
ALTER TABLE `sale_return` ADD `app_cancel_reason` text;--> statement-breakpoint
ALTER TABLE `sale_return` ADD `app_approval` text;--> statement-breakpoint
ALTER TABLE `sale_return_item` ADD `sri_bill_item_id` text;--> statement-breakpoint
ALTER TABLE `sale_return_item` ADD `sri_bill_acc_year` text;--> statement-breakpoint
ALTER TABLE `sale_return_item` ADD `sri_split_no` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sale_return_item` ADD `app_unit_name` text;--> statement-breakpoint
ALTER TABLE `sale_return_item` ADD `app_item_name` text;--> statement-breakpoint
-- Returns saved by the page-6 build (free returns, no reason id, never sent) stay on the phone as OLD and are never sent (Q3 default, 2026-11-20).
UPDATE `sale_return` SET `app_status` = 'OLD', `app_pending_upload` = 0;
