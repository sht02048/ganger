CREATE TABLE `devices` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen_at` integer,
	`expo_push_token` text,
	`notifications_enabled` integer DEFAULT false NOT NULL,
	`notify_question` integer DEFAULT true NOT NULL,
	`notify_permission` integer DEFAULT true NOT NULL,
	`notify_human_check_request` integer DEFAULT true NOT NULL,
	`notify_failed_disconnected` integer DEFAULT true NOT NULL,
	`notify_runner_issue` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `devices_token_hash` ON `devices` (`token_hash`);