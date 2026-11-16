CREATE TABLE `companies` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`place` text,
	`position` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE `customers` ADD `district` text;--> statement-breakpoint
ALTER TABLE `customers` ADD `pincode` text;--> statement-breakpoint
ALTER TABLE `customers` ADD `mobile2` text;--> statement-breakpoint
ALTER TABLE `customers` ADD `gst_type` text;--> statement-breakpoint
ALTER TABLE `customers` ADD `gstin` text;--> statement-breakpoint
ALTER TABLE `customers` ADD `aadhaar` text;--> statement-breakpoint
ALTER TABLE `customers` ADD `pending_upload` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `customers` ADD `created_by` text;--> statement-breakpoint
ALTER TABLE `customers` ADD `created_at` text;