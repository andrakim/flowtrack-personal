import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
} from "drizzle-orm";
import { getDb } from "@/db";
import {
  goals,
  habitLogs,
  habits,
  importBatches,
  kanbanColumns,
  notes,
  projects,
  tasks,
  timeEntries,
  pomodoroState,
} from "@/db/schema";
import { restoreBackup } from "./backup";
import {
  ensureCurrentUser,
  isAuthenticationRequiredError,
} from "./current-user";
import { importPlan, previewPlan, undoPlanImport } from "./plan";

type Payload = Record<string, unknown>;
type FlowDb = Awaited<ReturnType<typeof getDb>>;
type TaskStatus = "todo" | "doing" | "done";
type TaskRecurrence = "none" | "daily" | "weekdays" | "weekly" | "monthly";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^\d{2}:\d{2}$/;
const HEX_PATTERN = /^#[0-9a-f]{6}$/i;

function message(error: unknown) {
  const text = error instanceof Error ? error.message : "Неизвестная ошибка";
  if (text.includes("no such table")) {
    return "База данных ещё не подготовлена. Примените миграции сайта.";
  }
  return text;
}

function requiredText(payload: Payload, key: string, max = 255) {
  const value = String(payload[key] ?? "").trim();
  if (!value) throw new Error(`Поле «${key}» обязательно`);
  return value.slice(0, max);
}

function optionalText(payload: Payload, key: string, max = 4000) {
  const value = String(payload[key] ?? "").trim();
  return value ? value.slice(0, max) : null;
}

