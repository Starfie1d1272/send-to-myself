CREATE TABLE `sessions` (
	`token` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `attachments` ADD `thumb_key` text;