CREATE TABLE `fiscal_years` (
	`fy_year_name` text PRIMARY KEY NOT NULL,
	`fy_begin_date` text NOT NULL,
	`fy_end_date` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ledger_rows` (
	`customer_id` text NOT NULL,
	`voucher_id` text NOT NULL,
	`acc_year` text NOT NULL,
	`seq` integer NOT NULL,
	`date` text NOT NULL,
	`voucher_type_name` text,
	`voucher_no` text,
	`row_kind` text NOT NULL,
	`particulars` text,
	`narration` text,
	`src_module` text,
	`src_doc_type` text,
	`bill_refs` text DEFAULT '[]' NOT NULL,
	`debit_paise` integer NOT NULL,
	`credit_paise` integer NOT NULL,
	`balance_paise` integer NOT NULL,
	PRIMARY KEY(`customer_id`, `voucher_id`)
);
--> statement-breakpoint
CREATE INDEX `ix_ledger_rows_customer_year` ON `ledger_rows` (`customer_id`,`acc_year`,`seq`);--> statement-breakpoint
CREATE TABLE `ledger_years` (
	`customer_id` text NOT NULL,
	`acc_year` text NOT NULL,
	`from_date` text NOT NULL,
	`to_date` text NOT NULL,
	`opening_paise` integer NOT NULL,
	`closing_paise` integer NOT NULL,
	`synced_on` text NOT NULL,
	PRIMARY KEY(`customer_id`, `acc_year`)
);
--> statement-breakpoint
ALTER TABLE `customers` ADD `app_pending_update` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `customers` ADD `app_edited_fields` text DEFAULT '[]' NOT NULL;