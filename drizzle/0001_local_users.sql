CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`login_name` text NOT NULL,
	`display_name` text NOT NULL,
	`password_hash` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`server_updated_at` text
);
--> statement-breakpoint
CREATE INDEX `ix_users_login` ON `users` (`login_name`);--> statement-breakpoint
ALTER TABLE `orders` ADD `created_by` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `second_user_id` text;