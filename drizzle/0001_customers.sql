CREATE TABLE `beats` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `customer_bills` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`bill_no` text NOT NULL,
	`bill_date` text NOT NULL,
	`balance_paise` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ix_customer_bills_customer` ON `customer_bills` (`customer_id`);--> statement-breakpoint
CREATE TABLE `customer_types` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `customers` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text,
	`name` text NOT NULL,
	`mobile` text,
	`address` text,
	`place` text,
	`beat_id` text,
	`type_id` text,
	`position` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`billed` integer DEFAULT false NOT NULL,
	`order_status` text,
	`received` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ix_customers_beat` ON `customers` (`beat_id`);--> statement-breakpoint
CREATE INDEX `ix_customers_name` ON `customers` (`name`);