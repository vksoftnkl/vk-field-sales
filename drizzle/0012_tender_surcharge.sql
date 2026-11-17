ALTER TABLE `receipt_tenders` ADD `td_surcharge_amt` numeric DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE `tenders` ADD `app_is_default` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `tenders` ADD `tnd_surcharge_perc` numeric DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE `tenders` ADD `tnd_surcharge_amount` numeric DEFAULT '0' NOT NULL;