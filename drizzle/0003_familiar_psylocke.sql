CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`last_seen_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE INDEX `users_last_seen_idx` ON `users` (`last_seen_at`);--> statement-breakpoint
ALTER TABLE `goals` ADD `user_id` integer REFERENCES users(id) ON DELETE CASCADE;--> statement-breakpoint
CREATE INDEX `goals_user_deadline_idx` ON `goals` (`user_id`,`deadline`);--> statement-breakpoint
ALTER TABLE `habits` ADD `user_id` integer REFERENCES users(id) ON DELETE CASCADE;--> statement-breakpoint
CREATE INDEX `habits_user_order_idx` ON `habits` (`user_id`,`order`);--> statement-breakpoint
ALTER TABLE `import_batches` ADD `user_id` integer REFERENCES users(id) ON DELETE CASCADE;--> statement-breakpoint
CREATE INDEX `import_batches_user_created_idx` ON `import_batches` (`user_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `notes` ADD `user_id` integer REFERENCES users(id) ON DELETE CASCADE;--> statement-breakpoint
CREATE INDEX `notes_user_updated_idx` ON `notes` (`user_id`,`updated_at`);--> statement-breakpoint
ALTER TABLE `pomodoro_state` ADD `user_id` integer REFERENCES users(id) ON DELETE CASCADE;--> statement-breakpoint
CREATE UNIQUE INDEX `pomodoro_state_user_unique` ON `pomodoro_state` (`user_id`);--> statement-breakpoint
ALTER TABLE `projects` ADD `user_id` integer REFERENCES users(id) ON DELETE CASCADE;--> statement-breakpoint
CREATE INDEX `projects_user_created_idx` ON `projects` (`user_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `tasks` ADD `user_id` integer REFERENCES users(id) ON DELETE CASCADE;--> statement-breakpoint
CREATE INDEX `tasks_user_due_idx` ON `tasks` (`user_id`,`due_date`);--> statement-breakpoint
ALTER TABLE `time_entries` ADD `user_id` integer REFERENCES users(id) ON DELETE CASCADE;--> statement-breakpoint
CREATE INDEX `time_entries_user_start_idx` ON `time_entries` (`user_id`,`start_time`);
