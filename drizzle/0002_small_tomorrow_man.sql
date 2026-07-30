CREATE TABLE `import_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`source` text DEFAULT 'flowtrack-plan' NOT NULL,
	`counts` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `import_batches_created_idx` ON `import_batches` (`created_at`);--> statement-breakpoint
CREATE TABLE `import_records` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`batch_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`record_id` integer NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `import_batches`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `import_records_batch_idx` ON `import_records` (`batch_id`);--> statement-breakpoint
CREATE INDEX `import_records_entity_idx` ON `import_records` (`entity_type`,`record_id`);--> statement-breakpoint
ALTER TABLE `goals` ADD `deleted_at` integer;--> statement-breakpoint
ALTER TABLE `habits` ADD `deleted_at` integer;--> statement-breakpoint
ALTER TABLE `notes` ADD `deleted_at` integer;--> statement-breakpoint
ALTER TABLE `projects` ADD `deleted_at` integer;--> statement-breakpoint
ALTER TABLE `tasks` ADD `kanban_column_id` integer REFERENCES kanban_columns(id);--> statement-breakpoint
ALTER TABLE `tasks` ADD `kanban_order` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `inbox` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `recurrence` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `legacy_card_id` integer;--> statement-breakpoint
ALTER TABLE `tasks` ADD `deleted_at` integer;--> statement-breakpoint
CREATE INDEX `tasks_kanban_column_order_idx` ON `tasks` (`kanban_column_id`,`kanban_order`);--> statement-breakpoint
CREATE INDEX `tasks_inbox_deleted_idx` ON `tasks` (`inbox`,`deleted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `tasks_legacy_card_unique` ON `tasks` (`legacy_card_id`);--> statement-breakpoint
INSERT INTO `tasks` (
	`title`,
	`description`,
	`status`,
	`priority`,
	`due_date`,
	`project_id`,
	`kanban_column_id`,
	`kanban_order`,
	`inbox`,
	`recurrence`,
	`legacy_card_id`,
	`tags`,
	`created_at`
)
SELECT
	card.`title`,
	card.`description`,
	CASE
		WHEN column_row.`order` = (
			SELECT MAX(last_column.`order`)
			FROM `kanban_columns` AS last_column
			WHERE last_column.`project_id` = column_row.`project_id`
		) AND column_row.`order` > 0 THEN 'done'
		WHEN column_row.`order` > 0 THEN 'doing'
		ELSE 'todo'
	END,
	card.`priority`,
	card.`due_date`,
	column_row.`project_id`,
	card.`column_id`,
	card.`order`,
	false,
	'none',
	card.`id`,
	card.`tags`,
	card.`created_at`
FROM `kanban_cards` AS card
JOIN `kanban_columns` AS column_row ON column_row.`id` = card.`column_id`
WHERE NOT EXISTS (
	SELECT 1 FROM `tasks` WHERE `tasks`.`legacy_card_id` = card.`id`
);--> statement-breakpoint
UPDATE `tasks`
SET
	`kanban_column_id` = CASE
		WHEN `tasks`.`status` = 'done' THEN (
			SELECT column_row.`id`
			FROM `kanban_columns` AS column_row
			WHERE column_row.`project_id` = `tasks`.`project_id`
			ORDER BY column_row.`order` DESC, column_row.`id` DESC
			LIMIT 1
		)
		WHEN `tasks`.`status` = 'doing' THEN COALESCE(
			(
				SELECT column_row.`id`
				FROM `kanban_columns` AS column_row
				WHERE column_row.`project_id` = `tasks`.`project_id`
					AND column_row.`order` > 0
				ORDER BY column_row.`order` ASC, column_row.`id` ASC
				LIMIT 1
			),
			(
				SELECT column_row.`id`
				FROM `kanban_columns` AS column_row
				WHERE column_row.`project_id` = `tasks`.`project_id`
				ORDER BY column_row.`order` ASC, column_row.`id` ASC
				LIMIT 1
			)
		)
		ELSE (
			SELECT column_row.`id`
			FROM `kanban_columns` AS column_row
			WHERE column_row.`project_id` = `tasks`.`project_id`
			ORDER BY column_row.`order` ASC, column_row.`id` ASC
			LIMIT 1
		)
	END,
	`kanban_order` = `tasks`.`id`
WHERE `tasks`.`project_id` IS NOT NULL
	AND `tasks`.`kanban_column_id` IS NULL;
