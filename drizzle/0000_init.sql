CREATE TABLE `customers` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text,
	`name` text NOT NULL,
	`mobile` text,
	`gstin` text,
	`state_code` text,
	`address` text,
	`beat_id` text,
	`price_level` text,
	`credit_limit_paise` integer DEFAULT 0 NOT NULL,
	`credit_bill_limit` integer DEFAULT 0 NOT NULL,
	`outstanding_paise` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`server_updated_at` text
);
--> statement-breakpoint
CREATE INDEX `ix_customers_name` ON `customers` (`name`);--> statement-breakpoint
CREATE INDEX `ix_customers_beat` ON `customers` (`beat_id`);--> statement-breakpoint
CREATE TABLE `device_meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `item_prices` (
	`item_id` text NOT NULL,
	`price_level` text NOT NULL,
	`rate_paise` integer NOT NULL,
	PRIMARY KEY(`item_id`, `price_level`)
);
--> statement-breakpoint
CREATE TABLE `items` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text,
	`name` text NOT NULL,
	`barcode` text,
	`hsn` text,
	`unit` text DEFAULT 'NOS' NOT NULL,
	`mrp_paise` integer DEFAULT 0 NOT NULL,
	`gst_rate_bp` integer DEFAULT 0 NOT NULL,
	`cess_rate_bp` integer DEFAULT 0 NOT NULL,
	`tax_inclusive` integer DEFAULT false NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`server_updated_at` text
);
--> statement-breakpoint
CREATE INDEX `ix_items_name` ON `items` (`name`);--> statement-breakpoint
CREATE INDEX `ix_items_barcode` ON `items` (`barcode`);--> statement-breakpoint
CREATE TABLE `order_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`order_uuid` text NOT NULL,
	`line_no` integer NOT NULL,
	`item_id` text NOT NULL,
	`qty` real NOT NULL,
	`rate_paise` integer NOT NULL,
	`disc_bp` integer DEFAULT 0 NOT NULL,
	`gst_rate_bp` integer NOT NULL,
	`cess_rate_bp` integer DEFAULT 0 NOT NULL,
	`taxable_paise` integer NOT NULL,
	`cgst_paise` integer NOT NULL,
	`sgst_paise` integer NOT NULL,
	`igst_paise` integer NOT NULL,
	`cess_paise` integer NOT NULL,
	`total_paise` integer NOT NULL,
	FOREIGN KEY (`order_uuid`) REFERENCES `orders`(`client_uuid`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ix_order_lines_order` ON `order_lines` (`order_uuid`);--> statement-breakpoint
CREATE TABLE `orders` (
	`client_uuid` text PRIMARY KEY NOT NULL,
	`server_id` text,
	`order_no` text,
	`customer_id` text NOT NULL,
	`order_date` text NOT NULL,
	`status` text DEFAULT 'QUEUED' NOT NULL,
	`inter_state` integer DEFAULT false NOT NULL,
	`taxable_paise` integer NOT NULL,
	`tax_paise` integer NOT NULL,
	`round_off_paise` integer NOT NULL,
	`total_paise` integer NOT NULL,
	`remarks` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ix_orders_customer` ON `orders` (`customer_id`);--> statement-breakpoint
CREATE INDEX `ix_orders_date` ON `orders` (`order_date`);--> statement-breakpoint
CREATE TABLE `outbox` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entity` text NOT NULL,
	`client_uuid` text NOT NULL,
	`op` text DEFAULT 'UPSERT' NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` text,
	`last_error` text,
	`server_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_outbox_entity_uuid` ON `outbox` (`entity`,`client_uuid`);--> statement-breakpoint
CREATE INDEX `ix_outbox_status_next` ON `outbox` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE TABLE `sync_cursors` (
	`scope` text PRIMARY KEY NOT NULL,
	`cursor` text,
	`last_pulled_at` text
);
