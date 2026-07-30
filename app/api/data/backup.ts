import { desc, eq, inArray } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { getDb } from "@/db";
import {
  analyticsEvents,
  analyticsTracking,
  goals,
  habitLogs,
  habits,
  importBatches,
  importRecords,
  kanbanCards,
  kanbanColumns,
  notes,
  pomodoroState,
  projects,
  tasks,
  timeEntries,
} from "@/db/schema";

type Payload = Record<string, unknown>;
type FlowDb = Awaited<ReturnType<typeof getDb>>;

const LIMITS = {
  projects: 1_000,
  habits: 1_000,
  habitLogs: 25_000,
  tasks: 10_000,
  columns: 5_000,
  cards: 25_000,
  timeEntries: 25_000,
  notes: 10_000,
  goals: 5_000,
} as const;

function recordFrom(value: unknown, label: string): Payload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Раздел «${label}» имеет неверный формат`);
  }
  return value as Payload;
}

function arrayFrom(data: Payload, key: keyof typeof LIMITS) {
  const value = data[key];
  if (!Array.isArray(value)) {
    throw new Error(`В резервной копии отсутствует раздел «${key}»`);
  }
  if (value.length > LIMITS[key]) {
    throw new Error(`Раздел «${key}» слишком большой`);
  }
  return value.map((item, index) =>
    recordFrom(item, `${key}[${index}]`),
  );
}

function integerFrom(
  value: unknown,
  label: string,
  min = 0,
  max = 1_000_000_000,
) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`Некорректное число: ${label}`);
  }
  return parsed;
}

const MAX_GOAL_VALUE = 1_000_000_000_000;

function idFrom(row: Payload, label: string) {
  return integerFrom(row.id, `${label}.id`, 1);
}

function optionalId(value: unknown, label: string) {
  if (value === null || value === undefined || value === "") return null;
  return integerFrom(value, label, 1);
}

function textFrom(
  value: unknown,
  label: string,
  max: number,
  required = false,
) {
  const text = String(value ?? "").trim();
  if (required && !text) throw new Error(`Поле «${label}» обязательно`);
  if (text.length > max) throw new Error(`Поле «${label}» слишком длинное`);
  return text;
}

function nullableText(value: unknown, label: string, max: number) {
  const text = textFrom(value, label, max);
  return text || null;
}

function dateFrom(value: unknown, label: string, fallback?: Date) {
  if (value === null || value === undefined || value === "") {
    if (fallback) return fallback;
    throw new Error(`В резервной копии отсутствует дата «${label}»`);
  }
  const parsed = new Date(
    typeof value === "number" ? value : String(value),
  );
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Некорректная дата: ${label}`);
  }
  return parsed;
}

function optionalDateFrom(value: unknown, label: string) {
  if (value === null || value === undefined || value === "") return null;
  return dateFrom(value, label);
}

function dateKeyFrom(value: unknown, label: string) {
  const text = textFrom(value, label, 10, true);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new Error(`Некорректная дата: ${label}`);
  }
  return text;
}

function timeKeyFrom(value: unknown, label: string) {
  if (value === null || value === undefined || value === "") return null;
  const text = textFrom(value, label, 5, true);
  if (!/^\d{2}:\d{2}$/.test(text)) {
    throw new Error(`Некорректное время: ${label}`);
  }
  return text;
}

function colorFrom(value: unknown, fallback: string) {
  const text = String(value ?? "");
  return /^#[0-9a-f]{6}$/i.test(text) ? text : fallback;
}

function enumFrom<const T extends readonly string[]>(
  value: unknown,
  label: string,
  values: T,
  fallback: T[number],
) {
  const text = String(value ?? "");
  if (!text) return fallback;
  if (!(values as readonly string[]).includes(text)) {
    throw new Error(`Некорректное значение: ${label}`);
  }
  return text as T[number];
}

function tagsFrom(value: unknown, label: string) {
  if (!Array.isArray(value)) {
    if (value === null || value === undefined || value === "") return [];
    throw new Error(`Некорректные теги: ${label}`);
  }
  return [
    ...new Set(
      value
        .map((item) => textFrom(item, label, 40))
        .filter(Boolean),
    ),
  ].slice(0, 20);
}

