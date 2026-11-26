CREATE TABLE IF NOT EXISTS `ai_call_events` (
	`id` text PRIMARY KEY NOT NULL,
	`ticket_id` text NOT NULL,
	`event_type` text DEFAULT 'REQUEST_CLOSED' NOT NULL,
	`delivery_status` text DEFAULT 'pending' NOT NULL,
	`engine_event_id` text,
	`engine_call_id` text,
	`call_status` text,
	`call_outcome` text,
	`call_duration_seconds` integer,
	`skip_reason` text,
	`last_error` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_retry_at` integer,
	`closed_at` integer NOT NULL,
	`closed_by` text,
	`sent_at` integer,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`ticket_id`) REFERENCES `tickets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_ai_call_events_ticket_event` ON `ai_call_events` (`ticket_id`,`event_type`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_ai_call_events_delivery` ON `ai_call_events` (`delivery_status`,`next_retry_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_ai_call_events_engine_call` ON `ai_call_events` (`engine_call_id`);
