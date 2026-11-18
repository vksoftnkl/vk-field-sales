-- Removes the TEMPORARY test salesmen (karthik / murugan / priya, seeded before login used VK Nex)
-- from phones that have them. Users now come from VK Nex: the first login on a phone is checked
-- with POST /auth/login, and the phone keeps that user. Orders, bills and receipts the test
-- salesmen made stay as they are (they keep the old user id, as text).
DELETE FROM `users` WHERE `id` IN ('test-karthik', 'test-murugan', 'test-priya');
--> statement-breakpoint
DELETE FROM `device_meta` WHERE `key` = 'lastUserId' AND `value` IN ('test-karthik', 'test-murugan', 'test-priya');