function ensureUniqueIds(rows: Array<{ id: number }>, label: string) {
  if (new Set(rows.map((row) => row.id)).size !== rows.length) {
    throw new Error(`В разделе «${label}» повторяются идентификаторы`);
  }
}

function requireReference(
  value: number | null,
  values: Set<number>,
  label: string,
) {
  if (value !== null && !values.has(value)) {
    throw new Error(`Связь «${label}» указывает на отсутствующую запись`);
  }
}

function normalizeBackup(backupValue: unknown) {
  const backup = recordFrom(backupValue, "backup");
  if (backup.format !== "flowtrack-backup") {
    throw new Error("Это не резервная копия FlowTrack");
  }
  const schemaVersion = integerFrom(
    backup.schemaVersion,
    "schemaVersion",
    1,
    2,
  );
  const data = recordFrom(backup.data, "data");
  const now = new Date();

  const projectRows: Array<typeof projects.$inferInsert> = arrayFrom(
    data,
    "projects",
  ).map((row, index) => ({
    id: idFrom(row, `projects[${index}]`),
    title: textFrom(row.title, `projects[${index}].title`, 255, true),
    description: nullableText(
      row.description,
      `projects[${index}].description`,
      4_000,
    ),
    color: colorFrom(row.color, "#6366f1"),
    status: enumFrom(
      row.status,
      `projects[${index}].status`,
      ["active", "completed"] as const,
      "active",
    ),
    archived: Boolean(row.archived),
    deletedAt: optionalDateFrom(
      row.deletedAt,
      `projects[${index}].deletedAt`,
    ),
    createdAt: dateFrom(row.createdAt, `projects[${index}].createdAt`, now),
  }));

  const habitRows: Array<typeof habits.$inferInsert> = arrayFrom(
    data,
    "habits",
  ).map((row, index) => ({
    id: idFrom(row, `habits[${index}]`),
    title: textFrom(row.title, `habits[${index}].title`, 255, true),
    description: nullableText(
      row.description,
      `habits[${index}].description`,
      4_000,
    ),
    color: colorFrom(row.color, "#6366f1"),
    icon: textFrom(row.icon, `habits[${index}].icon`, 30) || "star",
    frequency: enumFrom(
      row.frequency,
      `habits[${index}].frequency`,
      ["daily", "weekdays", "weekly"] as const,
      "daily",
    ),
    targetPerDay: integerFrom(
      row.targetPerDay ?? 1,
      `habits[${index}].targetPerDay`,
      1,
      99,
    ),
    order: integerFrom(row.order ?? index, `habits[${index}].order`, 0, 10_000),
    archived: Boolean(row.archived),
    deletedAt: optionalDateFrom(
      row.deletedAt,
      `habits[${index}].deletedAt`,
    ),
    createdAt: dateFrom(row.createdAt, `habits[${index}].createdAt`, now),
  }));

  const taskRows: Array<typeof tasks.$inferInsert> = arrayFrom(
    data,
    "tasks",
  ).map((row, index) => ({
    id: idFrom(row, `tasks[${index}]`),
    title: textFrom(row.title, `tasks[${index}].title`, 255, true),
    description: nullableText(
      row.description,
      `tasks[${index}].description`,
      4_000,
    ),
    status: enumFrom(
      row.status,
      `tasks[${index}].status`,
      ["todo", "doing", "done"] as const,
      "todo",
    ),
    priority: enumFrom(
      row.priority,
      `tasks[${index}].priority`,
      ["low", "medium", "high"] as const,
      "medium",
    ),
    dueDate:
      row.dueDate === null || row.dueDate === undefined || row.dueDate === ""
        ? null
        : dateKeyFrom(row.dueDate, `tasks[${index}].dueDate`),
    dueTime: timeKeyFrom(row.dueTime, `tasks[${index}].dueTime`),
    estimatedMinutes:
      row.estimatedMinutes === null || row.estimatedMinutes === undefined
        ? null
        : integerFrom(
            row.estimatedMinutes,
            `tasks[${index}].estimatedMinutes`,
            1,
            100_000,
          ),
    actualMinutes:
      row.actualMinutes === null || row.actualMinutes === undefined
        ? null
        : integerFrom(
            row.actualMinutes,
            `tasks[${index}].actualMinutes`,
            0,
            1_000_000,
          ),
    projectId: optionalId(row.projectId, `tasks[${index}].projectId`),
    kanbanColumnId: optionalId(
      row.kanbanColumnId,
      `tasks[${index}].kanbanColumnId`,
    ),
    kanbanOrder: integerFrom(
      row.kanbanOrder ?? index,
      `tasks[${index}].kanbanOrder`,
      0,
      1_000_000,
    ),
    inbox: Boolean(row.inbox),
    recurrence: enumFrom(
      row.recurrence,
      `tasks[${index}].recurrence`,
      ["none", "daily", "weekdays", "weekly", "monthly"] as const,
      "none",
    ),
    legacyCardId: optionalId(
      row.legacyCardId,
      `tasks[${index}].legacyCardId`,
    ),
    tags: tagsFrom(row.tags, `tasks[${index}].tags`),
    createdAt: dateFrom(row.createdAt, `tasks[${index}].createdAt`, now),
    completedAt: optionalDateFrom(
      row.completedAt,
      `tasks[${index}].completedAt`,
    ),
    deletedAt: optionalDateFrom(
      row.deletedAt,
      `tasks[${index}].deletedAt`,
    ),
  }));

  const columnRows: Array<typeof kanbanColumns.$inferInsert> = arrayFrom(
    data,
    "columns",
  ).map((row, index) => ({
    id: idFrom(row, `columns[${index}]`),
    projectId: integerFrom(
      row.projectId,
      `columns[${index}].projectId`,
      1,
    ),
    title: textFrom(row.title, `columns[${index}].title`, 255, true),
    order: integerFrom(row.order ?? index, `columns[${index}].order`, 0, 10_000),
    color: colorFrom(row.color, "#e5e7eb"),
    createdAt: dateFrom(row.createdAt, `columns[${index}].createdAt`, now),
  }));

  const cardRows: Array<typeof kanbanCards.$inferInsert> =
    schemaVersion === 1
      ? arrayFrom(data, "cards").map((row, index) => ({
          id: idFrom(row, `cards[${index}]`),
          columnId: integerFrom(
            row.columnId,
            `cards[${index}].columnId`,
            1,
          ),
          title: textFrom(row.title, `cards[${index}].title`, 255, true),
          description: nullableText(
            row.description,
            `cards[${index}].description`,
            4_000,
          ),
          priority: enumFrom(
            row.priority,
            `cards[${index}].priority`,
            ["low", "medium", "high"] as const,
            "medium",
          ),
          tags: tagsFrom(row.tags, `cards[${index}].tags`),
          order: integerFrom(
            row.order ?? index,
            `cards[${index}].order`,
            0,
            10_000,
          ),
          dueDate:
            row.dueDate === null ||
            row.dueDate === undefined ||
            row.dueDate === ""
              ? null
              : dateKeyFrom(row.dueDate, `cards[${index}].dueDate`),
          createdAt: dateFrom(
            row.createdAt,
            `cards[${index}].createdAt`,
            now,
          ),
        }))
      : [];

  const logRows: Array<typeof habitLogs.$inferInsert> = arrayFrom(
    data,
    "habitLogs",
  ).map((row, index) => ({
    id: idFrom(row, `habitLogs[${index}]`),
    habitId: integerFrom(
      row.habitId,
      `habitLogs[${index}].habitId`,
      1,
    ),
    date: dateKeyFrom(row.date, `habitLogs[${index}].date`),
    completed: Boolean(row.completed),
    count: integerFrom(row.count ?? 0, `habitLogs[${index}].count`, 0, 99),
    note: nullableText(row.note, `habitLogs[${index}].note`, 1_000),
    createdAt: dateFrom(row.createdAt, `habitLogs[${index}].createdAt`, now),
  }));

  const timeRows: Array<typeof timeEntries.$inferInsert> = arrayFrom(
    data,
    "timeEntries",
  ).map((row, index) => ({
    id: idFrom(row, `timeEntries[${index}]`),
    title: textFrom(row.title, `timeEntries[${index}].title`, 255, true),
    projectId: optionalId(
      row.projectId,
      `timeEntries[${index}].projectId`,
    ),
    taskId: optionalId(row.taskId, `timeEntries[${index}].taskId`),
    startTime: dateFrom(
      row.startTime,
      `timeEntries[${index}].startTime`,
    ),
    endTime: optionalDateFrom(
      row.endTime,
      `timeEntries[${index}].endTime`,
    ),
    duration:
      row.duration === null || row.duration === undefined
        ? null
        : integerFrom(
            row.duration,
            `timeEntries[${index}].duration`,
            0,
            100_000_000,
          ),
    description: nullableText(
      row.description,
      `timeEntries[${index}].description`,
      4_000,
    ),
    createdAt: dateFrom(
      row.createdAt,
      `timeEntries[${index}].createdAt`,
      now,
    ),
  }));

  const noteRows: Array<typeof notes.$inferInsert> = arrayFrom(
    data,
    "notes",
  ).map((row, index) => ({
    id: idFrom(row, `notes[${index}]`),
    title: textFrom(row.title, `notes[${index}].title`, 255, true),
    content: textFrom(row.content, `notes[${index}].content`, 100_000),
    color: colorFrom(row.color, "#fef3c7"),
    pinned: Boolean(row.pinned),
    tags: tagsFrom(row.tags, `notes[${index}].tags`),
    order: integerFrom(row.order ?? index, `notes[${index}].order`, 0, 10_000),
    createdAt: dateFrom(row.createdAt, `notes[${index}].createdAt`, now),
    deletedAt: optionalDateFrom(
      row.deletedAt,
      `notes[${index}].deletedAt`,
    ),
    updatedAt: dateFrom(row.updatedAt, `notes[${index}].updatedAt`, now),
  }));

  const goalRows: Array<typeof goals.$inferInsert> = arrayFrom(
    data,
    "goals",
  ).map((row, index) => ({
    id: idFrom(row, `goals[${index}]`),
    title: textFrom(row.title, `goals[${index}].title`, 255, true),
    description: nullableText(
      row.description,
      `goals[${index}].description`,
      4_000,
    ),
    category: textFrom(row.category, `goals[${index}].category`, 60) || "personal",
    targetValue:
      row.targetValue === null || row.targetValue === undefined
        ? null
        : integerFrom(
            row.targetValue,
            `goals[${index}].targetValue`,
            1,
            MAX_GOAL_VALUE,
          ),
    currentValue: integerFrom(
      row.currentValue ?? 0,
      `goals[${index}].currentValue`,
      0,
      MAX_GOAL_VALUE,
    ),
    unit: nullableText(row.unit, `goals[${index}].unit`, 40),
    deadline:
      row.deadline === null || row.deadline === undefined || row.deadline === ""
        ? null
        : dateKeyFrom(row.deadline, `goals[${index}].deadline`),
    status: enumFrom(
      row.status,
      `goals[${index}].status`,
      ["active", "completed"] as const,
      "active",
    ),
    color: colorFrom(row.color, "#10b981"),
    deletedAt: optionalDateFrom(
      row.deletedAt,
      `goals[${index}].deletedAt`,
    ),
    createdAt: dateFrom(row.createdAt, `goals[${index}].createdAt`, now),
  }));

  const pomodoroValue =
    data.pomodoro === null || data.pomodoro === undefined
      ? null
      : recordFrom(data.pomodoro, "pomodoro");
  const pomodoroRow: typeof pomodoroState.$inferInsert | null = pomodoroValue
    ? {
        id: 1,
        phase: enumFrom(
          pomodoroValue.phase,
          "pomodoro.phase",
          ["focus", "short_break", "long_break"] as const,
          "focus",
        ),
        active: Boolean(pomodoroValue.active),
        running: Boolean(pomodoroValue.running),
        cycle: integerFrom(pomodoroValue.cycle ?? 0, "pomodoro.cycle", 0, 100_000),
        focusMinutes: integerFrom(
          pomodoroValue.focusMinutes ?? 25,
          "pomodoro.focusMinutes",
          1,
          180,
        ),
        shortBreakMinutes: integerFrom(
          pomodoroValue.shortBreakMinutes ?? 5,
          "pomodoro.shortBreakMinutes",
          1,
          60,
        ),
        longBreakMinutes: integerFrom(
          pomodoroValue.longBreakMinutes ?? 15,
          "pomodoro.longBreakMinutes",
          1,
          120,
        ),
        cyclesBeforeLong: integerFrom(
          pomodoroValue.cyclesBeforeLong ?? 4,
          "pomodoro.cyclesBeforeLong",
          2,
          12,
        ),
        autoStartBreak: Boolean(pomodoroValue.autoStartBreak),
        autoStartFocus: Boolean(pomodoroValue.autoStartFocus),
        title:
          textFrom(pomodoroValue.title, "pomodoro.title", 255) ||
          "Фокус-сессия",
        projectId: optionalId(
          pomodoroValue.projectId,
          "pomodoro.projectId",
        ),
        taskId: optionalId(pomodoroValue.taskId, "pomodoro.taskId"),
        startedAt: optionalDateFrom(
          pomodoroValue.startedAt,
          "pomodoro.startedAt",
        ),
        endsAt: optionalDateFrom(pomodoroValue.endsAt, "pomodoro.endsAt"),
        remainingSeconds: integerFrom(
          pomodoroValue.remainingSeconds ?? 1500,
          "pomodoro.remainingSeconds",
          0,
          86_400,
        ),
        updatedAt: dateFrom(
          pomodoroValue.updatedAt,
          "pomodoro.updatedAt",
          now,
        ),
      }
    : null;

  const columnsByProject = new Map<
    number,
    Array<typeof kanbanColumns.$inferInsert>
  >();
  columnRows.forEach((column) => {
    const values = columnsByProject.get(column.projectId) ?? [];
    values.push(column);
    columnsByProject.set(column.projectId, values);
  });
  columnsByProject.forEach((values) =>
    values.sort(
      (left, right) =>
        (left.order ?? 0) - (right.order ?? 0) ||
        (left.id as number) - (right.id as number),
    ),
  );

  if (schemaVersion === 1) {
    taskRows.forEach((task) => {
      if (!task.projectId || task.kanbanColumnId) return;
      const columns = columnsByProject.get(task.projectId) ?? [];
      task.kanbanColumnId =
        task.status === "done"
          ? (columns.at(-1)?.id as number | undefined) ?? null
          : task.status === "doing"
            ? (columns[1]?.id as number | undefined) ??
              (columns[0]?.id as number | undefined) ??
              null
            : (columns[0]?.id as number | undefined) ?? null;
      task.kanbanOrder = task.id as number;
    });

    let nextTaskId = Math.max(
      0,
      ...taskRows.map((task) => task.id as number),
    );
    cardRows.forEach((card) => {
      const column = columnRows.find((item) => item.id === card.columnId);
      if (!column) return;
      const columns = columnsByProject.get(column.projectId) ?? [];
      const columnIndex = columns.findIndex((item) => item.id === column.id);
      const status =
        columns.length > 1 && columnIndex === columns.length - 1
          ? ("done" as const)
          : columnIndex > 0
            ? ("doing" as const)
            : ("todo" as const);
      nextTaskId += 1;
      taskRows.push({
        id: nextTaskId,
        title: card.title,
        description: card.description,
        status,
        priority: card.priority,
        dueDate: card.dueDate,
        dueTime: null,
        estimatedMinutes: null,
        actualMinutes: null,
        projectId: column.projectId,
        kanbanColumnId: card.columnId,
        kanbanOrder: card.order,
        inbox: false,
        recurrence: "none",
        legacyCardId: card.id,
        tags: card.tags,
        createdAt: card.createdAt,
        completedAt: status === "done" ? card.createdAt ?? now : null,
        deletedAt: null,
      });
    });
  }

  ensureUniqueIds(projectRows as Array<{ id: number }>, "projects");
  ensureUniqueIds(habitRows as Array<{ id: number }>, "habits");
  ensureUniqueIds(taskRows as Array<{ id: number }>, "tasks");
  ensureUniqueIds(columnRows as Array<{ id: number }>, "columns");
  ensureUniqueIds(cardRows as Array<{ id: number }>, "cards");
  ensureUniqueIds(logRows as Array<{ id: number }>, "habitLogs");
  ensureUniqueIds(timeRows as Array<{ id: number }>, "timeEntries");
  ensureUniqueIds(noteRows as Array<{ id: number }>, "notes");
  ensureUniqueIds(goalRows as Array<{ id: number }>, "goals");

  const projectIds = new Set(projectRows.map((row) => row.id as number));
  const habitIds = new Set(habitRows.map((row) => row.id as number));
  const taskIds = new Set(taskRows.map((row) => row.id as number));
  const columnIds = new Set(columnRows.map((row) => row.id as number));

  taskRows.forEach((row, index) =>
    requireReference(row.projectId ?? null, projectIds, `tasks[${index}].projectId`),
  );
  taskRows.forEach((row, index) =>
    requireReference(
      row.kanbanColumnId ?? null,
      columnIds,
      `tasks[${index}].kanbanColumnId`,
    ),
  );
  columnRows.forEach((row, index) =>
    requireReference(row.projectId, projectIds, `columns[${index}].projectId`),
  );
  cardRows.forEach((row, index) =>
    requireReference(row.columnId, columnIds, `cards[${index}].columnId`),
  );
  logRows.forEach((row, index) =>
    requireReference(row.habitId, habitIds, `habitLogs[${index}].habitId`),
  );
  timeRows.forEach((row, index) => {
    requireReference(
      row.projectId ?? null,
      projectIds,
      `timeEntries[${index}].projectId`,
    );
    requireReference(
      row.taskId ?? null,
      taskIds,
      `timeEntries[${index}].taskId`,
    );
  });
  if (pomodoroRow) {
    requireReference(
      pomodoroRow.projectId ?? null,
      projectIds,
      "pomodoro.projectId",
    );
    requireReference(
      pomodoroRow.taskId ?? null,
      taskIds,
      "pomodoro.taskId",
    );
    if (pomodoroRow.running && (!pomodoroRow.active || !pomodoroRow.endsAt)) {
      throw new Error("Активный отсчёт Помодоро имеет неверное состояние");
    }
  }

  const activeTimeRows = timeRows.filter((row) => !row.endTime);
  if (activeTimeRows.length > 1) {
    throw new Error("В резервной копии найдено несколько активных таймеров");
  }
  if (pomodoroRow?.active && activeTimeRows.length) {
    throw new Error(
      "Свободный таймер и Помодоро не могут быть активны одновременно",
    );
  }

  return {
    projectRows,
    habitRows,
    taskRows,
    columnRows,
    cardRows,
    logRows,
    timeRows,
    noteRows,
    goalRows,
    pomodoroRow,
  };
}

