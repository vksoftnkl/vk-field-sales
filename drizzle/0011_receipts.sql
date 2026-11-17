CREATE TABLE `open_bills` (
	`bill_id` text NOT NULL,
	`bill_acc_year` text NOT NULL,
	`company_id` text NOT NULL,
	`party_id` text NOT NULL,
	`seq` integer NOT NULL,
	`bill_type` text,
	`doc_refno` text NOT NULL,
	`doc_date` text NOT NULL,
	`due_date` text,
	`bill_amount_paise` integer NOT NULL,
	`pending_paise` integer NOT NULL,
	`synced_on` text NOT NULL,
	PRIMARY KEY(`bill_id`, `bill_acc_year`)
);
--> statement-breakpoint
CREATE INDEX `ix_open_bills_party` ON `open_bills` (`party_id`,`company_id`,`seq`);--> statement-breakpoint
CREATE TABLE `receipt_tenders` (
	`td_id` text PRIMARY KEY NOT NULL,
	`td_src_doc_id` text NOT NULL,
	`td_row_no` integer NOT NULL,
	`td_tender_id` text NOT NULL,
	`td_tender_type_id` integer NOT NULL,
	`app_tender_name` text NOT NULL,
	`td_amount` numeric NOT NULL,
	`td_ref_no` text,
	`td_bank_name` text,
	`td_instrument_date` text
);
--> statement-breakpoint
CREATE INDEX `ix_td_receipt` ON `receipt_tenders` (`td_src_doc_id`);--> statement-breakpoint
CREATE TABLE `receipts` (
	`avh_client_uuid` text PRIMARY KEY NOT NULL,
	`avh_company_id` text NOT NULL,
	`avh_party_id` text NOT NULL,
	`app_party_name` text NOT NULL,
	`avh_voucher_date` text NOT NULL,
	`avh_usr_refno` text NOT NULL,
	`app_slno` integer NOT NULL,
	`app_acc_year` text NOT NULL,
	`avh_device_id` text NOT NULL,
	`avh_doc_amount` numeric NOT NULL,
	`avh_remarks` text,
	`app_user_id` text NOT NULL,
	`avh_created_on` text NOT NULL,
	`app_pending_upload` integer DEFAULT true NOT NULL,
	`app_sync_error` text,
	`avh_voucher_id` text,
	`avh_voucher_refno` text,
	`avh_voucher_status` text,
	`app_synced_on` text
);
--> statement-breakpoint
CREATE INDEX `ix_rct_party` ON `receipts` (`avh_party_id`,`avh_company_id`);--> statement-breakpoint
CREATE INDEX `ix_rct_pending` ON `receipts` (`app_pending_upload`);--> statement-breakpoint
CREATE INDEX `ix_rct_series` ON `receipts` (`avh_company_id`,`avh_device_id`,`app_acc_year`,`app_slno`);--> statement-breakpoint
CREATE TABLE `tenders` (
	`company_id` text NOT NULL,
	`tnd_id` text NOT NULL,
	`tnd_type_id` integer NOT NULL,
	`tnd_type_code` text,
	`tnd_name` text NOT NULL,
	`app_needs_ref` integer DEFAULT false NOT NULL,
	`app_ref_label` text,
	`position` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`company_id`, `tnd_id`)
);
