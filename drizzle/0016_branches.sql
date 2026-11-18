CREATE TABLE `branches` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`name` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ix_branches_company` ON `branches` (`company_id`);--> statement-breakpoint
ALTER TABLE `sale_order` ADD `so_branch_id` text;