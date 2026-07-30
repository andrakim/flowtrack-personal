CREATE TABLE `analytics_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` integer NOT NULL,
	`event_type` text NOT NULL,
	`effective_date` text,
	`project_id` integer,
	`duration_seconds` integer,
	`previous_value` text,
	`next_value` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `analytics_events_user_created_idx` ON `analytics_events` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `analytics_events_user_type_created_idx` ON `analytics_events` (`user_id`,`event_type`,`created_at`);--> statement-breakpoint
CREATE INDEX `analytics_events_entity_idx` ON `analytics_events` (`entity_type`,`entity_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `analytics_events_effective_date_idx` ON `analytics_events` (`effective_date`);--> statement-breakpoint
CREATE TABLE `analytics_tracking` (
	`user_id` integer PRIMARY KEY NOT NULL,
	`started_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `analytics_tracking` (`user_id`)
SELECT `id` FROM `users`;
--> statement-breakpoint
INSERT INTO `analytics_events` (
	`user_id`,
	`entity_type`,
	`entity_id`,
	`event_type`,
	`effective_date`,
	`project_id`,
	`next_value`,
	`created_at`
)
SELECT
	`user_id`,
	'task',
	`id`,
	'task_created',
	`due_date`,
	`project_id`,
	`due_date`,
	`created_at`
FROM `tasks`
WHERE `user_id` IS NOT NULL;
--> statement-breakpoint
INSERT INTO `analytics_events` (
	`user_id`,
	`entity_type`,
	`entity_id`,
	`event_type`,
	`effective_date`,
	`project_id`,
	`created_at`
)
SELECT
	`user_id`,
	'task',
	`id`,
	'task_completed',
	strftime('%Y-%m-%d', `completed_at` / 1000, 'unixepoch'),
	`project_id`,
	`completed_at`
FROM `tasks`
WHERE
	`user_id` IS NOT NULL
	AND `status` = 'done'
	AND `completed_at` IS NOT NULL;
--> statement-breakpoint
INSERT INTO `analytics_events` (
	`user_id`,
	`entity_type`,
	`entity_id`,
	`event_type`,
	`next_value`,
	`created_at`
)
SELECT
	`user_id`,
	'habit',
	`id`,
	'habit_created',
	`frequency` || ':' || `target_per_day`,
	`created_at`
FROM `habits`
WHERE `user_id` IS NOT NULL;
--> statement-breakpoint
INSERT INTO `analytics_events` (
	`user_id`,
	`entity_type`,
	`entity_id`,
	`event_type`,
	`effective_date`,
	`next_value`,
	`created_at`
)
SELECT
	`habits`.`user_id`,
	'habit',
	`habit_logs`.`habit_id`,
	'habit_completed',
	`habit_logs`.`date`,
	CAST(`habit_logs`.`count` AS TEXT),
	`habit_logs`.`created_at`
FROM `habit_logs`
INNER JOIN `habits` ON `habits`.`id` = `habit_logs`.`habit_id`
WHERE
	`habits`.`user_id` IS NOT NULL
	AND `habit_logs`.`completed` = 1;
--> statement-breakpoint
INSERT INTO `analytics_events` (
	`user_id`,
	`entity_type`,
	`entity_id`,
	`event_type`,
	`effective_date`,
	`project_id`,
	`duration_seconds`,
	`created_at`
)
SELECT
	`user_id`,
	'focus',
	`id`,
	'focus_completed',
	strftime('%Y-%m-%d', `end_time` / 1000, 'unixepoch'),
	`project_id`,
	`duration`,
	`end_time`
FROM `time_entries`
WHERE
	`user_id` IS NOT NULL
	AND `end_time` IS NOT NULL
	AND `duration` IS NOT NULL;
--> statement-breakpoint
CREATE TRIGGER `analytics_users_after_insert`
AFTER INSERT ON `users`
BEGIN
	INSERT OR IGNORE INTO `analytics_tracking` (`user_id`)
	VALUES (NEW.`id`);
END;
--> statement-breakpoint
CREATE TRIGGER `analytics_tasks_after_insert`
AFTER INSERT ON `tasks`
WHEN NEW.`user_id` IS NOT NULL
BEGIN
	INSERT INTO `analytics_events` (
		`user_id`,
		`entity_type`,
		`entity_id`,
		`event_type`,
		`effective_date`,
		`project_id`,
		`next_value`,
		`created_at`
	)
	VALUES (
		NEW.`user_id`,
		'task',
		NEW.`id`,
		'task_created',
		NEW.`due_date`,
		NEW.`project_id`,
		NEW.`due_date`,
		NEW.`created_at`
	);

	INSERT INTO `analytics_events` (
		`user_id`,
		`entity_type`,
		`entity_id`,
		`event_type`,
		`effective_date`,
		`project_id`,
		`created_at`
	)
	SELECT
		NEW.`user_id`,
		'task',
		NEW.`id`,
		'task_completed',
		strftime('%Y-%m-%d', NEW.`completed_at` / 1000, 'unixepoch'),
		NEW.`project_id`,
		NEW.`completed_at`
	WHERE NEW.`status` = 'done' AND NEW.`completed_at` IS NOT NULL;
END;
--> statement-breakpoint
CREATE TRIGGER `analytics_tasks_owner_after_update`
AFTER UPDATE OF `user_id` ON `tasks`
WHEN OLD.`user_id` IS NULL AND NEW.`user_id` IS NOT NULL
BEGIN
	INSERT INTO `analytics_events` (
		`user_id`,
		`entity_type`,
		`entity_id`,
		`event_type`,
		`effective_date`,
		`project_id`,
		`next_value`,
		`created_at`
	)
	VALUES (
		NEW.`user_id`,
		'task',
		NEW.`id`,
		'task_created',
		NEW.`due_date`,
		NEW.`project_id`,
		NEW.`due_date`,
		NEW.`created_at`
	);

	INSERT INTO `analytics_events` (
		`user_id`,
		`entity_type`,
		`entity_id`,
		`event_type`,
		`effective_date`,
		`project_id`,
		`created_at`
	)
	SELECT
		NEW.`user_id`,
		'task',
		NEW.`id`,
		'task_completed',
		strftime('%Y-%m-%d', NEW.`completed_at` / 1000, 'unixepoch'),
		NEW.`project_id`,
		NEW.`completed_at`
	WHERE NEW.`status` = 'done' AND NEW.`completed_at` IS NOT NULL;
END;
--> statement-breakpoint
CREATE TRIGGER `analytics_tasks_status_after_update`
AFTER UPDATE OF `status` ON `tasks`
WHEN NEW.`user_id` IS NOT NULL AND OLD.`status` IS NOT NEW.`status`
BEGIN
	INSERT INTO `analytics_events` (
		`user_id`,
		`entity_type`,
		`entity_id`,
		`event_type`,
		`effective_date`,
		`project_id`,
		`previous_value`,
		`next_value`
	)
	SELECT
		NEW.`user_id`,
		'task',
		NEW.`id`,
		'task_completed',
		strftime('%Y-%m-%d', COALESCE(NEW.`completed_at`, unixepoch() * 1000) / 1000, 'unixepoch'),
		NEW.`project_id`,
		OLD.`status`,
		NEW.`status`
	WHERE NEW.`status` = 'done';

	INSERT INTO `analytics_events` (
		`user_id`,
		`entity_type`,
		`entity_id`,
		`event_type`,
		`project_id`,
		`previous_value`,
		`next_value`
	)
	SELECT
		NEW.`user_id`,
		'task',
		NEW.`id`,
		'task_reopened',
		NEW.`project_id`,
		OLD.`status`,
		NEW.`status`
	WHERE OLD.`status` = 'done' AND NEW.`status` <> 'done';
END;
--> statement-breakpoint
CREATE TRIGGER `analytics_tasks_due_after_update`
AFTER UPDATE OF `due_date` ON `tasks`
WHEN
	NEW.`user_id` IS NOT NULL
	AND OLD.`due_date` IS NOT NEW.`due_date`
BEGIN
	INSERT INTO `analytics_events` (
		`user_id`,
		`entity_type`,
		`entity_id`,
		`event_type`,
		`effective_date`,
		`project_id`,
		`previous_value`,
		`next_value`
	)
	VALUES (
		NEW.`user_id`,
		'task',
		NEW.`id`,
		'task_rescheduled',
		NEW.`due_date`,
		NEW.`project_id`,
		OLD.`due_date`,
		NEW.`due_date`
	);
END;
--> statement-breakpoint
CREATE TRIGGER `analytics_tasks_deleted_after_update`
AFTER UPDATE OF `deleted_at` ON `tasks`
WHEN
	NEW.`user_id` IS NOT NULL
	AND OLD.`deleted_at` IS NOT NEW.`deleted_at`
BEGIN
	INSERT INTO `analytics_events` (
		`user_id`,
		`entity_type`,
		`entity_id`,
		`event_type`,
		`project_id`
	)
	VALUES (
		NEW.`user_id`,
		'task',
		NEW.`id`,
		CASE WHEN NEW.`deleted_at` IS NULL THEN 'task_restored' ELSE 'task_deleted' END,
		NEW.`project_id`
	);
END;
--> statement-breakpoint
CREATE TRIGGER `analytics_habits_after_insert`
AFTER INSERT ON `habits`
WHEN NEW.`user_id` IS NOT NULL
BEGIN
	INSERT INTO `analytics_events` (
		`user_id`,
		`entity_type`,
		`entity_id`,
		`event_type`,
		`next_value`,
		`created_at`
	)
	VALUES (
		NEW.`user_id`,
		'habit',
		NEW.`id`,
		'habit_created',
		NEW.`frequency` || ':' || NEW.`target_per_day`,
		NEW.`created_at`
	);
END;
--> statement-breakpoint
CREATE TRIGGER `analytics_habits_owner_after_update`
AFTER UPDATE OF `user_id` ON `habits`
WHEN OLD.`user_id` IS NULL AND NEW.`user_id` IS NOT NULL
BEGIN
	INSERT INTO `analytics_events` (
		`user_id`,
		`entity_type`,
		`entity_id`,
		`event_type`,
		`next_value`,
		`created_at`
	)
	VALUES (
		NEW.`user_id`,
		'habit',
		NEW.`id`,
		'habit_created',
		NEW.`frequency` || ':' || NEW.`target_per_day`,
		NEW.`created_at`
	);
END;
--> statement-breakpoint
CREATE TRIGGER `analytics_habit_logs_after_insert`
AFTER INSERT ON `habit_logs`
BEGIN
	INSERT INTO `analytics_events` (
		`user_id`,
		`entity_type`,
		`entity_id`,
		`event_type`,
		`effective_date`,
		`next_value`
	)
	SELECT
		`habits`.`user_id`,
		'habit',
		NEW.`habit_id`,
		CASE WHEN NEW.`completed` = 1 THEN 'habit_completed' ELSE 'habit_uncompleted' END,
		NEW.`date`,
		CAST(NEW.`count` AS TEXT)
	FROM `habits`
	WHERE `habits`.`id` = NEW.`habit_id` AND `habits`.`user_id` IS NOT NULL;
END;
--> statement-breakpoint
CREATE TRIGGER `analytics_habit_logs_after_update`
AFTER UPDATE OF `completed`, `count` ON `habit_logs`
WHEN OLD.`completed` IS NOT NEW.`completed` OR OLD.`count` IS NOT NEW.`count`
BEGIN
	INSERT INTO `analytics_events` (
		`user_id`,
		`entity_type`,
		`entity_id`,
		`event_type`,
		`effective_date`,
		`previous_value`,
		`next_value`
	)
	SELECT
		`habits`.`user_id`,
		'habit',
		NEW.`habit_id`,
		CASE WHEN NEW.`completed` = 1 THEN 'habit_completed' ELSE 'habit_uncompleted' END,
		NEW.`date`,
		CAST(OLD.`count` AS TEXT),
		CAST(NEW.`count` AS TEXT)
	FROM `habits`
	WHERE `habits`.`id` = NEW.`habit_id` AND `habits`.`user_id` IS NOT NULL;
END;
--> statement-breakpoint
CREATE TRIGGER `analytics_time_entries_after_insert`
AFTER INSERT ON `time_entries`
WHEN
	NEW.`user_id` IS NOT NULL
	AND NEW.`end_time` IS NOT NULL
	AND NEW.`duration` IS NOT NULL
BEGIN
	INSERT INTO `analytics_events` (
		`user_id`,
		`entity_type`,
		`entity_id`,
		`event_type`,
		`effective_date`,
		`project_id`,
		`duration_seconds`,
		`created_at`
	)
	VALUES (
		NEW.`user_id`,
		'focus',
		NEW.`id`,
		'focus_completed',
		strftime('%Y-%m-%d', NEW.`end_time` / 1000, 'unixepoch'),
		NEW.`project_id`,
		NEW.`duration`,
		NEW.`end_time`
	);
END;
--> statement-breakpoint
CREATE TRIGGER `analytics_time_entries_owner_after_update`
AFTER UPDATE OF `user_id` ON `time_entries`
WHEN
	OLD.`user_id` IS NULL
	AND NEW.`user_id` IS NOT NULL
	AND NEW.`end_time` IS NOT NULL
	AND NEW.`duration` IS NOT NULL
BEGIN
	INSERT INTO `analytics_events` (
		`user_id`,
		`entity_type`,
		`entity_id`,
		`event_type`,
		`effective_date`,
		`project_id`,
		`duration_seconds`,
		`created_at`
	)
	VALUES (
		NEW.`user_id`,
		'focus',
		NEW.`id`,
		'focus_completed',
		strftime('%Y-%m-%d', NEW.`end_time` / 1000, 'unixepoch'),
		NEW.`project_id`,
		NEW.`duration`,
		NEW.`end_time`
	);
END;
--> statement-breakpoint
CREATE TRIGGER `analytics_time_entries_after_update`
AFTER UPDATE OF `end_time`, `duration` ON `time_entries`
WHEN
	NEW.`user_id` IS NOT NULL
	AND OLD.`end_time` IS NULL
	AND NEW.`end_time` IS NOT NULL
	AND NEW.`duration` IS NOT NULL
BEGIN
	INSERT INTO `analytics_events` (
		`user_id`,
		`entity_type`,
		`entity_id`,
		`event_type`,
		`effective_date`,
		`project_id`,
		`duration_seconds`,
		`created_at`
	)
	VALUES (
		NEW.`user_id`,
		'focus',
		NEW.`id`,
		'focus_completed',
		strftime('%Y-%m-%d', NEW.`end_time` / 1000, 'unixepoch'),
		NEW.`project_id`,
		NEW.`duration`,
		NEW.`end_time`
	);
END;