async function remapForUser(
  db: FlowDb,
  data: ReturnType<typeof normalizeBackup>,
  userId: number,
) {
  const [
    lastProject,
    lastHabit,
    lastTask,
    lastColumn,
    lastCard,
    lastLog,
    lastTime,
    lastNote,
    lastGoal,
  ] = await Promise.all([
    db
      .select({ id: projects.id })
      .from(projects)
      .orderBy(desc(projects.id))
      .limit(1),
    db
      .select({ id: habits.id })
      .from(habits)
      .orderBy(desc(habits.id))
      .limit(1),
    db
      .select({ id: tasks.id })
      .from(tasks)
      .orderBy(desc(tasks.id))
      .limit(1),
    db
      .select({ id: kanbanColumns.id })
      .from(kanbanColumns)
      .orderBy(desc(kanbanColumns.id))
      .limit(1),
    db
      .select({ id: kanbanCards.id })
      .from(kanbanCards)
      .orderBy(desc(kanbanCards.id))
      .limit(1),
    db
      .select({ id: habitLogs.id })
      .from(habitLogs)
      .orderBy(desc(habitLogs.id))
      .limit(1),
    db
      .select({ id: timeEntries.id })
      .from(timeEntries)
      .orderBy(desc(timeEntries.id))
      .limit(1),
    db
      .select({ id: notes.id })
      .from(notes)
      .orderBy(desc(notes.id))
      .limit(1),
    db
      .select({ id: goals.id })
      .from(goals)
      .orderBy(desc(goals.id))
      .limit(1),
  ]);

  const idMap = <T extends { id?: unknown }>(
    rows: T[],
    start: number,
  ) =>
    new Map(
      rows.map(
        (row, index) => [Number(row.id), start + index + 1] as const,
      ),
    );
  const projectIds = idMap(data.projectRows, lastProject[0]?.id ?? 0);
  const habitIds = idMap(data.habitRows, lastHabit[0]?.id ?? 0);
  const taskIds = idMap(data.taskRows, lastTask[0]?.id ?? 0);
  const columnIds = idMap(data.columnRows, lastColumn[0]?.id ?? 0);
  const cardIds = idMap(data.cardRows, lastCard[0]?.id ?? 0);
  const logIds = idMap(data.logRows, lastLog[0]?.id ?? 0);
  const timeIds = idMap(data.timeRows, lastTime[0]?.id ?? 0);
  const noteIds = idMap(data.noteRows, lastNote[0]?.id ?? 0);
  const goalIds = idMap(data.goalRows, lastGoal[0]?.id ?? 0);

  const projectRows = data.projectRows.map((row) => ({
    ...row,
    id: projectIds.get(row.id as number),
    userId,
  }));
  const habitRows = data.habitRows.map((row) => ({
    ...row,
    id: habitIds.get(row.id as number),
    userId,
  }));
  const columnRows = data.columnRows.map((row) => ({
    ...row,
    id: columnIds.get(row.id as number),
    projectId: projectIds.get(row.projectId) as number,
  }));
  const cardRows = data.cardRows.map((row) => ({
    ...row,
    id: cardIds.get(row.id as number),
    columnId: columnIds.get(row.columnId) as number,
  }));
  const taskRows = data.taskRows.map((row) => ({
    ...row,
    id: taskIds.get(row.id as number),
    userId,
    projectId:
      row.projectId === null || row.projectId === undefined
        ? null
        : (projectIds.get(row.projectId) ?? null),
    kanbanColumnId:
      row.kanbanColumnId === null || row.kanbanColumnId === undefined
        ? null
        : (columnIds.get(row.kanbanColumnId) ?? null),
    legacyCardId:
      row.legacyCardId === null || row.legacyCardId === undefined
        ? null
        : (cardIds.get(row.legacyCardId) ?? null),
  }));
  const logRows = data.logRows.map((row) => ({
    ...row,
    id: logIds.get(row.id as number),
    habitId: habitIds.get(row.habitId) as number,
  }));
  const timeRows = data.timeRows.map((row) => ({
    ...row,
    id: timeIds.get(row.id as number),
    userId,
    projectId:
      row.projectId === null || row.projectId === undefined
        ? null
        : (projectIds.get(row.projectId) ?? null),
    taskId:
      row.taskId === null || row.taskId === undefined
        ? null
        : (taskIds.get(row.taskId) ?? null),
  }));
  const noteRows = data.noteRows.map((row) => ({
    ...row,
    id: noteIds.get(row.id as number),
    userId,
  }));
  const goalRows = data.goalRows.map((row) => ({
    ...row,
    id: goalIds.get(row.id as number),
    userId,
  }));
  const pomodoroRow = data.pomodoroRow
    ? {
        ...data.pomodoroRow,
        id: userId,
        userId,
        projectId:
          data.pomodoroRow.projectId === null ||
          data.pomodoroRow.projectId === undefined
            ? null
            : (projectIds.get(data.pomodoroRow.projectId) ?? null),
        taskId:
          data.pomodoroRow.taskId === null ||
          data.pomodoroRow.taskId === undefined
            ? null
            : (taskIds.get(data.pomodoroRow.taskId) ?? null),
      }
    : null;

  return {
    projectRows,
    habitRows,
    taskRows,
    columnRows,
    cardRows,
    logRows,
    timeRows,
    noteRows,
    goalRows,
    pomodoroRow,
  };
}