function idFrom(payload: Payload, key = "id") {
  const value = Number(payload[key]);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Некорректный идентификатор: ${key}`);
  }
  return value;
}

function numberFrom(
  payload: Payload,
  key: string,
  fallback = 0,
  min = 0,
  max = 1_000_000,
) {
  const value = Number(payload[key] ?? fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

const MAX_GOAL_VALUE = 1_000_000_000_000;

function optionalId(payload: Payload, key: string) {
  const value = Number(payload[key]);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function optionalDate(payload: Payload, key: string) {
  const value = String(payload[key] ?? "").trim();
  if (!value) return null;
  if (!DATE_PATTERN.test(value)) throw new Error(`Некорректная дата: ${key}`);
  return value;
}

function optionalTime(payload: Payload, key: string) {
  const value = String(payload[key] ?? "").trim();
  if (!value) return null;
  if (!TIME_PATTERN.test(value)) throw new Error(`Некорректное время: ${key}`);
  return value;
}

function colorFrom(payload: Payload, fallback: string) {
  const value = String(payload.color ?? "");
  return HEX_PATTERN.test(value) ? value : fallback;
}

function tagsFrom(payload: Payload) {
  const raw = payload.tags;
  const values = Array.isArray(raw)
    ? raw
    : String(raw ?? "")
        .split(",")
        .map((item) => item.trim());
  return [
    ...new Set(
      values
        .map((item) => String(item).trim().slice(0, 40))
        .filter(Boolean),
    ),
  ].slice(0, 12);
}

function enumFrom<T extends string>(
  payload: Payload,
  key: string,
  values: readonly T[],
  fallback: T,
) {
  const value = String(payload[key] ?? "");
  return values.includes(value as T) ? (value as T) : fallback;
}

function orderFrom(payload: Payload, key = "order") {
  const value = Number(payload[key]);
  if (!Number.isInteger(value) || value < 0 || value > 10_000) {
    throw new Error(`Некорректный порядок: ${key}`);
  }
  return value;
}

function reorderItems(payload: Payload, withColumn = false) {
  const rawItems = payload.items;
  if (!Array.isArray(rawItems) || rawItems.length === 0 || rawItems.length > 500) {
    throw new Error("Некорректный набор элементов для сортировки");
  }

  const items = rawItems.map((raw) => {
    if (!raw || typeof raw !== "object") {
      throw new Error("Некорректный элемент сортировки");
    }
    const item = raw as Payload;
    return {
      id: idFrom(item),
      ...(withColumn ? { columnId: idFrom(item, "columnId") } : {}),
      order: orderFrom(item),
    };
  });

  if (new Set(items.map((item) => item.id)).size !== items.length) {
    throw new Error("Один элемент нельзя сортировать дважды");
  }

  return items;
}

function ok(data: Record<string, unknown> = {}) {
  return Response.json({ ok: true, ...data });
}

function defaultPomodoro(userId: number) {
  return {
    id: userId,
    userId,
    phase: "focus" as const,
    active: false,
    running: false,
    cycle: 0,
    focusMinutes: 25,
    shortBreakMinutes: 5,
    longBreakMinutes: 15,
    cyclesBeforeLong: 4,
    autoStartBreak: false,
    autoStartFocus: false,
    title: "Фокус-сессия",
    projectId: null,
    taskId: null,
    startedAt: null,
    endsAt: null,
    remainingSeconds: 25 * 60,
    updatedAt: null,
  };
}

function phaseSeconds(
  phase: "focus" | "short_break" | "long_break",
  state: {
    focusMinutes: number;
    shortBreakMinutes: number;
    longBreakMinutes: number;
  },
) {
  if (phase === "short_break") return state.shortBreakMinutes * 60;
  if (phase === "long_break") return state.longBreakMinutes * 60;
  return state.focusMinutes * 60;
}

async function ownedProject(db: FlowDb, userId: number, projectId: number) {
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1);
  return project;
}

async function ownedTask(db: FlowDb, userId: number, taskId: number) {
  const [task] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)))
    .limit(1);
  return task;
}

async function ownedColumn(db: FlowDb, userId: number, columnId: number) {
  const [column] = await db
    .select()
    .from(kanbanColumns)
    .where(eq(kanbanColumns.id, columnId))
    .limit(1);
  if (!column) return undefined;
  const project = await ownedProject(db, userId, column.projectId);
  return project ? column : undefined;
}

async function ownedTimerReferences(
  db: FlowDb,
  userId: number,
  payload: Payload,
) {
  const projectId = optionalId(payload, "projectId");
  const taskId = optionalId(payload, "taskId");
  const [project, task] = await Promise.all([
    projectId ? ownedProject(db, userId, projectId) : Promise.resolve(null),
    taskId ? ownedTask(db, userId, taskId) : Promise.resolve(null),
  ]);
  if (projectId && !project) throw new Error("Проект не найден");
  if (taskId && !task) throw new Error("Задача не найдена");
  if (projectId && task?.projectId && task.projectId !== projectId) {
    throw new Error("Задача относится к другому проекту");
  }
  return { projectId, taskId };
}

async function projectColumns(
  db: FlowDb,
  userId: number,
  projectId: number,
) {
  const project = await ownedProject(db, userId, projectId);
  if (!project) throw new Error("Проект не найден");
  return db
    .select()
    .from(kanbanColumns)
    .where(eq(kanbanColumns.projectId, projectId))
    .orderBy(asc(kanbanColumns.order), asc(kanbanColumns.id));
}

function statusForColumn(
  columns: Array<{ id: number; order: number }>,
  columnId: number,
): TaskStatus {
  const index = columns.findIndex((column) => column.id === columnId);
  if (index < 0) throw new Error("Колонка проекта не найдена");
  if (columns.length > 1 && index === columns.length - 1) return "done";
  if (index > 0) return "doing";
  return "todo";
}

function columnForStatus(
  columns: Array<{ id: number; order: number }>,
  status: TaskStatus,
) {
  if (!columns.length) return null;
  if (status === "done") return columns.at(-1)?.id ?? columns[0].id;
  if (status === "doing") return columns[1]?.id ?? columns[0].id;
  return columns[0].id;
}

async function nextKanbanOrder(
  db: FlowDb,
  userId: number,
  columnId: number,
) {
  const [last] = await db
    .select({ order: tasks.kanbanOrder })
    .from(tasks)
    .where(
      and(
        eq(tasks.kanbanColumnId, columnId),
        eq(tasks.userId, userId),
        isNull(tasks.deletedAt),
      ),
    )
    .orderBy(desc(tasks.kanbanOrder))
    .limit(1);
  return (last?.order ?? -1) + 1;
}

function nextOccurrenceDate(value: string, recurrence: TaskRecurrence) {
  const next = new Date(`${value}T12:00:00`);
  if (Number.isNaN(next.getTime())) return null;
  if (recurrence === "daily") next.setDate(next.getDate() + 1);
  if (recurrence === "weekly") next.setDate(next.getDate() + 7);
  if (recurrence === "monthly") next.setMonth(next.getMonth() + 1);
  if (recurrence === "weekdays") {
    do {
      next.setDate(next.getDate() + 1);
    } while (next.getDay() === 0 || next.getDay() === 6);
  }
  return dateKey(next);
}

function dateKey(value: Date) {
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, "0"),
    String(value.getDate()).padStart(2, "0"),
  ].join("-");
}

export async function GET(request: Request) {
  try {
    const db = await getDb();
    const currentUser = await ensureCurrentUser(db);
    const userId = currentUser.id;
    const fullBackup = new URL(request.url).searchParams.get("backup") === "1";
    const [
      allHabitRows,
      allTaskRows,
      allProjectRows,
      entryRows,
      allNoteRows,
      allGoalRows,
      pomodoroRows,
      recentImports,
    ] = await Promise.all([
      db
        .select()
        .from(habits)
        .where(eq(habits.userId, userId))
        .orderBy(asc(habits.order), asc(habits.id)),
      db
        .select()
        .from(tasks)
        .where(eq(tasks.userId, userId))
        .orderBy(asc(tasks.dueDate), asc(tasks.dueTime), desc(tasks.id)),
      db
        .select()
        .from(projects)
        .where(eq(projects.userId, userId))
        .orderBy(desc(projects.createdAt)),
      fullBackup
        ? db
            .select()
            .from(timeEntries)
            .where(eq(timeEntries.userId, userId))
            .orderBy(desc(timeEntries.startTime))
        : db
            .select()
            .from(timeEntries)
            .where(eq(timeEntries.userId, userId))
            .orderBy(desc(timeEntries.startTime))
            .limit(200),
      db
        .select()
        .from(notes)
        .where(eq(notes.userId, userId))
        .orderBy(desc(notes.pinned), asc(notes.order), desc(notes.updatedAt)),
      db
        .select()
        .from(goals)
        .where(eq(goals.userId, userId))
        .orderBy(desc(goals.createdAt)),
      db
        .select()
        .from(pomodoroState)
        .where(eq(pomodoroState.userId, userId))
        .limit(1),
      db
        .select()
        .from(importBatches)
        .where(eq(importBatches.userId, userId))
        .orderBy(desc(importBatches.createdAt))
        .limit(20),
    ]);

    const allProjectIds = allProjectRows.map((project) => project.id);
    const allHabitIds = allHabitRows.map((habit) => habit.id);
    const [columnRows, logRows] = await Promise.all([
      allProjectIds.length
        ? db
            .select()
            .from(kanbanColumns)
            .where(inArray(kanbanColumns.projectId, allProjectIds))
            .orderBy(asc(kanbanColumns.projectId), asc(kanbanColumns.order))
        : Promise.resolve([]),
      allHabitIds.length
        ? db
            .select()
            .from(habitLogs)
            .where(inArray(habitLogs.habitId, allHabitIds))
            .orderBy(asc(habitLogs.date))
        : Promise.resolve([]),
    ]);
    const habitRows = fullBackup
      ? allHabitRows
      : allHabitRows.filter((habit) => !habit.archived && !habit.deletedAt);
    const taskRows = fullBackup
      ? allTaskRows
      : allTaskRows.filter((task) => !task.deletedAt);
    const projectRows = fullBackup
      ? allProjectRows
      : allProjectRows.filter(
          (project) => !project.archived && !project.deletedAt,
        );
    const noteRows = fullBackup
      ? allNoteRows
      : allNoteRows.filter((note) => !note.deletedAt);
    const goalRows = fullBackup
      ? allGoalRows
      : allGoalRows.filter((goal) => !goal.deletedAt);
    const visibleProjectIds = new Set(projectRows.map((project) => project.id));
    const visibleColumns = fullBackup
      ? columnRows
      : columnRows.filter((column) => visibleProjectIds.has(column.projectId));
    const visibleColumnIds = new Set(visibleColumns.map((column) => column.id));
    const cardRows = taskRows
      .filter(
        (task) =>
          task.kanbanColumnId !== null &&
          visibleColumnIds.has(task.kanbanColumnId),
      )
      .map((task) => ({
        id: task.id,
        columnId: task.kanbanColumnId as number,
        title: task.title,
        description: task.description,
        priority: task.priority,
        tags: task.tags,
        order: task.kanbanOrder,
        dueDate: task.dueDate,
      }));
    const trash = [
      ...allTaskRows
        .filter((item) => item.deletedAt)
        .map(({ id, title, deletedAt }) => ({
          id,
          title,
          deletedAt,
          entity: "task" as const,
        })),
      ...allProjectRows
        .filter((item) => item.deletedAt)
        .map(({ id, title, deletedAt }) => ({
          id,
          title,
          deletedAt,
          entity: "project" as const,
        })),
      ...allHabitRows
        .filter((item) => item.deletedAt)
        .map(({ id, title, deletedAt }) => ({
          id,
          title,
          deletedAt,
          entity: "habit" as const,
        })),
      ...allNoteRows
        .filter((item) => item.deletedAt)
        .map(({ id, title, deletedAt }) => ({
          id,
          title,
          deletedAt,
          entity: "note" as const,
        })),
      ...allGoalRows
        .filter((item) => item.deletedAt)
        .map(({ id, title, deletedAt }) => ({
          id,
          title,
          deletedAt,
          entity: "goal" as const,
        })),
    ]
      .sort(
        (left, right) =>
          (right.deletedAt?.getTime() ?? 0) -
          (left.deletedAt?.getTime() ?? 0),
      )
      .slice(0, 100);

    return Response.json({
      viewer: {
        id: currentUser.id,
        role: currentUser.role,
      },
      habits: habitRows,
      habitLogs: logRows,
      tasks: taskRows,
      projects: projectRows,
      columns: visibleColumns,
      cards: cardRows,
      timeEntries: entryRows,
      notes: noteRows,
      goals: goalRows,
      pomodoro: pomodoroRows[0] ?? defaultPomodoro(userId),
      trash,
      imports: recentImports,
    });
  } catch (error) {
    return Response.json(
      { error: message(error) },
      { status: isAuthenticationRequiredError(error) ? 401 : 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      action?: string;
      payload?: Payload;
    };
    const action = body.action;
    const payload = body.payload ?? {};
    const db = await getDb();
    const currentUser = await ensureCurrentUser(db);
    const userId = currentUser.id;
    const pomodoroId = userId;

    switch (action) {
      case "createHabit": {
        const [habit] = await db
          .insert(habits)
          .values({
            userId,
            title: requiredText(payload, "title"),
            description: optionalText(payload, "description"),
            color: colorFrom(payload, "#6366f1"),
            icon: String(payload.icon ?? "star").slice(0, 30),
            frequency: enumFrom(
              payload,
              "frequency",
              ["daily", "weekdays", "weekly"] as const,
              "daily",
            ),
            targetPerDay: numberFrom(payload, "targetPerDay", 1, 1, 99),
            order: numberFrom(payload, "order", 0),
          })
          .returning();
        return ok({ habit });
      }

      case "updateHabit": {
        const id = idFrom(payload);
        const [habit] = await db
          .update(habits)
          .set({
            title: requiredText(payload, "title"),
            description: optionalText(payload, "description"),
            color: colorFrom(payload, "#6366f1"),
            icon: String(payload.icon ?? "star").slice(0, 30),
            frequency: enumFrom(
              payload,
              "frequency",
              ["daily", "weekdays", "weekly"] as const,
              "daily",
            ),
            targetPerDay: numberFrom(payload, "targetPerDay", 1, 1, 99),
          })
          .where(and(eq(habits.id, id), eq(habits.userId, userId)))
          .returning();
        if (!habit) return Response.json({ error: "Привычка не найдена" }, { status: 404 });
        return ok({ habit });
      }

      case "deleteHabit": {
        const id = idFrom(payload);
        await db
          .update(habits)
          .set({ deletedAt: new Date() })
          .where(and(eq(habits.id, id), eq(habits.userId, userId)));
        return ok({ undo: { entity: "habit", id } });
      }

      case "toggleHabit": {
        const habitId = idFrom(payload, "habitId");
        const [ownedHabit] = await db
          .select({ id: habits.id })
          .from(habits)
          .where(
            and(
              eq(habits.id, habitId),
              eq(habits.userId, userId),
              isNull(habits.deletedAt),
            ),
          )
          .limit(1);
        if (!ownedHabit) {
          return Response.json(
            { error: "Привычка не найдена" },
            { status: 404 },
          );
        }
        const date = optionalDate(payload, "date");
        if (!date) throw new Error("Дата обязательна");
        const [existing] = await db
          .select()
          .from(habitLogs)
          .where(and(eq(habitLogs.habitId, habitId), eq(habitLogs.date, date)))
          .limit(1);
        const completed =
          typeof payload.completed === "boolean"
            ? payload.completed
            : !existing?.completed;
        let habitLog: typeof habitLogs.$inferSelect | undefined;
        if (existing) {
          [habitLog] = await db
            .update(habitLogs)
            .set({ completed, count: completed ? 1 : 0 })
            .where(eq(habitLogs.id, existing.id))
            .returning();
        } else {
          [habitLog] = await db
            .insert(habitLogs)
            .values({
              habitId,
              date,
              completed,
              count: completed ? 1 : 0,
            })
            .returning();
        }
        return ok({ completed, habitLog });
      }

      case "createTask": {
        const status = enumFrom(
          payload,
          "status",
          ["todo", "doing", "done"] as const,
          "todo",
        );
        const projectId = optionalId(payload, "projectId");
        const columns = projectId
          ? await projectColumns(db, userId, projectId)
          : [];
        const kanbanColumnId = columnForStatus(columns, status);
        const dueDate = optionalDate(payload, "dueDate");
        const [task] = await db
          .insert(tasks)
          .values({
            userId,
            title: requiredText(payload, "title"),
            description: optionalText(payload, "description"),
            status,
            priority: enumFrom(
              payload,
              "priority",
              ["low", "medium", "high"] as const,
              "medium",
            ),
            dueDate,
            dueTime: optionalTime(payload, "dueTime"),
            estimatedMinutes: payload.estimatedMinutes
              ? numberFrom(payload, "estimatedMinutes", 0, 1, 100_000)
              : null,
            projectId,
            kanbanColumnId,
            kanbanOrder: kanbanColumnId
              ? await nextKanbanOrder(db, userId, kanbanColumnId)
              : 0,
            inbox: Boolean(payload.inbox),
            recurrence: enumFrom(
              payload,
              "recurrence",
              ["none", "daily", "weekdays", "weekly", "monthly"] as const,
              "none",
            ),
            tags: tagsFrom(payload),
            completedAt: status === "done" ? new Date() : null,
          })
          .returning();
        return ok({ task });
      }

      case "updateTask": {
        const id = idFrom(payload);
        const [current] = await db
          .select()
          .from(tasks)
          .where(
            and(
              eq(tasks.id, id),
              eq(tasks.userId, userId),
              isNull(tasks.deletedAt),
            ),
          )
          .limit(1);
        if (!current) {
          return Response.json({ error: "Задача не найдена" }, { status: 404 });
        }
        const status = enumFrom(
          payload,
          "status",
          ["todo", "doing", "done"] as const,
          "todo",
        );
        const projectId = optionalId(payload, "projectId");
        const columns = projectId
          ? await projectColumns(db, userId, projectId)
          : [];
        const currentColumnStillValid =
          current.projectId === projectId &&
          current.kanbanColumnId !== null &&
          columns.some((column) => column.id === current.kanbanColumnId) &&
          current.status === status;
        const kanbanColumnId = currentColumnStillValid
          ? current.kanbanColumnId
          : columnForStatus(columns, status);
        const kanbanOrder =
          kanbanColumnId === current.kanbanColumnId
            ? current.kanbanOrder
            : kanbanColumnId
              ? await nextKanbanOrder(db, userId, kanbanColumnId)
              : 0;
        const [task] = await db
          .update(tasks)
          .set({
            title: requiredText(payload, "title"),
            description: optionalText(payload, "description"),
            status,
            priority: enumFrom(
              payload,
              "priority",
              ["low", "medium", "high"] as const,
              "medium",
            ),
            dueDate: optionalDate(payload, "dueDate"),
            dueTime: optionalTime(payload, "dueTime"),
            estimatedMinutes: payload.estimatedMinutes
              ? numberFrom(payload, "estimatedMinutes", 0, 1, 100_000)
              : null,
            projectId,
            kanbanColumnId,
            kanbanOrder,
            inbox: Boolean(payload.inbox),
            recurrence: enumFrom(
              payload,
              "recurrence",
              ["none", "daily", "weekdays", "weekly", "monthly"] as const,
              "none",
            ),
            tags: tagsFrom(payload),
            completedAt:
              status === "done"
                ? current.completedAt ?? new Date()
                : null,
          })
          .where(
            and(
              eq(tasks.id, id),
              eq(tasks.userId, userId),
              isNull(tasks.deletedAt),
            ),
          )
          .returning();
        if (!task) {
          return Response.json({ error: "Задача не найдена" }, { status: 404 });
        }
        return ok({ task });
      }

      case "toggleTask": {
        const id = idFrom(payload);
        const done = Boolean(payload.done);
        const [current] = await db
          .select()
          .from(tasks)
          .where(
            and(
              eq(tasks.id, id),
              eq(tasks.userId, userId),
              isNull(tasks.deletedAt),
            ),
          )
          .limit(1);
        if (!current) {
          return Response.json({ error: "Задача не найдена" }, { status: 404 });
        }
        const columns = current.projectId
          ? await projectColumns(db, userId, current.projectId)
          : [];
        const status: TaskStatus = done ? "done" : "todo";
        const targetColumnId = columnForStatus(columns, status);
        await db
          .update(tasks)
          .set({
            status,
            completedAt: done ? new Date() : null,
            kanbanColumnId: targetColumnId,
            kanbanOrder:
              targetColumnId && targetColumnId !== current.kanbanColumnId
                ? await nextKanbanOrder(db, userId, targetColumnId)
                : current.kanbanOrder,
            inbox: done ? false : current.inbox,
          })
          .where(and(eq(tasks.id, id), eq(tasks.userId, userId)));

        let nextTask: typeof tasks.$inferSelect | undefined;
        if (
          done &&
          current.status !== "done" &&
          current.recurrence !== "none" &&
          current.dueDate
        ) {
          const nextDueDate = nextOccurrenceDate(
            current.dueDate,
            current.recurrence,
          );
          if (nextDueDate) {
            const nextColumnId = columnForStatus(columns, "todo");
            [nextTask] = await db
              .insert(tasks)
              .values({
                userId,
                title: current.title,
                description: current.description,
                status: "todo",
                priority: current.priority,
                dueDate: nextDueDate,
                dueTime: current.dueTime,
                estimatedMinutes: current.estimatedMinutes,
                projectId: current.projectId,
                kanbanColumnId: nextColumnId,
                kanbanOrder: nextColumnId
                  ? await nextKanbanOrder(db, userId, nextColumnId)
                  : 0,
                inbox: false,
                recurrence: current.recurrence,
                tags: current.tags,
              })
              .returning();
          }
        }
        return ok({ nextTask });
      }

      case "deleteTask": {
        const id = idFrom(payload);
        await db
          .update(tasks)
          .set({ deletedAt: new Date() })
          .where(and(eq(tasks.id, id), eq(tasks.userId, userId)));
        return ok({ undo: { entity: "task", id } });
      }

      case "createProject": {
        const [project] = await db
          .insert(projects)
          .values({
            userId,
            title: requiredText(payload, "title"),
            description: optionalText(payload, "description"),
            color: colorFrom(payload, "#8b5cf6"),
          })
          .returning();
        await db.insert(kanbanColumns).values([
          {
            projectId: project.id,
            title: "Нужно сделать",
            order: 0,
            color: "#64748b",
          },
          {
            projectId: project.id,
            title: "В работе",
            order: 1,
            color: "#f59e0b",
          },
          {
            projectId: project.id,
            title: "Готово",
            order: 2,
            color: "#10b981",
          },
        ]);
        return ok({ project });
      }

      case "deleteProject": {
        const id = idFrom(payload);
        const project = await ownedProject(db, userId, id);
        if (!project) {
          return Response.json(
            { error: "Проект не найден" },
            { status: 404 },
          );
        }
        const deletedAt = new Date();
        await db.batch([
          db
            .update(tasks)
            .set({ deletedAt })
            .where(
              and(
                eq(tasks.projectId, id),
                eq(tasks.userId, userId),
                isNull(tasks.deletedAt),
              ),
            ),
          db
            .update(projects)
            .set({ deletedAt })
            .where(and(eq(projects.id, id), eq(projects.userId, userId))),
        ]);
        return ok({ undo: { entity: "project", id } });
      }

      case "createColumn": {
        const projectId = idFrom(payload, "projectId");
        const project = await ownedProject(db, userId, projectId);
        if (!project) {
          return Response.json(
            { error: "Проект не найден" },
            { status: 404 },
          );
        }
        const existing = await db
          .select()
          .from(kanbanColumns)
          .where(eq(kanbanColumns.projectId, projectId))
          .orderBy(desc(kanbanColumns.order))
          .limit(1);
        const [column] = await db
          .insert(kanbanColumns)
          .values({
            projectId,
            title: requiredText(payload, "title"),
            color: colorFrom(payload, "#6366f1"),
            order: (existing[0]?.order ?? -1) + 1,
          })
          .returning();
        return ok({ column });
      }

      case "updateColumn": {
        const id = idFrom(payload);
        const current = await ownedColumn(db, userId, id);
        if (!current) {
          return Response.json(
            { error: "Колонка не найдена" },
            { status: 404 },
          );
        }
        const [column] = await db
          .update(kanbanColumns)
          .set({
            title: requiredText(payload, "title"),
            color: colorFrom(payload, "#6366f1"),
          })
          .where(eq(kanbanColumns.id, id))
          .returning();
        if (!column) return Response.json({ error: "Колонка не найдена" }, { status: 404 });
        return ok({ column });
      }

      case "reorderKanbanColumns": {
        const items = reorderItems(payload);
        const ids = items.map((item) => item.id);
        const rows = await db
          .select()
          .from(kanbanColumns)
          .where(inArray(kanbanColumns.id, ids));
        if (rows.length !== items.length) {
          return Response.json({ error: "Одна или несколько колонок не найдены" }, { status: 404 });
        }

        const projectIds = new Set(rows.map((column) => column.projectId));
        if (projectIds.size !== 1) {
          throw new Error("Колонки можно сортировать только внутри одного проекта");
        }
        const projectId = rows[0].projectId;
        const project = await ownedProject(db, userId, projectId);
        if (!project) {
          return Response.json(
            { error: "Колонки проекта не найдены" },
            { status: 404 },
          );
        }
        const allProjectColumns = await db
          .select({ id: kanbanColumns.id })
          .from(kanbanColumns)
          .where(eq(kanbanColumns.projectId, projectId));
        const orders = items.map((item) => item.order).sort((left, right) => left - right);
        if (
          allProjectColumns.length !== items.length ||
          orders.some((order, index) => order !== index)
        ) {
          throw new Error("Нужно передать полный корректный порядок колонок проекта");
        }

        const orderedColumns = items
          .map((item) => {
            const column = rows.find((row) => row.id === item.id);
            if (!column) throw new Error("Колонка не найдена");
            return { ...column, order: item.order };
          })
          .sort((left, right) => left.order - right.order);
        const projectTasks = await db
          .select()
          .from(tasks)
          .where(
            and(
              eq(tasks.projectId, projectId),
              eq(tasks.userId, userId),
              isNull(tasks.deletedAt),
              isNotNull(tasks.kanbanColumnId),
            ),
          );
        const statements = [
          ...items.map((item) =>
            db
              .update(kanbanColumns)
              .set({ order: item.order })
              .where(eq(kanbanColumns.id, item.id)),
          ),
          ...projectTasks.map((task) => {
            const status = statusForColumn(
              orderedColumns,
              task.kanbanColumnId as number,
            );
            return db
              .update(tasks)
              .set({
                status,
                completedAt:
                  status === "done"
                    ? task.completedAt ?? new Date()
                    : null,
              })
              .where(
                and(eq(tasks.id, task.id), eq(tasks.userId, userId)),
              );
          }),
        ];
        const firstStatement = statements[0];
        if (!firstStatement) throw new Error("Нет колонок для сортировки");
        await db.batch([firstStatement, ...statements.slice(1)]);
        return ok();
      }

      case "deleteColumn": {
        const id = idFrom(payload);
        const column = await ownedColumn(db, userId, id);
        if (!column) {
          return Response.json({ error: "Колонка не найдена" }, { status: 404 });
        }
        const remainingColumns = (
          await projectColumns(db, userId, column.projectId)
        ).filter((item) => item.id !== id);
        const targetColumnId = remainingColumns[0]?.id ?? null;
        await db.batch([
          db
            .update(tasks)
            .set({
              kanbanColumnId: targetColumnId,
              kanbanOrder: 0,
              status: "todo",
              completedAt: null,
            })
            .where(
              and(
                eq(tasks.kanbanColumnId, id),
                eq(tasks.userId, userId),
              ),
            ),
          db.delete(kanbanColumns).where(eq(kanbanColumns.id, id)),
        ]);
        return ok();
      }

      case "createCard": {
        const columnId = idFrom(payload, "columnId");
        const column = await ownedColumn(db, userId, columnId);
        if (!column) {
          return Response.json({ error: "Колонка не найдена" }, { status: 404 });
        }
        const columns = await projectColumns(db, userId, column.projectId);
        const status = statusForColumn(columns, columnId);
        const [card] = await db
          .insert(tasks)
          .values({
            userId,
            title: requiredText(payload, "title"),
            description: optionalText(payload, "description"),
            status,
            priority: enumFrom(
              payload,
              "priority",
              ["low", "medium", "high"] as const,
              "medium",
            ),
            tags: tagsFrom(payload),
            dueDate: optionalDate(payload, "dueDate"),
            projectId: column.projectId,
            kanbanColumnId: columnId,
            kanbanOrder: await nextKanbanOrder(db, userId, columnId),
            inbox: false,
            recurrence: "none",
            completedAt: status === "done" ? new Date() : null,
          })
          .returning();
        return ok({ card });
      }

      case "updateCard": {
        const id = idFrom(payload);
        const columnId = idFrom(payload, "columnId");
        const column = await ownedColumn(db, userId, columnId);
        if (!column) {
          return Response.json({ error: "Колонка не найдена" }, { status: 404 });
        }
        const [current] = await db
          .select()
          .from(tasks)
          .where(
            and(
              eq(tasks.id, id),
              eq(tasks.userId, userId),
              isNull(tasks.deletedAt),
            ),
          )
          .limit(1);
        if (!current) {
          return Response.json({ error: "Карточка не найдена" }, { status: 404 });
        }
        const columns = await projectColumns(db, userId, column.projectId);
        const status = statusForColumn(columns, columnId);
        const [card] = await db
          .update(tasks)
          .set({
            title: requiredText(payload, "title"),
            description: optionalText(payload, "description"),
            status,
            priority: enumFrom(
              payload,
              "priority",
              ["low", "medium", "high"] as const,
              "medium",
            ),
            tags: tagsFrom(payload),
            dueDate: optionalDate(payload, "dueDate"),
            projectId: column.projectId,
            kanbanColumnId: columnId,
            kanbanOrder:
              current.kanbanColumnId === columnId
                ? current.kanbanOrder
                : await nextKanbanOrder(db, userId, columnId),
            inbox: false,
            completedAt:
              status === "done"
                ? current.completedAt ?? new Date()
                : null,
          })
          .where(and(eq(tasks.id, id), eq(tasks.userId, userId)))
          .returning();
        if (!card) {
          return Response.json({ error: "Карточка не найдена" }, { status: 404 });
        }
        return ok({ card });
      }

      case "reorderKanbanCards": {
        const items = reorderItems(payload, true);
        if (items.some((item) => !item.columnId)) {
          throw new Error("Для каждой карточки нужна колонка");
        }
        const ids = items.map((item) => item.id);
        const cardsToMove = await db
          .select()
          .from(tasks)
          .where(
            and(
              inArray(tasks.id, ids),
              eq(tasks.userId, userId),
              isNull(tasks.deletedAt),
            ),
          );
        if (cardsToMove.length !== items.length) {
          return Response.json({ error: "Одна или несколько карточек не найдены" }, { status: 404 });
        }

        const destinationColumnIds = items.map((item) => item.columnId as number);
        if (cardsToMove.some((card) => card.kanbanColumnId === null)) {
          throw new Error("Одна из задач не привязана к канбану");
        }
        const originalColumnIds = cardsToMove.map(
          (card) => card.kanbanColumnId as number,
        );
        const allColumnIds = [...new Set([...destinationColumnIds, ...originalColumnIds])];
        const columns = await db
          .select()
          .from(kanbanColumns)
          .where(inArray(kanbanColumns.id, allColumnIds));
        if (columns.length !== allColumnIds.length) {
          throw new Error("Целевая колонка не найдена");
        }
        const projectIds = new Set(columns.map((column) => column.projectId));
        if (projectIds.size !== 1) {
          throw new Error("Карточки можно переносить только внутри одного проекта");
        }
        const projectId = columns[0].projectId;
        const project = await ownedProject(db, userId, projectId);
        if (!project) {
          throw new Error("Проект для переноса карточек не найден");
        }
        const allProjectColumns = await projectColumns(db, userId, projectId);
        const allProjectColumnIds = allProjectColumns.map((column) => column.id);
        const allProjectCards = await db
          .select({ id: tasks.id })
          .from(tasks)
          .where(
            and(
              inArray(tasks.kanbanColumnId, allProjectColumnIds),
              eq(tasks.userId, userId),
              isNull(tasks.deletedAt),
            ),
          );
        if (allProjectCards.length !== items.length) {
          throw new Error("Нужно передать полный порядок карточек проекта");
        }

        const orderSets = new Map<number, number[]>();
        items.forEach((item) => {
          const columnId = item.columnId as number;
          const values = orderSets.get(columnId) ?? [];
          values.push(item.order);
          orderSets.set(columnId, values);
        });
        for (const orders of orderSets.values()) {
          orders.sort((left, right) => left - right);
          if (orders.some((order, index) => order !== index)) {
            throw new Error("Порядок карточек в колонке содержит пропуски");
          }
        }

        const statements = items.map((item) => {
          const status = statusForColumn(
            allProjectColumns,
            item.columnId as number,
          );
          const current = cardsToMove.find((card) => card.id === item.id);
          return db
            .update(tasks)
            .set({
              projectId,
              kanbanColumnId: item.columnId as number,
              kanbanOrder: item.order,
              status,
              inbox: false,
              completedAt:
                status === "done"
                  ? current?.completedAt ?? new Date()
                  : null,
            })
            .where(
              and(eq(tasks.id, item.id), eq(tasks.userId, userId)),
            );
        });
        const firstStatement = statements[0];
        if (!firstStatement) throw new Error("Нет карточек для сортировки");
        await db.batch([firstStatement, ...statements.slice(1)]);
        return ok();
      }

      case "deleteCard": {
        const id = idFrom(payload);
        await db
          .update(tasks)
          .set({ deletedAt: new Date() })
          .where(and(eq(tasks.id, id), eq(tasks.userId, userId)));
        return ok({ undo: { entity: "task", id } });
      }

      case "createNote": {
        const [note] = await db
          .insert(notes)
          .values({
            userId,
            title: requiredText(payload, "title"),
            content: optionalText(payload, "content", 100_000) ?? "",
            color: colorFrom(payload, "#fef3c7"),
            pinned: Boolean(payload.pinned),
            tags: tagsFrom(payload),
          })
          .returning();
        return ok({ note });
      }

      case "updateNote": {
        const id = idFrom(payload);
        const [note] = await db
          .update(notes)
          .set({
            title: requiredText(payload, "title"),
            content: optionalText(payload, "content", 100_000) ?? "",
            color: colorFrom(payload, "#fef3c7"),
            pinned: Boolean(payload.pinned),
            tags: tagsFrom(payload),
            updatedAt: new Date(),
          })
          .where(and(eq(notes.id, id), eq(notes.userId, userId)))
          .returning();
        if (!note) return Response.json({ error: "Заметка не найдена" }, { status: 404 });
        return ok({ note });
      }

      case "toggleNotePin": {
        const id = idFrom(payload);
        await db
          .update(notes)
          .set({ pinned: Boolean(payload.pinned), updatedAt: new Date() })
          .where(and(eq(notes.id, id), eq(notes.userId, userId)));
        return ok();
      }

      case "deleteNote": {
        const id = idFrom(payload);
        await db
          .update(notes)
          .set({ deletedAt: new Date() })
          .where(and(eq(notes.id, id), eq(notes.userId, userId)));
        return ok({ undo: { entity: "note", id } });
      }

      case "createGoal": {
        const targetValue = payload.targetValue
          ? numberFrom(payload, "targetValue", 0, 1, MAX_GOAL_VALUE)
          : null;
        const currentValue = numberFrom(
          payload,
          "currentValue",
          0,
          0,
          MAX_GOAL_VALUE,
        );
        const [goal] = await db
          .insert(goals)
          .values({
            userId,
            title: requiredText(payload, "title"),
            description: optionalText(payload, "description"),
            category: String(payload.category ?? "personal").slice(0, 60),
            targetValue,
            currentValue,
            unit: optionalText(payload, "unit", 40),
            deadline: optionalDate(payload, "deadline"),
            status:
              targetValue !== null && currentValue >= targetValue
                ? "completed"
                : "active",
            color: colorFrom(payload, "#10b981"),
          })
          .returning();
        return ok({ goal });
      }

      case "updateGoal": {
        const id = idFrom(payload);
        const targetValue = payload.targetValue
          ? numberFrom(payload, "targetValue", 0, 1, MAX_GOAL_VALUE)
          : null;
        const currentValue = numberFrom(
          payload,
          "currentValue",
          0,
          0,
          MAX_GOAL_VALUE,
        );
        const [goal] = await db
          .update(goals)
          .set({
            title: requiredText(payload, "title"),
            description: optionalText(payload, "description"),
            category: String(payload.category ?? "personal").slice(0, 60),
            targetValue,
            currentValue,
            unit: optionalText(payload, "unit", 40),
            deadline: optionalDate(payload, "deadline"),
            status:
              targetValue !== null && currentValue >= targetValue
                ? "completed"
                : "active",
            color: colorFrom(payload, "#10b981"),
          })
          .where(and(eq(goals.id, id), eq(goals.userId, userId)))
          .returning();
        if (!goal) return Response.json({ error: "Цель не найдена" }, { status: 404 });
        return ok({ goal });
      }

      case "changeGoalProgress": {
        const id = idFrom(payload);
        const [current] = await db
          .select()
          .from(goals)
          .where(and(eq(goals.id, id), eq(goals.userId, userId)))
          .limit(1);
        if (!current) return Response.json({ error: "Цель не найдена" }, { status: 404 });
        const next = Math.min(
          MAX_GOAL_VALUE,
          Math.max(
            0,
            current.currentValue +
              numberFrom(
                payload,
                "delta",
                0,
                -MAX_GOAL_VALUE,
                MAX_GOAL_VALUE,
              ),
          ),
        );
        const status =
          current.targetValue !== null && next >= current.targetValue
            ? "completed"
            : "active";
        await db
          .update(goals)
          .set({ currentValue: next, status })
          .where(and(eq(goals.id, id), eq(goals.userId, userId)));
        return ok({ currentValue: next, status });
      }

      case "deleteGoal": {
        const id = idFrom(payload);
        await db
          .update(goals)
          .set({ deletedAt: new Date() })
          .where(and(eq(goals.id, id), eq(goals.userId, userId)));
        return ok({ undo: { entity: "goal", id } });
      }

      case "updatePomodoroSettings": {
        const [current] = await db
          .select()
          .from(pomodoroState)
          .where(
            and(
              eq(pomodoroState.id, pomodoroId),
              eq(pomodoroState.userId, userId),
            ),
          )
          .limit(1);
        if (current?.active) {
          return Response.json(
            { error: "Сначала завершите текущий цикл Помодоро" },
            { status: 409 },
          );
        }

        const focusMinutes = numberFrom(payload, "focusMinutes", 25, 1, 180);
        const references = await ownedTimerReferences(db, userId, payload);
        const values = {
          userId,
          phase: "focus" as const,
          active: false,
          running: false,
          cycle: 0,
          focusMinutes,
          shortBreakMinutes: numberFrom(
            payload,
            "shortBreakMinutes",
            5,
            1,
            60,
          ),
          longBreakMinutes: numberFrom(
            payload,
            "longBreakMinutes",
            15,
            1,
            120,
          ),
          cyclesBeforeLong: numberFrom(
            payload,
            "cyclesBeforeLong",
            4,
            2,
            12,
          ),
          autoStartBreak: Boolean(payload.autoStartBreak),
          autoStartFocus: Boolean(payload.autoStartFocus),
          title: requiredText(payload, "title"),
          projectId: references.projectId,
          taskId: references.taskId,
          startedAt: null,
          endsAt: null,
          remainingSeconds: focusMinutes * 60,
          updatedAt: new Date(),
        };

        const [state] = await db
          .insert(pomodoroState)
          .values({ id: pomodoroId, ...values })
          .onConflictDoUpdate({
            target: pomodoroState.id,
            set: values,
          })
          .returning();
        return ok({ pomodoro: state });
      }

      case "startPomodoro": {
        const [activeTimer] = await db
          .select()
          .from(timeEntries)
          .where(
            and(
              eq(timeEntries.userId, userId),
              isNull(timeEntries.endTime),
            ),
          )
          .limit(1);
        if (activeTimer) {
          return Response.json(
            { error: "Сначала остановите свободный таймер" },
            { status: 409 },
          );
        }

        const [saved] = await db
          .select()
          .from(pomodoroState)
          .where(
            and(
              eq(pomodoroState.id, pomodoroId),
              eq(pomodoroState.userId, userId),
            ),
          )
          .limit(1);
        if (saved?.active) {
          return Response.json(
            { error: "Цикл Помодоро уже запущен" },
            { status: 409 },
          );
        }

        const focusMinutes = numberFrom(
          payload,
          "focusMinutes",
          saved?.focusMinutes ?? 25,
          1,
          180,
        );
        const startedAt = new Date();
        const remainingSeconds = focusMinutes * 60;
        const references = await ownedTimerReferences(db, userId, payload);
        const values = {
          userId,
          phase: "focus" as const,
          active: true,
          running: true,
          cycle: 0,
          focusMinutes,
          shortBreakMinutes: numberFrom(
            payload,
            "shortBreakMinutes",
            saved?.shortBreakMinutes ?? 5,
            1,
            60,
          ),
          longBreakMinutes: numberFrom(
            payload,
            "longBreakMinutes",
            saved?.longBreakMinutes ?? 15,
            1,
            120,
          ),
          cyclesBeforeLong: numberFrom(
            payload,
            "cyclesBeforeLong",
            saved?.cyclesBeforeLong ?? 4,
            2,
            12,
          ),
          autoStartBreak: Boolean(payload.autoStartBreak),
          autoStartFocus: Boolean(payload.autoStartFocus),
          title:
            requiredText(payload, "title") ||
            saved?.title ||
            "Фокус-сессия",
          projectId: references.projectId,
          taskId: references.taskId,
          startedAt,
          endsAt: new Date(startedAt.getTime() + remainingSeconds * 1000),
          remainingSeconds,
          updatedAt: startedAt,
        };

        const [state] = await db
          .insert(pomodoroState)
          .values({ id: pomodoroId, ...values })
          .onConflictDoUpdate({
            target: pomodoroState.id,
            set: values,
          })
          .returning();
        return ok({ pomodoro: state });
      }

      case "pausePomodoro": {
        const [current] = await db
          .select()
          .from(pomodoroState)
          .where(
            and(
              eq(pomodoroState.id, pomodoroId),
              eq(pomodoroState.userId, userId),
            ),
          )
          .limit(1);
        if (!current?.active || !current.running || !current.endsAt) {
          return Response.json(
            { error: "Активный отсчёт Помодоро не найден" },
            { status: 404 },
          );
        }
        const remainingSeconds = Math.max(
          0,
          Math.ceil((current.endsAt.getTime() - Date.now()) / 1000),
        );
        const [state] = await db
          .update(pomodoroState)
          .set({
            running: false,
            startedAt: null,
            endsAt: null,
            remainingSeconds,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(pomodoroState.id, pomodoroId),
              eq(pomodoroState.userId, userId),
            ),
          )
          .returning();
        return ok({ pomodoro: state });
      }

      case "resumePomodoro": {
        const [current] = await db
          .select()
          .from(pomodoroState)
          .where(
            and(
              eq(pomodoroState.id, pomodoroId),
              eq(pomodoroState.userId, userId),
            ),
          )
          .limit(1);
        if (!current?.active || current.running) {
          return Response.json(
            { error: "Приостановленный цикл Помодоро не найден" },
            { status: 404 },
          );
        }
        const startedAt = new Date();
        const remainingSeconds = Math.max(1, current.remainingSeconds);
        const [state] = await db
          .update(pomodoroState)
          .set({
            running: true,
            startedAt,
            endsAt: new Date(startedAt.getTime() + remainingSeconds * 1000),
            updatedAt: startedAt,
          })
          .where(
            and(
              eq(pomodoroState.id, pomodoroId),
              eq(pomodoroState.userId, userId),
            ),
          )
          .returning();
        return ok({ pomodoro: state });
      }

      case "resetPomodoro": {
        const [current] = await db
          .select()
          .from(pomodoroState)
          .where(
            and(
              eq(pomodoroState.id, pomodoroId),
              eq(pomodoroState.userId, userId),
            ),
          )
          .limit(1);
        const focusMinutes = current?.focusMinutes ?? 25;
        const values = {
          phase: "focus" as const,
          active: false,
          running: false,
          cycle: 0,
          startedAt: null,
          endsAt: null,
          remainingSeconds: focusMinutes * 60,
          updatedAt: new Date(),
        };
        const [state] = await db
          .insert(pomodoroState)
          .values({
            ...defaultPomodoro(userId),
            ...values,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: pomodoroState.id,
            set: values,
          })
          .returning();
        return ok({ pomodoro: state });
      }

      case "advancePomodoro": {
        const [current] = await db
          .select()
          .from(pomodoroState)
          .where(
            and(
              eq(pomodoroState.id, pomodoroId),
              eq(pomodoroState.userId, userId),
            ),
          )
          .limit(1);
        if (!current?.active) {
          return Response.json(
            { error: "Активный цикл Помодоро не найден" },
            { status: 404 },
          );
        }

        const expectedEndsAt = optionalText(
          payload,
          "expectedEndsAt",
          80,
        );
        if (
          current.running &&
          current.endsAt &&
          expectedEndsAt &&
          current.endsAt.toISOString() !== expectedEndsAt
        ) {
          return ok({ ignored: true, pomodoro: current });
        }

        const completed = Boolean(payload.completed);
        if (
          completed &&
          current.running &&
          current.endsAt &&
          current.endsAt.getTime() > Date.now() + 1_500
        ) {
          return Response.json(
            { error: "Интервал ещё не завершён" },
            { status: 409 },
          );
        }

        const nextCycle =
          current.phase === "focus" ? current.cycle + 1 : current.cycle;
        const nextPhase =
          current.phase === "focus"
            ? nextCycle % current.cyclesBeforeLong === 0
              ? ("long_break" as const)
              : ("short_break" as const)
            : ("focus" as const);
        const nextSeconds = phaseSeconds(nextPhase, current);
        const autoStart =
          nextPhase === "focus"
            ? current.autoStartFocus
            : current.autoStartBreak;
        const startedAt = autoStart ? new Date() : null;
        const endsAt = startedAt
          ? new Date(startedAt.getTime() + nextSeconds * 1000)
          : null;

        const [state] = await db
          .update(pomodoroState)
          .set({
            phase: nextPhase,
            running: autoStart,
            cycle: nextCycle,
            startedAt,
            endsAt,
            remainingSeconds: nextSeconds,
            updatedAt: new Date(),
          })
          .where(
            current.running && current.endsAt
              ? and(
                  eq(pomodoroState.id, pomodoroId),
                  eq(pomodoroState.userId, userId),
                  eq(pomodoroState.endsAt, current.endsAt),
                )
              : and(
                  eq(pomodoroState.id, pomodoroId),
                  eq(pomodoroState.userId, userId),
                ),
          )
          .returning();
        if (!state) return ok({ ignored: true });

        if (completed && current.phase === "focus") {
          const duration = current.focusMinutes * 60;
          const endTime = current.endsAt ?? new Date();
          await db.insert(timeEntries).values({
            userId,
            title: `Помодоро · ${current.title}`,
            projectId: current.projectId,
            taskId: current.taskId,
            startTime: new Date(endTime.getTime() - duration * 1000),
            endTime,
            duration,
            description: `Помодоро · цикл ${nextCycle}`,
          });
        }

        return ok({ pomodoro: state });
      }

      case "startTimer": {
        const [pomodoro] = await db
          .select()
          .from(pomodoroState)
          .where(
            and(
              eq(pomodoroState.id, pomodoroId),
              eq(pomodoroState.userId, userId),
            ),
          )
          .limit(1);
        if (pomodoro?.active) {
          return Response.json(
            { error: "Сначала завершите текущий цикл Помодоро" },
            { status: 409 },
          );
        }
        const [active] = await db
          .select()
          .from(timeEntries)
          .where(
            and(
              eq(timeEntries.userId, userId),
              isNull(timeEntries.endTime),
            ),
          )
          .limit(1);
        if (active) {
          return Response.json(
            { error: "Сначала остановите текущий таймер" },
            { status: 409 },
          );
        }
        const references = await ownedTimerReferences(db, userId, payload);
        const [entry] = await db
          .insert(timeEntries)
          .values({
            userId,
            title: requiredText(payload, "title"),
            description: optionalText(payload, "description"),
            projectId: references.projectId,
            taskId: references.taskId,
            startTime: new Date(),
          })
          .returning();
        return ok({ entry });
      }

      case "stopTimer": {
        const id = idFrom(payload);
        const [entry] = await db
          .select()
          .from(timeEntries)
          .where(
            and(
              eq(timeEntries.id, id),
              eq(timeEntries.userId, userId),
            ),
          )
          .limit(1);
        if (!entry || entry.endTime) {
          return Response.json({ error: "Активный таймер не найден" }, { status: 404 });
        }
        const endTime = new Date();
        const duration = Math.max(
          0,
          Math.floor((endTime.getTime() - entry.startTime.getTime()) / 1000),
        );
        await db
          .update(timeEntries)
          .set({ endTime, duration })
          .where(
            and(
              eq(timeEntries.id, id),
              eq(timeEntries.userId, userId),
            ),
          );
        return ok({ duration });
      }

      case "deleteTimeEntry": {
        const id = idFrom(payload);
        const [entry] = await db
          .select()
          .from(timeEntries)
          .where(
            and(
              eq(timeEntries.id, id),
              eq(timeEntries.userId, userId),
            ),
          )
          .limit(1);
        if (entry && !entry.endTime) {
          return Response.json(
            { error: "Остановите таймер перед удалением" },
            { status: 400 },
          );
        }
        await db
          .delete(timeEntries)
          .where(
            and(
              eq(timeEntries.id, id),
              eq(timeEntries.userId, userId),
            ),
          );
        return ok();
      }

      case "restoreDeleted": {
        const id = idFrom(payload);
        const entity = String(payload.entity ?? "");
        if (entity === "task") {
          await db
            .update(tasks)
            .set({ deletedAt: null })
            .where(and(eq(tasks.id, id), eq(tasks.userId, userId)));
        } else if (entity === "project") {
          const [project] = await db
            .select()
            .from(projects)
            .where(and(eq(projects.id, id), eq(projects.userId, userId)))
            .limit(1);
          if (!project?.deletedAt) {
            throw new Error("Удалённый проект не найден");
          }
          await db.batch([
            db
              .update(projects)
              .set({ deletedAt: null })
              .where(
                and(eq(projects.id, id), eq(projects.userId, userId)),
              ),
            db
              .update(tasks)
              .set({ deletedAt: null })
              .where(
                and(
                  eq(tasks.projectId, id),
                  eq(tasks.userId, userId),
                  eq(tasks.deletedAt, project.deletedAt),
                ),
              ),
          ]);
        } else if (entity === "habit") {
          await db
            .update(habits)
            .set({ deletedAt: null })
            .where(and(eq(habits.id, id), eq(habits.userId, userId)));
        } else if (entity === "note") {
          await db
            .update(notes)
            .set({ deletedAt: null })
            .where(and(eq(notes.id, id), eq(notes.userId, userId)));
        } else if (entity === "goal") {
          await db
            .update(goals)
            .set({ deletedAt: null })
            .where(and(eq(goals.id, id), eq(goals.userId, userId)));
        } else {
          throw new Error("Неизвестный тип записи в корзине");
        }
        return ok();
      }

      case "emptyTrash": {
        await db.batch([
          db
            .delete(tasks)
            .where(
              and(eq(tasks.userId, userId), isNotNull(tasks.deletedAt)),
            ),
          db
            .delete(notes)
            .where(
              and(eq(notes.userId, userId), isNotNull(notes.deletedAt)),
            ),
          db
            .delete(goals)
            .where(
              and(eq(goals.userId, userId), isNotNull(goals.deletedAt)),
            ),
          db
            .delete(habits)
            .where(
              and(eq(habits.userId, userId), isNotNull(habits.deletedAt)),
            ),
          db
            .delete(projects)
            .where(
              and(
                eq(projects.userId, userId),
                isNotNull(projects.deletedAt),
              ),
            ),
        ]);
        return ok();
      }

      case "previewPlan": {
        const preview = await previewPlan(db, payload.plan, userId);
        return ok({ preview });
      }

      case "importPlan": {
        const result = await importPlan(db, payload.plan, userId);
        return ok({
          import: result,
          undo: { entity: "import", id: result.batchId },
        });
      }

      case "undoPlanImport": {
        const batchId = requiredText(payload, "batchId", 80);
        const counts = await undoPlanImport(db, batchId, userId);
        return ok({ counts });
      }

      case "restoreBackup": {
        const counts = await restoreBackup(db, payload.backup, userId);
        return ok({ counts });
      }

      default:
        return Response.json({ error: "Неизвестное действие" }, { status: 400 });
    }
  } catch (error) {
    return Response.json(
      { error: message(error) },
      { status: isAuthenticationRequiredError(error) ? 401 : 400 },
    );
  }
}
