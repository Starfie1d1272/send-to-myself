CREATE TABLE `deleted_dedupe_keys` (
	`dedupe_key` text PRIMARY KEY NOT NULL,
	`deleted_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `items` ADD `trash_retention_started_at` integer;--> statement-breakpoint
ALTER TABLE `items` ADD `purge_started_at` integer;