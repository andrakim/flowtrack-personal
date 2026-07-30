import { and, desc, eq, inArray } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { getDb } from "@/db";
import {
  goals,
  habits,
  importBatches,
  importRecords,
  kanbanColumns,
  notes,
  projects,
  tasks,
} from "@/db/schema";

type FlowDb = Awaited<ReturnType<typeof getDb>>;
type Payload = Record<string, unknown>;
type TaskStatus = "todo" | "doing" | "done";

const LIMITS = {
  projects: 100,
  columns: 500,
  tasks: 2_000,
  habits: 200,
  notes: 500,
  goals: 200,
} as const;
const MAX_GOAL_VALUE = 1_000_000_000_000;

function record(value: unknown, label: string): Payload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Раздел «${label}» имеет неверный формат`);
  }
  return value as Payload;
}

function list(data: Payload, key: keyof typeof LIMITS) {
  const value = data[key];
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new Error(`Раздел «${key}» должен быть массивом`);
  }
  if (value.length > LIMITS[key]) {
    throw new Error(`В разделе «${key}» слишком много записей`);
  }
  return value.map((item, index) => record(item, `${key}[${index}]`));
}

function text(value: unknown, label: string, max: number, required = false) {
  const result = String(value ?? "").trim();
  if (required && !result) throw new Error(`Поле «${label}» обязательно`);
  if (result.length > max) throw new Error(`Поле «${label}» слишком длинное`);
  return result;
}

function nullableText(value: unknown, label: string, max: number) {
  return text(value, label, max) || null;
}

function ref(value: unknown, label: string, fallback?: string) {
  const result = text(value ?? fallback, label, 80, true);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/.test(result)) {
    throw new Error(`Некорректная ссылка «${label}»`);
  }
  return result;
}

function optionalRef(value: unknown, label: string) {
  if (value === undefined || value === null || value === "") return null;
  return ref(value, label);
}

function color(value: unknown, fallback: string) {
  const result = String(value ?? "");
  return /^#[0-9a-f]{6}$/i.test(result) ? result : fallback;
}

function enumValue<const T extends readonly string[]>(
  value: unknown,
  label: string,
  values: T,
  fallback: T[number],
) {
  const result = String(value ?? "");
  if (!result) return fallback;
  if (!(values as readonly string[]).includes(result)) {
    throw new Error(`Некорректное значение «${label}»`);
  }
  return result as T[number];
}

function integer(
  value: unknown,
  label: string,
  fallback: number,
  min = 0,
  max = 1_000_000,
) {
  if (value === undefined || value === null || value === "") return fallback;
  const result = Number(value);
  if (!Number.isInteger(result) || result < min || result > max) {
    throw new Error(`Некорректное число «${label}»`);
  }
  return result;
}

function dateKey(value: unknown, label: string) {
  if (value === undefined || value === null || value === "") return null;
  const result = text(value, label, 10, true);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) {
    throw new Error(`Некорректная дата «${label}»`);
  }
  return result;
}

function timeKey(value: unknown, label: string) {
  if (value === undefined || value === null || value === "") return null;
  const result = text(value, label, 5, true);
  if (!/^\d{2}:\d{2}$/.test(result)) {
    throw new Error(`Некорректное время «${label}»`);
  }
  return result;
}

function tags(value: unknown, label: string) {
  if (value === undefined || value === null || value === "") return [];
  if (!Array.isArray(value)) throw new Error(`Некорректные теги «${label}»`);
  return [
    ...new Set(
      value
        .map((item) => text(item, label, 40))
        .filter(Boolean),
    ),
  ].slice(0, 20);
}

function normalizeTitle(value: string) {
  return value.trim().toLocaleLowerCase("ru-RU").replace(/\s+/g, " ");
}

function uniqueRefs(rows: Array<{ ref: string }>, label: string) {
  if (new Set(rows.map((row) => row.ref)).size !== rows.length) {
    throw new Error(`В разделе «${label}» повторяются ссылки ref`);
  }
}

type NormalizedPlan = ReturnType<typeof normalizePlan>;

export function normalizePlan(value: unknown) {
  const plan = record(value, "plan");
  if (plan.format !== "flowtrack-plan") {
    throw new Error("Это не план FlowTrack");
  }
  const version = Number(plan.schemaVersion ?? plan.version);
  if (version !== 1) {
    throw new Error("Версия плана пока не поддерживается");
  }
  const data =
    plan.data && typeof plan.data === "object" && !Array.isArray(plan.data)
      ? record(plan.data, "data")
      : plan;

  const projectRows = list(data, "projects").map((row, index) => ({
    ref: ref(row.ref, `projects[${index}].ref`, `project-${index + 1}`),
    title: text(row.title, `projects[${index}].title`, 255, true),
    description: nullableText(
      row.description,
      `projects[${index}].description`,
      4_000,
    ),
    color: color(row.color, "#7c3aed"),
  }));
  const projectRefs = new Set(projectRows.map((row) => row.ref));

  const columnRows = list(data, "columns").map((row, index) => {
    const projectRef = ref(
      row.projectRef,
      `columns[${index}].projectRef`,
    );
    if (!projectRefs.has(projectRef)) {
      throw new Error(
        `Колонка «${String(row.title ?? index + 1)}» ссылается на отсутствующий проект`,
      );
    }
    return {
      ref: ref(row.ref, `columns[${index}].ref`, `column-${index + 1}`),
      projectRef,
      title: text(row.title, `columns[${index}].title`, 255, true),
      color: color(row.color, "#94a3b8"),
      order: integer(row.order, `columns[${index}].order`, index, 0, 1_000),
    };
  });
  const columnRefs = new Set(columnRows.map((row) => row.ref));
  const columnsByRef = new Map(
    columnRows.map((row) => [row.ref, row] as const),
  );

  const taskRows = list(data, "tasks").map((row, index) => {
    const projectRef = optionalRef(
      row.projectRef,
      `tasks[${index}].projectRef`,
    );
    const columnRef = optionalRef(
      row.columnRef,
      `tasks[${index}].columnRef`,
    );
    if (projectRef && !projectRefs.has(projectRef)) {
      throw new Error(
        `Задача «${String(row.title ?? index + 1)}» ссылается на отсутствующий проект`,
      );
    }
    if (columnRef && !columnRefs.has(columnRef)) {
      throw new Error(
        `Задача «${String(row.title ?? index + 1)}» ссылается на отсутствующую колонку`,
      );
    }
    if (
      columnRef &&
      (!projectRef ||
        columnsByRef.get(columnRef)?.projectRef !== projectRef)
    ) {
      throw new Error(
        `Задача «${String(row.title ?? index + 1)}» должна ссылаться на проект своей колонки`,
      );
    }
    return {
      ref: ref(row.ref, `tasks[${index}].ref`, `task-${index + 1}`),
      title: text(row.title, `tasks[${index}].title`, 255, true),
      description: nullableText(
        row.description,
        `tasks[${index}].description`,
        4_000,
      ),
      status: enumValue(
        row.status,
        `tasks[${index}].status`,
        ["todo", "doing", "done"] as const,
        "todo",
      ),
      priority: enumValue(
        row.priority,
        `tasks[${index}].priority`,
        ["low", "medium", "high"] as const,
        "medium",
      ),
      dueDate: dateKey(row.dueDate, `tasks[${index}].dueDate`),
      dueTime: timeKey(row.dueTime, `tasks[${index}].dueTime`),
      estimatedMinutes:
        row.estimatedMinutes === undefined ||
        row.estimatedMinutes === null ||
        row.estimatedMinutes === ""
          ? null
          : integer(
              row.estimatedMinutes,
              `tasks[${index}].estimatedMinutes`,
              0,
              1,
              100_000,
            ),
      projectRef,
      columnRef,
      inbox: Boolean(row.inbox) || !projectRef,
      recurrence: enumValue(
        row.recurrence,
        `tasks[${index}].recurrence`,
        ["none", "daily", "weekdays", "weekly", "monthly"] as const,
        "none",
      ),
      tags: tags(row.tags, `tasks[${index}].tags`),
    };
  });

  const habitRows = list(data, "habits").map((row, index) => ({
    ref: ref(row.ref, `habits[${index}].ref`, `habit-${index + 1}`),
    title: text(row.title, `habits[${index}].title`, 255, true),
    description: nullableText(
      row.description,
      `habits[${index}].description`,
      4_000,
    ),
    color: color(row.color, "#6366f1"),
    icon: text(row.icon, `habits[${index}].icon`, 30) || "star",
    frequency: enumValue(
      row.frequency,
      `habits[${index}].frequency`,
      ["daily", "weekdays", "weekly"] as const,
      "daily",
    ),
    targetPerDay: integer(
      row.targetPerDay,
      `habits[${index}].targetPerDay`,
      1,
      1,
      99,
    ),
  }));

  const noteRows = list(data, "notes").map((row, index) => ({
    ref: ref(row.ref, `notes[${index}].ref`, `note-${index + 1}`),
    title: text(row.title, `notes[${index}].title`, 255, true),
    content: text(row.content, `notes[${index}].content`, 100_000),
    color: color(row.color, "#fef3c7"),
    pinned: Boolean(row.pinned),
    tags: tags(row.tags, `notes[${index}].tags`),
  }));

  const goalRows = list(data, "goals").map((row, index) => ({
    ref: ref(row.ref, `goals[${index}].ref`, `goal-${index + 1}`),
    title: text(row.title, `goals[${index}].title`, 255, true),
    description: nullableText(
      row.description,
      `goals[${index}].description`,
      4_000,
    ),
    category: text(row.category, `goals[${index}].category`, 60) || "personal",
    targetValue:
      row.targetValue === undefined ||
      row.targetValue === null ||
      row.targetValue === ""
        ? null
        : integer(
            row.targetValue,
            `goals[${index}].targetValue`,
            0,
            1,
            MAX_GOAL_VALUE,
          ),
    currentValue: integer(
      row.currentValue,
      `goals[${index}].currentValue`,
      0,
      0,
      MAX_GOAL_VALUE,
    ),
    unit: nullableText(row.unit, `goals[${index}].unit`, 40),
    deadline: dateKey(row.deadline, `goals[${index}].deadline`),
    color: color(row.color, "#10b981"),
  }));

  uniqueRefs(projectRows, "projects");
  uniqueRefs(columnRows, "columns");
  uniqueRefs(taskRows, "tasks");
  uniqueRefs(habitRows, "habits");
  uniqueRefs(noteRows, "notes");
  uniqueRefs(goalRows, "goals");

  return {
    title: text(plan.title, "title", 255) || "План от ChatGPT",
    projects: projectRows,
    columns: columnRows,
    tasks: taskRows,
    habits: habitRows,
    notes: noteRows,
    goals: goalRows,
  };
}

async function currentState(db: FlowDb, userId: number) {
  const [
    projectRows,
    taskRows,
    habitRows,
    noteRows,
    goalRows,
  ] = await Promise.all([
    db.select().from(projects).where(eq(projects.userId, userId)),
    db.select().from(tasks).where(eq(tasks.userId, userId)),
    db.select().from(habits).where(eq(habits.userId, userId)),
    db.select().from(notes).where(eq(notes.userId, userId)),
    db.select().from(goals).where(eq(goals.userId, userId)),
  ]);
  const projectIds = projectRows.map((project) => project.id);
  const columnRows = projectIds.length
    ? await db
        .select()
        .from(kanbanColumns)
        .where(inArray(kanbanColumns.projectId, projectIds))
    : [];
  return {
    projectRows,
    columnRows,
    taskRows,
    habitRows,
    noteRows,
    goalRows,
  };
}

function planCounts(plan: NormalizedPlan) {
  return {
    projects: plan.projects.length,
    columns: plan.columns.length,
    tasks: plan.tasks.length,
    habits: plan.habits.length,
    notes: plan.notes.length,
    goals: plan.goals.length,
  };
}

export async function previewPlan(
  db: FlowDb,
  value: unknown,
  userId: number,
) {
  const plan = normalizePlan(value);
  const state = await currentState(db, userId);
  const existingProjectTitles = new Set(
    state.projectRows
      .filter((row) => !row.deletedAt)
      .map((row) => normalizeTitle(row.title)),
  );
  const existingHabitTitles = new Set(
    state.habitRows
      .filter((row) => !row.deletedAt)
      .map((row) => normalizeTitle(row.title)),
  );
  const existingNoteTitles = new Set(
    state.noteRows
      .filter((row) => !row.deletedAt)
      .map((row) => normalizeTitle(row.title)),
  );
  const existingGoalTitles = new Set(
    state.goalRows
      .filter((row) => !row.deletedAt)
      .map((row) => normalizeTitle(row.title)),
  );
  const existingTaskKeys = new Set(
    state.taskRows
      .filter((row) => !row.deletedAt)
      .map(
        (row) =>
          `${normalizeTitle(row.title)}|${row.dueDate ?? ""}|${row.projectId ?? ""}`,
      ),
  );
  const projectIdsByRef = new Map<string, number | string>();
  plan.projects.forEach((project) => {
    const existing = state.projectRows.find(
      (row) =>
        !row.deletedAt &&
        normalizeTitle(row.title) === normalizeTitle(project.title),
    );
    projectIdsByRef.set(project.ref, existing?.id ?? `new:${project.ref}`);
  });

  return {
    title: plan.title,
    counts: planCounts(plan),
    duplicates: {
      projects: plan.projects.filter((row) =>
        existingProjectTitles.has(normalizeTitle(row.title)),
      ).length,
      tasks: plan.tasks.filter((row) => {
        const projectId = row.projectRef
          ? projectIdsByRef.get(row.projectRef)
          : null;
        return existingTaskKeys.has(
          `${normalizeTitle(row.title)}|${row.dueDate ?? ""}|${projectId ?? ""}`,
        );
      }).length,
      habits: plan.habits.filter((row) =>
        existingHabitTitles.has(normalizeTitle(row.title)),
      ).length,
      notes: plan.notes.filter((row) =>
        existingNoteTitles.has(normalizeTitle(row.title)),
      ).length,
      goals: plan.goals.filter((row) =>
        existingGoalTitles.has(normalizeTitle(row.title)),
      ).length,
    },
    sample: {
      projects: plan.projects.slice(0, 5).map((row) => row.title),
      tasks: plan.tasks.slice(0, 8).map((row) => row.title),
      habits: plan.habits.slice(0, 5).map((row) => row.title),
    },
  };
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

export async function importPlan(
  db: FlowDb,
  value: unknown,
  userId: number,
) {
  const plan = normalizePlan(value);
  const state = await currentState(db, userId);
  const batchId = `imp_${crypto.randomUUID()}`;
  const now = new Date();
  const [
    lastProject,
    lastColumn,
    lastTask,
    lastHabit,
    lastNote,
    lastGoal,
  ] = await Promise.all([
    db
      .select({ id: projects.id })
      .from(projects)
      .orderBy(desc(projects.id))
      .limit(1),
    db
      .select({ id: kanbanColumns.id })
      .from(kanbanColumns)
      .orderBy(desc(kanbanColumns.id))
      .limit(1),
    db
      .select({ id: tasks.id })
      .from(tasks)
      .orderBy(desc(tasks.id))
      .limit(1),
    db
      .select({ id: habits.id })
      .from(habits)
      .orderBy(desc(habits.id))
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
  let nextProjectId = lastProject[0]?.id ?? 0;
  let nextColumnId = lastColumn[0]?.id ?? 0;
  let nextTaskId = lastTask[0]?.id ?? 0;
  let nextHabitId = lastHabit[0]?.id ?? 0;
  let nextNoteId = lastNote[0]?.id ?? 0;
  let nextGoalId = lastGoal[0]?.id ?? 0;

  const statements: BatchItem<"sqlite">[] = [];
  const records: Array<{
    entityType: "project" | "column" | "task" | "habit" | "note" | "goal";
    recordId: number;
  }> = [];
  const counts = {
    projects: 0,
    columns: 0,
    tasks: 0,
    habits: 0,
    notes: 0,
    goals: 0,
    skipped: 0,
  };

  const projectIds = new Map<string, number>();
  const columnsByProject = new Map<number, Array<{ id: number; order: number }>>();
  state.columnRows.forEach((column) => {
    const values = columnsByProject.get(column.projectId) ?? [];
    values.push({ id: column.id, order: column.order });
    columnsByProject.set(column.projectId, values);
  });

  for (const item of plan.projects) {
    const existing = state.projectRows.find(
      (row) =>
        !row.deletedAt &&
        normalizeTitle(row.title) === normalizeTitle(item.title),
    );
    if (existing) {
      projectIds.set(item.ref, existing.id);
      counts.skipped += 1;
      continue;
    }
    nextProjectId += 1;
    projectIds.set(item.ref, nextProjectId);
    statements.push(
      db.insert(projects).values({
        id: nextProjectId,
        userId,
        title: item.title,
        description: item.description,
        color: item.color,
        status: "active",
        archived: false,
        createdAt: now,
      }),
    );
    records.push({ entityType: "project", recordId: nextProjectId });
    counts.projects += 1;
  }

  const columnIds = new Map<string, number>();
  for (const project of plan.projects) {
    const projectId = projectIds.get(project.ref);
    if (!projectId) continue;
    const requested = plan.columns
      .filter((column) => column.projectRef === project.ref)
      .sort((left, right) => left.order - right.order);
    const specifications = requested.length
      ? requested
      : [
          {
            ref: `${project.ref}:todo`,
            projectRef: project.ref,
            title: "Нужно сделать",
            color: "#64748b",
            order: 0,
          },
          {
            ref: `${project.ref}:doing`,
            projectRef: project.ref,
            title: "В работе",
            color: "#f59e0b",
            order: 1,
          },
          {
            ref: `${project.ref}:done`,
            projectRef: project.ref,
            title: "Готово",
            color: "#10b981",
            order: 2,
          },
        ];
    const currentColumns = columnsByProject.get(projectId) ?? [];
    const currentRows = state.columnRows.filter(
      (column) => column.projectId === projectId,
    );

    for (const item of specifications) {
      const existing = currentRows.find(
        (column) =>
          normalizeTitle(column.title) === normalizeTitle(item.title),
      );
      if (existing) {
        columnIds.set(item.ref, existing.id);
        continue;
      }
      nextColumnId += 1;
      columnIds.set(item.ref, nextColumnId);
      const column = { id: nextColumnId, order: item.order };
      currentColumns.push(column);
      statements.push(
        db.insert(kanbanColumns).values({
          id: nextColumnId,
          projectId,
          title: item.title,
          color: item.color,
          order: item.order,
          createdAt: now,
        }),
      );
      records.push({ entityType: "column", recordId: nextColumnId });
      counts.columns += 1;
    }
    currentColumns.sort((left, right) => left.order - right.order);
    columnsByProject.set(projectId, currentColumns);
  }

  const taskKeys = new Set(
    state.taskRows
      .filter((row) => !row.deletedAt)
      .map(
        (row) =>
          `${normalizeTitle(row.title)}|${row.dueDate ?? ""}|${row.projectId ?? ""}`,
      ),
  );
  const ordersByColumn = new Map<number, number>();
  state.taskRows.forEach((task) => {
    if (task.kanbanColumnId === null) return;
    ordersByColumn.set(
      task.kanbanColumnId,
      Math.max(ordersByColumn.get(task.kanbanColumnId) ?? -1, task.kanbanOrder),
    );
  });

  for (const item of plan.tasks) {
    const projectId = item.projectRef
      ? (projectIds.get(item.projectRef) ?? null)
      : null;
    const duplicateKey = `${normalizeTitle(item.title)}|${item.dueDate ?? ""}|${projectId ?? ""}`;
    if (taskKeys.has(duplicateKey)) {
      counts.skipped += 1;
      continue;
    }
    const projectColumns = projectId
      ? (columnsByProject.get(projectId) ?? [])
      : [];
    const requestedColumnId = item.columnRef
      ? (columnIds.get(item.columnRef) ?? null)
      : null;
    const kanbanColumnId =
      requestedColumnId ?? columnForStatus(projectColumns, item.status);
    const status = kanbanColumnId
      ? statusForColumn(projectColumns, kanbanColumnId)
      : item.status;
    nextTaskId += 1;
    const kanbanOrder = kanbanColumnId
      ? (ordersByColumn.get(kanbanColumnId) ?? -1) + 1
      : 0;
    if (kanbanColumnId) ordersByColumn.set(kanbanColumnId, kanbanOrder);
    statements.push(
      db.insert(tasks).values({
        id: nextTaskId,
        userId,
        title: item.title,
        description: item.description,
        status,
        priority: item.priority,
        dueDate: item.dueDate,
        dueTime: item.dueTime,
        estimatedMinutes: item.estimatedMinutes,
        projectId,
        kanbanColumnId,
        kanbanOrder,
        inbox: item.inbox,
        recurrence: item.recurrence,
        tags: item.tags,
        createdAt: now,
        completedAt: status === "done" ? now : null,
      }),
    );
    records.push({ entityType: "task", recordId: nextTaskId });
    taskKeys.add(duplicateKey);
    counts.tasks += 1;
  }

  const habitTitles = new Set(
    state.habitRows
      .filter((row) => !row.deletedAt)
      .map((row) => normalizeTitle(row.title)),
  );
  for (const item of plan.habits) {
    const title = normalizeTitle(item.title);
    if (habitTitles.has(title)) {
      counts.skipped += 1;
      continue;
    }
    nextHabitId += 1;
    statements.push(
      db.insert(habits).values({
        id: nextHabitId,
        userId,
        title: item.title,
        description: item.description,
        color: item.color,
        icon: item.icon,
        frequency: item.frequency,
        targetPerDay: item.targetPerDay,
        order: nextHabitId,
        createdAt: now,
      }),
    );
    records.push({ entityType: "habit", recordId: nextHabitId });
    habitTitles.add(title);
    counts.habits += 1;
  }

  const noteTitles = new Set(
    state.noteRows
      .filter((row) => !row.deletedAt)
      .map((row) => normalizeTitle(row.title)),
  );
  for (const item of plan.notes) {
    const title = normalizeTitle(item.title);
    if (noteTitles.has(title)) {
      counts.skipped += 1;
      continue;
    }
    nextNoteId += 1;
    statements.push(
      db.insert(notes).values({
        id: nextNoteId,
        userId,
        title: item.title,
        content: item.content,
        color: item.color,
        pinned: item.pinned,
        tags: item.tags,
        order: nextNoteId,
        createdAt: now,
        updatedAt: now,
      }),
    );
    records.push({ entityType: "note", recordId: nextNoteId });
    noteTitles.add(title);
    counts.notes += 1;
  }

  const goalTitles = new Set(
    state.goalRows
      .filter((row) => !row.deletedAt)
      .map((row) => normalizeTitle(row.title)),
  );
  for (const item of plan.goals) {
    const title = normalizeTitle(item.title);
    if (goalTitles.has(title)) {
      counts.skipped += 1;
      continue;
    }
    nextGoalId += 1;
    statements.push(
      db.insert(goals).values({
        id: nextGoalId,
        userId,
        title: item.title,
        description: item.description,
        category: item.category,
        targetValue: item.targetValue,
        currentValue: item.currentValue,
        unit: item.unit,
        deadline: item.deadline,
        status:
          item.targetValue !== null && item.currentValue >= item.targetValue
            ? "completed"
            : "active",
        color: item.color,
        createdAt: now,
      }),
    );
    records.push({ entityType: "goal", recordId: nextGoalId });
    goalTitles.add(title);
    counts.goals += 1;
  }

  const persistedCounts = {
    projects: counts.projects,
    columns: counts.columns,
    tasks: counts.tasks,
    habits: counts.habits,
    notes: counts.notes,
    goals: counts.goals,
    skipped: counts.skipped,
  };
  const batchStatements: BatchItem<"sqlite">[] = [
    db.insert(importBatches).values({
      id: batchId,
      userId,
      title: plan.title,
      source: "flowtrack-plan",
      counts: persistedCounts,
      createdAt: now,
    }),
    ...statements,
  ];
  if (records.length) {
    batchStatements.push(
      db.insert(importRecords).values(
        records.map((item) => ({
          batchId,
          entityType: item.entityType,
          recordId: item.recordId,
        })),
      ),
    );
  }
  await db.batch(
    batchStatements as [
      BatchItem<"sqlite">,
      ...Array<BatchItem<"sqlite">>,
    ],
  );

  return {
    batchId,
    title: plan.title,
    counts: persistedCounts,
  };
}

export async function undoPlanImport(
  db: FlowDb,
  batchIdValue: unknown,
  userId: number,
) {
  const batchId = text(batchIdValue, "batchId", 100, true);
  const [batch] = await db
    .select()
    .from(importBatches)
    .where(
      and(
        eq(importBatches.id, batchId),
        eq(importBatches.userId, userId),
      ),
    )
    .limit(1);
  if (!batch) throw new Error("История импорта не найдена");

  const records = await db
    .select()
    .from(importRecords)
    .where(eq(importRecords.batchId, batchId));
  const ids = (entityType: (typeof records)[number]["entityType"]) =>
    records
      .filter((record) => record.entityType === entityType)
      .map((record) => record.recordId);
  const taskIds = ids("task");
  const noteIds = ids("note");
  const goalIds = ids("goal");
  const habitIds = ids("habit");
  const columnIds = ids("column");
  const projectIds = ids("project");
  const statements: BatchItem<"sqlite">[] = [];
  if (taskIds.length) {
    statements.push(
      db
        .delete(tasks)
        .where(
          and(inArray(tasks.id, taskIds), eq(tasks.userId, userId)),
        ),
    );
  }
  if (noteIds.length) {
    statements.push(
      db
        .delete(notes)
        .where(
          and(inArray(notes.id, noteIds), eq(notes.userId, userId)),
        ),
    );
  }
  if (goalIds.length) {
    statements.push(
      db
        .delete(goals)
        .where(
          and(inArray(goals.id, goalIds), eq(goals.userId, userId)),
        ),
    );
  }
  if (habitIds.length) {
    statements.push(
      db
        .delete(habits)
        .where(
          and(inArray(habits.id, habitIds), eq(habits.userId, userId)),
        ),
    );
  }
  if (columnIds.length) {
    statements.push(
      db.delete(kanbanColumns).where(inArray(kanbanColumns.id, columnIds)),
    );
  }
  if (projectIds.length) {
    statements.push(
      db
        .delete(projects)
        .where(
          and(inArray(projects.id, projectIds), eq(projects.userId, userId)),
        ),
    );
  }
  statements.push(
    db
      .delete(importBatches)
      .where(
        and(
          eq(importBatches.id, batchId),
          eq(importBatches.userId, userId),
        ),
      ),
  );
  await db.batch(
    statements as [
      BatchItem<"sqlite">,
      ...Array<BatchItem<"sqlite">>,
    ],
  );
  return { title: batch.title };
}
