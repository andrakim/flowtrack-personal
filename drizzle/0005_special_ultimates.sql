CREATE TABLE `workspace_activity` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`workspace_id` integer NOT NULL,
	`actor_user_id` integer,
	`action` text NOT NULL,
	`entity_type` text,
	`entity_id` integer,
	`summary` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `workspace_activity_workspace_created_idx` ON `workspace_activity` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `workspace_invites` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`workspace_id` integer NOT NULL,
	`email` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`token` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`invited_by_user_id` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`responded_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invited_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_invites_workspace_email_unique` ON `workspace_invites` (`workspace_id`,`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_invites_token_unique` ON `workspace_invites` (`token`);--> statement-breakpoint
CREATE INDEX `workspace_invites_email_status_idx` ON `workspace_invites` (`email`,`status`);--> statement-breakpoint
CREATE TABLE `workspace_members` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`workspace_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`joined_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_members_workspace_user_unique` ON `workspace_members` (`workspace_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `workspace_members_user_workspace_idx` ON `workspace_members` (`user_id`,`workspace_id`);--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`kind` text DEFAULT 'team' NOT NULL,
	`color` text DEFAULT '#6366f1' NOT NULL,
	`owner_user_id` integer NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `workspaces_owner_created_idx` ON `workspaces` (`owner_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `workspaces_archived_updated_idx` ON `workspaces` (`archived`,`updated_at`);--> statement-breakpoint
ALTER TABLE `projects` ADD `workspace_id` integer REFERENCES workspaces(id);--> statement-breakpoint
ALTER TABLE `projects` ADD `created_by_user_id` integer REFERENCES users(id);--> statement-breakpoint
CREATE INDEX `projects_workspace_created_idx` ON `projects` (`workspace_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `tasks` ADD `workspace_id` integer REFERENCES workspaces(id);--> statement-breakpoint
ALTER TABLE `tasks` ADD `created_by_user_id` integer REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `tasks` ADD `assignee_user_id` integer REFERENCES users(id);--> statement-breakpoint
CREATE INDEX `tasks_workspace_due_idx` ON `tasks` (`workspace_id`,`due_date`);--> statement-breakpoint
CREATE INDEX `tasks_assignee_status_idx` ON `tasks` (`assignee_user_id`,`status`);