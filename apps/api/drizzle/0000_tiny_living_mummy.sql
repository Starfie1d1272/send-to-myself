CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`filename` text NOT NULL,
	`mime_type` text NOT NULL,
	`size` integer NOT NULL,
	`storage_key` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_attachments_item_id` ON `attachments` (`item_id`);--> statement-breakpoint
CREATE TABLE `items` (
	`id` text PRIMARY KEY NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`kind` text NOT NULL,
	`category` text DEFAULT 'none' NOT NULL,
	`is_todo` integer DEFAULT false NOT NULL,
	`completed` integer DEFAULT false NOT NULL,
	`due_at` integer,
	`completed_at` integer,
	`pinned` integer DEFAULT false NOT NULL,
	`sensitive` integer DEFAULT false NOT NULL,
	`deleted_at` integer,
	`meta` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_items_created_at` ON `items` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_items_deleted_at` ON `items` (`deleted_at`);