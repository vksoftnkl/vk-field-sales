CREATE TABLE `item_price_levels` (
	`ipl_id` integer PRIMARY KEY NOT NULL,
	`ipl_name` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `customers` ADD `app_sync_error` text;