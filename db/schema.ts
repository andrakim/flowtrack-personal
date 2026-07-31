import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`);

export const users = sqliteTable(
  "users",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    role: text("role", { enum: ["owner", "member"] })
      .notNull()
      .default("member"),
    createdAt: createdAt(),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    uniqueIndex("users_email_unique").on(table.email),
    index("users_last_seen_idx").on(table.lastSeenAt),
  ],
);

export const workspaces = sqliteTable(
  "workspaces",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    description: text("description"),
    kind: text("kind", { enum: ["family", "team", "work", "other"] })
      .notNull()
      .default("team"),
    color: text("color").notNull().default("#6366f1"),
    ownerUserId: integer("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    archived: integer("archived", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    index("workspaces_owner_created_idx").on(
      table.ownerUserId,
      table.createdAt,
    ),
    index("workspaces_archived_updated_idx").on(
      table.archived,
      table.updatedAt,
    ),
  ],
);

export const workspaceMembers = sqliteTable(
  "workspace_members",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "admin", "member", "viewer"] })
      .notNull()
      .default("member"),
    joinedAt: integer("joined_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    uniqueIndex("workspace_members_workspace_user_unique").on(
      table.workspaceId,
      table.userId,
    ),
    index("workspace_members_user_workspace_idx").on(
      table.userId,
      table.workspaceId,
    ),
  ],
);

export const workspaceInvites = sqliteTable(
  "workspace_invites",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role", { enum: ["admin", "member", "viewer"] })
      .notNull()
      .default("member"),
    token: text("token").notNull(),
    status: text("status", {
      enum: ["pending", "accepted", "declined", "revoked"],
    })
      .notNull()
      .default("pending"),
    invitedByUserId: integer("invited_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: createdAt(),
    respondedAt: integer("responded_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    uniqueIndex("workspace_invites_workspace_email_unique").on(
      table.workspaceId,
      table.email,
    ),
    uniqueIndex("workspace_invites_token_unique").on(table.token),
    index("workspace_invites_email_status_idx").on(table.email, table.status),
  ],
);

export const workspaceActivity = sqliteTable(
  "workspace_activity",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    actorUserId: integer("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    action: text("action").notNull(),
    entityType: text("entity_type"),
    entityId: integer("entity_id"),
    summary: text("summary").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index("workspace_activity_workspace_created_idx").on(
      table.workspaceId,
      table.createdAt,
    ),
  ],
);

export const projects = sqliteTable(
  "projects",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    workspaceId: integer("workspace_id").references(() => workspaces.id, {
      onDelete: "cascade",
    }),
    createdByUserId: integer("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    description: text("description"),
    color: text("color").notNull().default("#6366f1"),
    status: text("status", { enum: ["active", "completed"] })
      .notNull()
      .default("active"),
    archived: integer("archived", { mode: "boolean" }).notNull().default(false),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
  },
  (table) => [
    index("projects_user_created_idx").on(table.userId, table.createdAt),
    index("projects_workspace_created_idx").on(
      table.workspaceId,
      table.createdAt,
    ),
    index("projects_archived_created_idx").on(table.archived, table.createdAt),
  ],
);

export const habits = sqliteTable(
  "habits",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    title: text("title").notNull(),
    description: text("description"),
    color: text("color").notNull().default("#6366f1"),
    icon: text("icon").notNull().default("star"),
    frequency: text("frequency", { enum: ["daily", "weekdays", "weekly"] })
      .notNull()
      .default("daily"),
    targetPerDay: integer("target_per_day").notNull().default(1),
    order: integer("order").notNull().default(0),
    archived: integer("archived", { mode: "boolean" }).notNull().default(false),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
  },
  (table) => [
    index("habits_user_order_idx").on(table.userId, table.order),
    index("habits_archived_order_idx").on(table.archived, table.order),
  ],
);

export const habitLogs = sqliteTable(
  "habit_logs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    habitId: integer("habit_id")
      .notNull()
      .references(() => habits.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    completed: integer("completed", { mode: "boolean" }).notNull().default(true),
    count: integer("count").notNull().default(1),
    note: text("note"),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("habit_logs_habit_date_unique").on(table.habitId, table.date),
    index("habit_logs_date_idx").on(table.date),
  ],
);

export const tasks = sqliteTable(
  "tasks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    workspaceId: integer("workspace_id").references(() => workspaces.id, {
      onDelete: "cascade",
    }),
    createdByUserId: integer("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    assigneeUserId: integer("assignee_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status", { enum: ["todo", "doing", "done"] })
      .notNull()
      .default("todo"),
    priority: text("priority", { enum: ["low", "medium", "high"] })
      .notNull()
      .default("medium"),
    dueDate: text("due_date"),
    dueTime: text("due_time"),
    estimatedMinutes: integer("estimated_minutes"),
    actualMinutes: integer("actual_minutes"),
    projectId: integer("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    kanbanColumnId: integer("kanban_column_id").references(
      () => kanbanColumns.id,
      {
        onDelete: "set null",
      },
    ),
    kanbanOrder: integer("kanban_order").notNull().default(0),
    inbox: integer("inbox", { mode: "boolean" }).notNull().default(false),
    recurrence: text("recurrence", {
      enum: ["none", "daily", "weekdays", "weekly", "monthly"],
    })
      .notNull()
      .default("none"),
    legacyCardId: integer("legacy_card_id"),
    tags: text("tags", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    createdAt: createdAt(),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("tasks_user_due_idx").on(table.userId, table.dueDate),
    index("tasks_workspace_due_idx").on(table.workspaceId, table.dueDate),
    index("tasks_assignee_status_idx").on(
      table.assigneeUserId,
      table.status,
    ),
    index("tasks_due_status_idx").on(table.dueDate, table.status),
    index("tasks_project_idx").on(table.projectId),
    index("tasks_kanban_column_order_idx").on(
      table.kanbanColumnId,
      table.kanbanOrder,
    ),
    index("tasks_inbox_deleted_idx").on(table.inbox, table.deletedAt),
    uniqueIndex("tasks_legacy_card_unique").on(table.legacyCardId),
  ],
);

export const kanbanColumns = sqliteTable(
  "kanban_columns",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    order: integer("order").notNull().default(0),
    color: text("color").notNull().default("#e5e7eb"),
    createdAt: createdAt(),
  },
  (table) => [
    index("kanban_columns_project_order_idx").on(table.projectId, table.order),
  ],
);

export const kanbanCards = sqliteTable(
  "kanban_cards",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    columnId: integer("column_id")
      .notNull()
      .references(() => kanbanColumns.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    priority: text("priority", { enum: ["low", "medium", "high"] })
      .notNull()
      .default("medium"),
    tags: text("tags", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    order: integer("order").notNull().default(0),
    dueDate: text("due_date"),
    createdAt: createdAt(),
  },
  (table) => [
    index("kanban_cards_column_order_idx").on(table.columnId, table.order),
  ],
);

export const timeEntries = sqliteTable(
  "time_entries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    title: text("title").notNull(),
    projectId: integer("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    taskId: integer("task_id").references(() => tasks.id, {
      onDelete: "set null",
    }),
    startTime: integer("start_time", { mode: "timestamp_ms" }).notNull(),
    endTime: integer("end_time", { mode: "timestamp_ms" }),
    duration: integer("duration"),
    description: text("description"),
    createdAt: createdAt(),
  },
  (table) => [
    index("time_entries_user_start_idx").on(table.userId, table.startTime),
    index("time_entries_end_start_idx").on(table.endTime, table.startTime),
  ],
);

export const pomodoroState = sqliteTable(
  "pomodoro_state",
  {
    id: integer("id").primaryKey(),
    userId: integer("user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    phase: text("phase", {
      enum: ["focus", "short_break", "long_break"],
    })
      .notNull()
      .default("focus"),
    active: integer("active", { mode: "boolean" }).notNull().default(false),
    running: integer("running", { mode: "boolean" }).notNull().default(false),
    cycle: integer("cycle").notNull().default(0),
    focusMinutes: integer("focus_minutes").notNull().default(25),
    shortBreakMinutes: integer("short_break_minutes").notNull().default(5),
    longBreakMinutes: integer("long_break_minutes").notNull().default(15),
    cyclesBeforeLong: integer("cycles_before_long").notNull().default(4),
    autoStartBreak: integer("auto_start_break", { mode: "boolean" })
      .notNull()
      .default(false),
    autoStartFocus: integer("auto_start_focus", { mode: "boolean" })
      .notNull()
      .default(false),
    title: text("title").notNull().default("Фокус-сессия"),
    projectId: integer("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    taskId: integer("task_id").references(() => tasks.id, {
      onDelete: "set null",
    }),
    startedAt: integer("started_at", { mode: "timestamp_ms" }),
    endsAt: integer("ends_at", { mode: "timestamp_ms" }),
    remainingSeconds: integer("remaining_seconds").notNull().default(1500),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    uniqueIndex("pomodoro_state_user_unique").on(table.userId),
  ],
);

export const notes = sqliteTable(
  "notes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    title: text("title").notNull(),
    content: text("content").notNull().default(""),
    color: text("color").notNull().default("#fef3c7"),
    pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
    tags: text("tags", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    order: integer("order").notNull().default(0),
    createdAt: createdAt(),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    index("notes_user_updated_idx").on(table.userId, table.updatedAt),
    index("notes_pinned_order_idx").on(
      table.pinned,
      table.order,
      table.updatedAt,
    ),
  ],
);

export const goals = sqliteTable(
  "goals",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    title: text("title").notNull(),
    description: text("description"),
    category: text("category").notNull().default("personal"),
    targetValue: integer("target_value"),
    currentValue: integer("current_value").notNull().default(0),
    unit: text("unit"),
    deadline: text("deadline"),
    status: text("status", { enum: ["active", "completed"] })
      .notNull()
      .default("active"),
    color: text("color").notNull().default("#10b981"),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
  },
  (table) => [
    index("goals_user_deadline_idx").on(table.userId, table.deadline),
    index("goals_status_deadline_idx").on(table.status, table.deadline),
  ],
);

export const importBatches = sqliteTable(
  "import_batches",
  {
    id: text("id").primaryKey(),
    userId: integer("user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    title: text("title").notNull(),
    source: text("source").notNull().default("flowtrack-plan"),
    counts: text("counts", { mode: "json" })
      .$type<Record<string, number>>()
      .notNull()
      .default(sql`'{}'`),
    createdAt: createdAt(),
  },
  (table) => [
    index("import_batches_user_created_idx").on(table.userId, table.createdAt),
    index("import_batches_created_idx").on(table.createdAt),
  ],
);

export const importRecords = sqliteTable(
  "import_records",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    batchId: text("batch_id")
      .notNull()
      .references(() => importBatches.id, { onDelete: "cascade" }),
    entityType: text("entity_type", {
      enum: ["project", "column", "task", "habit", "note", "goal"],
    }).notNull(),
    recordId: integer("record_id").notNull(),
  },
  (table) => [
    index("import_records_batch_idx").on(table.batchId),
    index("import_records_entity_idx").on(table.entityType, table.recordId),
  ],
);

export const analyticsTracking = sqliteTable("analytics_tracking", {
  userId: integer("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  startedAt: integer("started_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const analyticsEvents = sqliteTable(
  "analytics_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    entityType: text("entity_type", {
      enum: ["task", "habit", "focus", "project"],
    }).notNull(),
    entityId: integer("entity_id").notNull(),
    eventType: text("event_type", {
      enum: [
        "task_created",
        "task_completed",
        "task_reopened",
        "task_rescheduled",
        "task_deleted",
        "task_restored",
        "habit_created",
        "habit_completed",
        "habit_uncompleted",
        "focus_completed",
      ],
    }).notNull(),
    effectiveDate: text("effective_date"),
    projectId: integer("project_id"),
    durationSeconds: integer("duration_seconds"),
    previousValue: text("previous_value"),
    nextValue: text("next_value"),
    createdAt: createdAt(),
  },
  (table) => [
    index("analytics_events_user_created_idx").on(
      table.userId,
      table.createdAt,
    ),
    index("analytics_events_user_type_created_idx").on(
      table.userId,
      table.eventType,
      table.createdAt,
    ),
    index("analytics_events_entity_idx").on(
      table.entityType,
      table.entityId,
      table.createdAt,
    ),
    index("analytics_events_effective_date_idx").on(table.effectiveDate),
  ],
);
