ALTER TABLE `devices` ADD `kind` text DEFAULT 'phone' NOT NULL;--> statement-breakpoint
UPDATE `devices` SET `kind` = 'desktop' WHERE `name` LIKE 'Ganger 데스크톱 (%';
