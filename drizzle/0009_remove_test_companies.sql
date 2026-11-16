-- Removes the TEMPORARY test companies (seeded before companies came from VK Nex) from phones
-- that have them; Sync now brings VK Nex's own (GET /mobile/items/options). A check-in saved for
-- a test company loses that company and goes up under the one chosen at Sync time; the chosen
-- company is forgotten if it was a test one, so Choose company starts empty until Sync.
UPDATE `visits` SET `company_id` = NULL WHERE `company_id` IN ('comp-balaji', 'comp-sakthi', 'comp-kongu');
--> statement-breakpoint
DELETE FROM `item_units` WHERE `app_company_id` IN ('comp-balaji', 'comp-sakthi', 'comp-kongu');
--> statement-breakpoint
DELETE FROM `device_meta` WHERE `key` = 'companyId' AND `value` IN ('comp-balaji', 'comp-sakthi', 'comp-kongu');
--> statement-breakpoint
DELETE FROM `companies` WHERE `id` IN ('comp-balaji', 'comp-sakthi', 'comp-kongu');
