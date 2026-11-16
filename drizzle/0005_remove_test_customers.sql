-- Removes the TEMPORARY test shops (seeded before customers came from VK Nex) from phones that
-- have them: their bills, the shops, and the test beats and types. A test beat or type that a
-- shop added on the phone still uses is kept, so that shop stays listed under it.
DELETE FROM `customer_bills` WHERE `customer_id` LIKE 'test-cust-%';
--> statement-breakpoint
DELETE FROM `customers` WHERE `cus_id` LIKE 'test-cust-%';
--> statement-breakpoint
DELETE FROM `beats` WHERE `id` IN ('beat-nkl-east', 'beat-nkl-west', 'beat-rasipuram') AND `id` NOT IN (SELECT `cus_area_id` FROM `customers`);
--> statement-breakpoint
DELETE FROM `customer_types` WHERE `id` IN ('type-retail', 'type-wholesale', 'type-super') AND `id` NOT IN (SELECT `cus_group_id` FROM `customers`);
--> statement-breakpoint
DELETE FROM `device_meta` WHERE `key` = 'testCustomersVersion';
