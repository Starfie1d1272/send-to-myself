CREATE TABLE `device_tokens` (
	`token` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	`expires_at` integer
);
--> statement-breakpoint
ALTER TABLE `items` ADD `dedupe_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_items_dedupe_key` ON `items` (`dedupe_key`);