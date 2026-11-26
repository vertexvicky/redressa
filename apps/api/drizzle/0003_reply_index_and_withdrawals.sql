CREATE TABLE IF NOT EXISTS `reply_index` (
	`id` text PRIMARY KEY NOT NULL,
	`ticket_id` text NOT NULL,
	`reply_id` text,
	`department_id` text,
	`category` text NOT NULL,
	`question` text NOT NULL,
	`final_reply` text NOT NULL,
	`rounds` integer DEFAULT 1 NOT NULL,
	`auto_composed` integer DEFAULT 0 NOT NULL,
	`is_demo` integer DEFAULT 0 NOT NULL,
	`finalized_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`ticket_id`) REFERENCES `tickets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_reply_index_time` ON `reply_index` (`finalized_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_reply_index_ticket` ON `reply_index` (`ticket_id`);
--> statement-breakpoint
CREATE VIRTUAL TABLE IF NOT EXISTS `reply_index_fts` USING fts5(question, final_reply, content='reply_index', content_rowid='rowid');
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `reply_index_ai` AFTER INSERT ON `reply_index` BEGIN
  INSERT INTO reply_index_fts(rowid, question, final_reply) VALUES (new.rowid, new.question, new.final_reply);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `reply_index_ad` AFTER DELETE ON `reply_index` BEGIN
  INSERT INTO reply_index_fts(reply_index_fts, rowid, question, final_reply) VALUES ('delete', old.rowid, old.question, old.final_reply);
END;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `withdrawal_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`ticket_id` text NOT NULL,
	`citizen_id` text NOT NULL,
	`reason` text NOT NULL,
	`questions` text NOT NULL,
	`answers` text,
	`own_decision` text,
	`outcome` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`effective_at` integer NOT NULL,
	`finalized_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`ticket_id`) REFERENCES `tickets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`citizen_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_withdrawal_status_effective` ON `withdrawal_requests` (`status`,`effective_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_withdrawal_ticket` ON `withdrawal_requests` (`ticket_id`);
