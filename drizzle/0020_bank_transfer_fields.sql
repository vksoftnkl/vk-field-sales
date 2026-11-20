CREATE TABLE `banks` (
	`bnk_id` text PRIMARY KEY NOT NULL,
	`bnk_name` text NOT NULL,
	`bnk_short_name` text,
	`position` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE `receipt_settings` ADD `app_takes_transfer_type` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `receipt_tenders` ADD `td_transfer_type` text;