export async function restoreBackup(
  db: FlowDb,
  backup: unknown,
  userId: number,
) {
  const normalized = normalizeBackup(backup);
  const data = await remapForUser(db, normalized, userId);
  const [ownedProjectRows, ownedHabitRows, ownedBatchRows] =
    await Promise.all([
      db
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.userId, userId)),
      db
        .select({ id: habits.id })
        .from(habits)
        .where(eq(habits.userId, userId)),
      db
        .select({ id: importBatches.id })
        .from(importBatches)
        .where(eq(importBatches.userId, userId)),
    ]);
  const ownedProjectIds = ownedProjectRows.map((row) => row.id);
  const ownedHabitIds = ownedHabitRows.map((row) => row.id);
  const ownedBatchIds = ownedBatchRows.map((row) => row.id);
  const ownedColumnRows = ownedProjectIds.length
    ? await db
        .select({ id: kanbanColumns.id })
        .from(kanbanColumns)
        .where(inArray(kanbanColumns.projectId, ownedProjectIds))
    : [];
  const ownedColumnIds = ownedColumnRows.map((row) => row.id);

  const statements: BatchItem<"sqlite">[] = [
    db
      .delete(analyticsEvents)
      .where(eq(analyticsEvents.userId, userId)),
    db
      .update(analyticsTracking)
      .set({ startedAt: new Date() })
      .where(eq(analyticsTracking.userId, userId)),
    db
      .delete(pomodoroState)
      .where(eq(pomodoroState.userId, userId)),
  ];
  if (ownedBatchIds.length) {
    statements.push(
      db
        .delete(importRecords)
        .where(inArray(importRecords.batchId, ownedBatchIds)),
    );
  }
  statements.push(
    db
      .delete(importBatches)
      .where(eq(importBatches.userId, userId)),
  );
  if (ownedHabitIds.length) {
    statements.push(
      db
        .delete(habitLogs)
        .where(inArray(habitLogs.habitId, ownedHabitIds)),
    );
  }
  if (ownedColumnIds.length) {
    statements.push(
      db
        .delete(kanbanCards)
        .where(inArray(kanbanCards.columnId, ownedColumnIds)),
    );
  }
  statements.push(
    db.delete(timeEntries).where(eq(timeEntries.userId, userId)),
    db.delete(tasks).where(eq(tasks.userId, userId)),
  );
  if (ownedProjectIds.length) {
    statements.push(
      db
        .delete(kanbanColumns)
        .where(inArray(kanbanColumns.projectId, ownedProjectIds)),
    );
  }
  statements.push(
    db.delete(notes).where(eq(notes.userId, userId)),
    db.delete(goals).where(eq(goals.userId, userId)),
    db.delete(habits).where(eq(habits.userId, userId)),
    db.delete(projects).where(eq(projects.userId, userId)),
  );

  if (data.projectRows.length) {
    statements.push(db.insert(projects).values(data.projectRows));
  }
  if (data.habitRows.length) {
    statements.push(db.insert(habits).values(data.habitRows));
  }
  if (data.columnRows.length) {
    statements.push(db.insert(kanbanColumns).values(data.columnRows));
  }
  if (data.taskRows.length) {
    statements.push(db.insert(tasks).values(data.taskRows));
  }
  if (data.logRows.length) {
    statements.push(db.insert(habitLogs).values(data.logRows));
  }
  if (data.cardRows.length) {
    statements.push(db.insert(kanbanCards).values(data.cardRows));
  }
  if (data.timeRows.length) {
    statements.push(db.insert(timeEntries).values(data.timeRows));
  }
  if (data.noteRows.length) {
    statements.push(db.insert(notes).values(data.noteRows));
  }
  if (data.goalRows.length) {
    statements.push(db.insert(goals).values(data.goalRows));
  }
  if (data.pomodoroRow) {
    statements.push(db.insert(pomodoroState).values(data.pomodoroRow));
  }

  await db.batch(
    statements as [
      BatchItem<"sqlite">,
      ...Array<BatchItem<"sqlite">>,
    ],
  );

  return {
    projects: data.projectRows.length,
    habits: data.habitRows.length,
    tasks: data.taskRows.length,
    notes: data.noteRows.length,
    goals: data.goalRows.length,
  };
}
