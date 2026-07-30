CREATE TABLE `goals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`category` text DEFAULT 'personal' NOT NULL,
	`target_value` integer,
	`current_value` integer DEFAULT 0 NOT NULL,
	`unit` text,
	`deadline` text,
	`status` text DEFAULT 'active' NOT NULL,
	`color` text DEFAULT '#10b981' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `goals_status_deadline_idx` ON `goals` (`status`,`deadline`);--> statement-breakpoint
CREATE TABLE `habit_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`habit_id` integer NOT NULL,
	`date` text NOT NULL,
	`completed` integer DEFAULT true NOT NULL,
	`count` integer DEFAULT 1 NOT NULL,
	`note` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`habit_id`) REFERENCES `habits`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `habit_logs_habit_date_unique` ON `habit_logs` (`habit_id`,`date`);--> statement-breakpoint
CREATE INDEX `habit_logs_date_idx` ON `habit_logs` (`date`);--> statement-breakpoint
CREATE TABLE `habits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`color` text DEFAULT '#6366f1' NOT NULL,
	`icon` text DEFAULT 'star' NOT NULL,
	`frequency` text DEFAULT 'daily' NOT NULL,
	`target_per_day` integer DEFAULT 1 NOT NULL,
	`order` integer DEFAULT 0 NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `habits_archived_order_idx` ON `habits` (`archived`,`order`);--> statement-breakpoint
CREATE TABLE `kanban_cards` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`column_id` integer NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`priority` text DEFAULT 'medium' NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`order` integer DEFAULT 0 NOT NULL,
	`due_date` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`column_id`) REFERENCES `kanban_columns`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `kanban_cards_column_order_idx` ON `kanban_cards` (`column_id`,`order`);--> statement-breakpoint
CREATE TABLE `kanban_columns` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`title` text NOT NULL,
	`order` integer DEFAULT 0 NOT NULL,
	`color` text DEFAULT '#e5e7eb' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `kanban_columns_project_order_idx` ON `kanban_columns` (`project_id`,`order`);--> statement-breakpoint
CREATE TABLE `notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`color` text DEFAULT '#fef3c7' NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `notes_pinned_order_idx` ON `notes` (`pinned`,`order`,`updated_at`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`color` text DEFAULT '#6366f1' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `projects_archived_created_idx` ON `projects` (`archived`,`created_at`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'todo' NOT NULL,
	`priority` text DEFAULT 'medium' NOT NULL,
	`due_date` text,
	`due_time` text,
	`estimated_minutes` integer,
	`actual_minutes` integer,
	`project_id` integer,
	`tags` text DEFAULT '[]' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `tasks_due_status_idx` ON `tasks` (`due_date`,`status`);--> statement-breakpoint
CREATE INDEX `tasks_project_idx` ON `tasks` (`project_id`);--> statement-breakpoint
CREATE TABLE `time_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`project_id` integer,
	`task_id` integer,
	`start_time` integer NOT NULL,
	`end_time` integer,
	`duration` integer,
	`description` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `time_entries_end_start_idx` ON `time_entries` (`end_time`,`start_time`);