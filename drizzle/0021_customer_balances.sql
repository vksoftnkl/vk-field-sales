CREATE TABLE `customer_balances` (
	`customer_id` text PRIMARY KEY NOT NULL,
	`company_id` text,
	`balance_paise` integer NOT NULL,
	`outstanding_paise` integer,
	`bill_count` integer,
	`oldest_bill_date` text,
	`as_on` text NOT NULL,
	`synced_on` text NOT NULL
);
