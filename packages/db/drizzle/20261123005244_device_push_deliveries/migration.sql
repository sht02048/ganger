CREATE TABLE `device_push_deliveries` (
	`device_id` text NOT NULL,
	`event_id` integer NOT NULL,
	`first_sent_at` integer,
	`reminded_at` integer,
	`cleared_at` integer,
	`bundle_id` text,
	CONSTRAINT `device_push_deliveries_pk` PRIMARY KEY(`device_id`, `event_id`),
	CONSTRAINT `fk_device_push_deliveries_device_id_devices_id_fk` FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_device_push_deliveries_event_id_notification_events_id_fk` FOREIGN KEY (`event_id`) REFERENCES `notification_events`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `device_push_deliveries_event` ON `device_push_deliveries` (`event_id`);