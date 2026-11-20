CREATE TABLE `receipt_allocations` (
	`ral_id` text PRIMARY KEY NOT NULL,
	`ral_receipt_id` text NOT NULL,
	`ral_source` text NOT NULL,
	`ral_kind` text NOT NULL,
	`ral_bill_id` text NOT NULL,
	`ral_bill_acc_year` text NOT NULL,
	`app_doc_refno` text,
	`ral_amount` numeric NOT NULL,
	`ral_credit` numeric DEFAULT '0' NOT NULL,
	`ral_discount` numeric DEFAULT '0' NOT NULL,
	`ral_roundoff` numeric DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ix_ral_receipt` ON `receipt_allocations` (`ral_receipt_id`,`ral_source`);--> statement-breakpoint
CREATE TABLE `receipt_settings` (
	`company_id` text PRIMARY KEY NOT NULL,
	`bill_sort` text,
	`salesman_mandatory` integer DEFAULT false NOT NULL,
	`pdc_posting_mode` text,
	`ppd_enabled` integer DEFAULT false NOT NULL,
	`synced_on` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `open_bills` ADD `kind` text DEFAULT 'BILL' NOT NULL;--> statement-breakpoint
ALTER TABLE `open_bills` ADD `paid_paise` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `open_bills` ADD `pdc_held_paise` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `open_bills` ADD `ppd_schedule` text;--> statement-breakpoint
ALTER TABLE `receipt_tenders` ADD `app_cheque_branch` text;--> statement-breakpoint
ALTER TABLE `receipt_tenders` ADD `app_cheque_ifsc` text;--> statement-breakpoint
ALTER TABLE `receipt_tenders` ADD `app_cheque_drawer` text;--> statement-breakpoint
ALTER TABLE `receipts` ADD `avh_branch_id` text;--> statement-breakpoint
ALTER TABLE `receipts` ADD `avh_doc_refno` text;--> statement-breakpoint
ALTER TABLE `receipts` ADD `avh_doc_date` text;--> statement-breakpoint
ALTER TABLE `receipts` ADD `app_on_account` numeric;--> statement-breakpoint
ALTER TABLE `receipts` ADD `avh_employee_id` text;--> statement-breakpoint
ALTER TABLE `receipts` ADD `app_cancelled_on` text;--> statement-breakpoint
ALTER TABLE `receipts` ADD `app_cancel_reason` text;--> statement-breakpoint
ALTER TABLE `receipts` ADD `app_adjusted` text;--> statement-breakpoint
ALTER TABLE `receipts` ADD `app_pdc` text;--> statement-breakpoint
ALTER TABLE `tenders` ADD `app_requires_bank` integer DEFAULT false NOT NULL;