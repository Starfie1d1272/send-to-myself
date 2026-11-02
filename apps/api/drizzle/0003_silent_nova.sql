ALTER TABLE `items` ADD `sensitive_override` integer;
--> statement-breakpoint
UPDATE `items` SET `sensitive_override` = 1 WHERE `sensitive` = 1;
