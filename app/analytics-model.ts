export type AnalyticsPeriod = "week" | "month" | "quarter" | "year";

type DateValue = Date | string | number | null;

export type AnalyticsTaskRow = {
  id: number;
  status: "todo" | "doing" | "done";
  dueDate: string | null;
  projectId: number | null;
  createdAt: DateValue;
  completedAt: DateValue;
  deletedAt: DateValue;
};

export type AnalyticsHabitRow = {
  id: number;
  frequency: "daily" | "weekdays" | "weekly";
  targetPerDay: number;
  createdAt: DateValue;
  deletedAt: DateValue;
};

export type AnalyticsHabitLogRow = {
  habitId: number;
  date: string;
  completed: boolean;
  count: number;
};

export type AnalyticsTimeEntryRow = {
  id: number;
  projectId: number | null;
  startTime: DateValue;
  endTime: DateValue;
  duration: number | null;
};

export type AnalyticsProjectRow = {
  id: number;
  title: string;
  color: string;
  status: string;
  deletedAt: DateValue;
};

export type AnalyticsEventRow = {
  id: number;
  entityType: "task" | "habit" | "focus" | "project";
  entityId: number;
  eventType: string;
  effectiveDate: string | null;
  projectId: number | null;
  durationSeconds: number | null;
  previousValue: string | null;
  nextValue: string | null;
  createdAt: DateValue;
};

export type AnalyticsInput = {
  period: AnalyticsPeriod;
  anchor: string;
  today?: string;
  timezoneOffset: number;
  projectId: number | null;
  trackingStartedAt: DateValue;
  tasks: AnalyticsTaskRow[];
  habits: AnalyticsHabitRow[];
  habitLogs: AnalyticsHabitLogRow[];
  timeEntries: AnalyticsTimeEntryRow[];
  projects: AnalyticsProjectRow[];
  events: AnalyticsEventRow[];
};

type PeriodWindow = {
  start: string;
  end: string;
  effectiveEnd: string;
};

type TaskState = AnalyticsTaskRow & {
  synthetic?: boolean;
};

type WindowResult = {
  planCompletion: number;
  plannedTasks: number;
  completedPlannedTasks: number;
  completedTasks: number;
  onTimeRate: number;
  onTimeTasks: number;
  completedWithDeadline: number;
  focusSeconds: number;
  habitConsistency: number;
  habitCompleted: number;
  habitExpected: number;
  overdueTasks: number;
  rescheduledTasks: number;
  daily: Array<{
    date: string;
    planned: number;
    completed: number;
    focusMinutes: number;
    habits: number;
  }>;
  projects: Array<{
    id: number | null;
    title: string;
    color: string;
    planned: number;
    completed: number;
    focusSeconds: number;
    overdue: number;
  }>;
};

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

function utcDateFromKey(value: string) {
  if (!DATE_KEY.test(value)) throw new Error("Некорректная дата аналитики");
  return new Date(`${value}T00:00:00.000Z`);
}

function keyFromUtcDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

export function addDays(value: string, amount: number) {
  const date = utcDateFromKey(value);
  date.setUTCDate(date.getUTCDate() + amount);
  return keyFromUtcDate(date);
}

function addMonths(value: string, amount: number) {
  const date = utcDateFromKey(value);
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + amount);
  return keyFromUtcDate(date);
}

function monthEnd(value: string) {
  const date = utcDateFromKey(value);
  date.setUTCMonth(date.getUTCMonth() + 1, 0);
  return keyFromUtcDate(date);
}

function quarterStart(value: string) {
  const date = utcDateFromKey(value);
  date.setUTCMonth(Math.floor(date.getUTCMonth() / 3) * 3, 1);
  return keyFromUtcDate(date);
}

function weekStart(value: string) {
  const date = utcDateFromKey(value);
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - weekday + 1);
  return keyFromUtcDate(date);
}

export function resolveAnalyticsPeriod(
  period: AnalyticsPeriod,
  anchor: string,
  today = anchor,
) {
  const anchorDate = utcDateFromKey(anchor);
  let start: string;
  let end: string;
  let previousStart: string;
  let previousEnd: string;

  if (period === "week") {
    start = weekStart(anchor);
    end = addDays(start, 6);
    previousStart = addDays(start, -7);
    previousEnd = addDays(start, -1);
  } else if (period === "month") {
    anchorDate.setUTCDate(1);
    start = keyFromUtcDate(anchorDate);
    end = monthEnd(start);
    previousStart = addMonths(start, -1);
    previousEnd = addDays(start, -1);
  } else if (period === "quarter") {
    start = quarterStart(anchor);
    end = addDays(addMonths(start, 3), -1);
    previousStart = addMonths(start, -3);
    previousEnd = addDays(start, -1);
  } else {
    start = `${anchor.slice(0, 4)}-01-01`;
    end = `${anchor.slice(0, 4)}-12-31`;
    previousStart = `${Number(anchor.slice(0, 4)) - 1}-01-01`;
    previousEnd = `${Number(anchor.slice(0, 4)) - 1}-12-31`;
  }

  return {
    current: {
      start,
      end,
      effectiveEnd: end < today ? end : today < start ? start : today,
    },
    previous: {
      start: previousStart,
      end: previousEnd,
      effectiveEnd: previousEnd,
    },
  };
}

export function shiftAnalyticsAnchor(
  period: AnalyticsPeriod,
  anchor: string,
  direction: -1 | 1,
) {
  if (period === "week") return addDays(anchor, 7 * direction);
  if (period === "month") return addMonths(anchor, direction);
  if (period === "quarter") return addMonths(anchor, 3 * direction);
  return `${Number(anchor.slice(0, 4)) + direction}-01-01`;
}

function timestamp(value: DateValue) {
  if (value === null || value === undefined || value === "") return null;
  const parsed =
    value instanceof Date
      ? value.getTime()
      : typeof value === "number"
        ? value
        : new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function localDateKey(value: DateValue, timezoneOffset: number) {
  const time = timestamp(value);
  if (time === null) return null;
  return new Date(time - timezoneOffset * 60_000).toISOString().slice(0, 10);
}

function localEndTimestamp(date: string, timezoneOffset: number) {
  return utcDateFromKey(addDays(date, 1)).getTime() + timezoneOffset * 60_000 - 1;
}

function inWindow(date: string | null, window: PeriodWindow) {
  return Boolean(date && date >= window.start && date <= window.effectiveEnd);
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function percent(numerator: number, denominator: number) {
  return denominator ? clampPercent((numerator / denominator) * 100) : 0;
}

function dateRange(start: string, end: string) {
  const result: string[] = [];
  for (let key = start; key <= end; key = addDays(key, 1)) result.push(key);
  return result;
}

function eventTime(event: AnalyticsEventRow) {
  return timestamp(event.createdAt) ?? 0;
}

function taskUniverse(
  tasks: AnalyticsTaskRow[],
  events: AnalyticsEventRow[],
) {
  const byId = new Map<number, TaskState>(
    tasks.map((task) => [task.id, { ...task }]),
  );

  for (const event of events) {
    if (event.eventType !== "task_created" || byId.has(event.entityId)) continue;
    byId.set(event.entityId, {
      id: event.entityId,
      status: "todo",
      dueDate: event.nextValue,
      projectId: event.projectId,
      createdAt: event.createdAt,
      completedAt: null,
      deletedAt: null,
      synthetic: true,
    });
  }

  return [...byId.values()];
}

function taskEventsById(events: AnalyticsEventRow[]) {
  const result = new Map<number, AnalyticsEventRow[]>();
  for (const event of events) {
    if (event.entityType !== "task") continue;
    const rows = result.get(event.entityId) ?? [];
    rows.push(event);
    result.set(event.entityId, rows);
  }
  for (const rows of result.values()) rows.sort((a, b) => eventTime(a) - eventTime(b));
  return result;
}

function completionAt(
  task: TaskState,
  events: AnalyticsEventRow[],
  windowEnd: number,
) {
  const statusEvents = events.filter(
    (event) =>
      eventTime(event) <= windowEnd &&
      (event.eventType === "task_completed" ||
        event.eventType === "task_reopened"),
  );
  if (statusEvents.length) {
    const latest = statusEvents[statusEvents.length - 1];
    return latest.eventType === "task_completed" ? eventTime(latest) : null;
  }
  const completedAt = timestamp(task.completedAt);
  return task.status === "done" &&
    completedAt !== null &&
    completedAt <= windowEnd
    ? completedAt
    : null;
}

function dueDateAt(
  task: TaskState,
  events: AnalyticsEventRow[],
  windowEnd: number,
) {
  let dueDate = task.dueDate;
  for (const event of events) {
    if (eventTime(event) > windowEnd) break;
    if (event.eventType === "task_created") dueDate = event.nextValue;
    if (event.eventType === "task_rescheduled") dueDate = event.nextValue;
  }
  return dueDate;
}

function habitUniverse(
  habits: AnalyticsHabitRow[],
  events: AnalyticsEventRow[],
) {
  const byId = new Map(habits.map((habit) => [habit.id, habit]));
  for (const event of events) {
    if (event.eventType !== "habit_created" || byId.has(event.entityId)) continue;
    const [frequency = "daily", target = "1"] = (event.nextValue ?? "").split(":");
    byId.set(event.entityId, {
      id: event.entityId,
      frequency:
        frequency === "weekdays" || frequency === "weekly"
          ? frequency
          : "daily",
      targetPerDay: Math.max(1, Number(target) || 1),
      createdAt: event.createdAt,
      deletedAt: null,
    });
  }
  return [...byId.values()];
}

function habitCompletionMap(
  logs: AnalyticsHabitLogRow[],
  events: AnalyticsEventRow[],
) {
  const result = new Map<string, number>();
  const eventRows = events
    .filter(
      (event) =>
        event.entityType === "habit" &&
        event.effectiveDate &&
        (event.eventType === "habit_completed" ||
          event.eventType === "habit_uncompleted"),
    )
    .sort((a, b) => eventTime(a) - eventTime(b));

  if (eventRows.length) {
    for (const event of eventRows) {
      const key = `${event.entityId}:${event.effectiveDate}`;
      result.set(
        key,
        event.eventType === "habit_completed"
          ? Math.max(1, Number(event.nextValue) || 1)
          : 0,
      );
    }
    return result;
  }

  for (const log of logs) {
    result.set(
      `${log.habitId}:${log.date}`,
      log.completed ? Math.max(0, log.count) : 0,
    );
  }
  return result;
}

function focusRows(
  entries: AnalyticsTimeEntryRow[],
  events: AnalyticsEventRow[],
) {
  const completedEvents = events.filter(
    (event) =>
      event.entityType === "focus" &&
      event.eventType === "focus_completed" &&
      event.durationSeconds,
  );
  if (completedEvents.length) {
    return completedEvents.map((event) => ({
      id: event.entityId,
      projectId: event.projectId,
      completedAt: event.createdAt,
      duration: Math.max(0, event.durationSeconds ?? 0),
    }));
  }
  return entries
    .filter((entry) => entry.endTime && entry.duration)
    .map((entry) => ({
      id: entry.id,
      projectId: entry.projectId,
      completedAt: entry.endTime,
      duration: Math.max(0, entry.duration ?? 0),
    }));
}

function expectedHabits(
  habits: AnalyticsHabitRow[],
  completions: Map<string, number>,
  window: PeriodWindow,
  timezoneOffset: number,
) {
  let expected = 0;
  let completed = 0;
  const daily = new Map<string, number>();

  for (const habit of habits) {
    const created = localDateKey(habit.createdAt, timezoneOffset) ?? window.start;
    const deleted = localDateKey(habit.deletedAt, timezoneOffset);
    const start = created > window.start ? created : window.start;
    const end =
      deleted && deleted < window.effectiveEnd ? deleted : window.effectiveEnd;
    if (start > end) continue;
    const target = Math.max(1, habit.targetPerDay || 1);
    const days = dateRange(start, end);

    for (const day of days) {
      const value = completions.get(`${habit.id}:${day}`) ?? 0;
      if (value > 0) daily.set(day, (daily.get(day) ?? 0) + value);
    }

    if (habit.frequency === "weekly") {
      const weeks = new Map<string, number>();
      for (const day of days) {
        const key = weekStart(day);
        weeks.set(
          key,
          (weeks.get(key) ?? 0) + (completions.get(`${habit.id}:${day}`) ?? 0),
        );
      }
      expected += weeks.size * target;
      completed += [...weeks.values()].reduce(
        (sum, value) => sum + Math.min(target, value),
        0,
      );
      continue;
    }

    for (const day of days) {
      const weekday = utcDateFromKey(day).getUTCDay();
      if (
        habit.frequency === "weekdays" &&
        (weekday === 0 || weekday === 6)
      ) {
        continue;
      }
      expected += target;
      completed += Math.min(
        target,
        completions.get(`${habit.id}:${day}`) ?? 0,
      );
    }
  }

  return { expected, completed, daily };
}

function computeWindow(
  input: AnalyticsInput,
  window: PeriodWindow,
  tasks: TaskState[],
  tasksEvents: Map<number, AnalyticsEventRow[]>,
) {
  const endTimestamp = localEndTimestamp(
    window.effectiveEnd,
    input.timezoneOffset,
  );
  const selectedTasks = tasks.filter(
    (task) => input.projectId === null || task.projectId === input.projectId,
  );
  const taskStates = selectedTasks.map((task) => {
    const events = tasksEvents.get(task.id) ?? [];
    const dueDate = dueDateAt(task, events, endTimestamp);
    const completion = completionAt(task, events, endTimestamp);
    return {
      task,
      events,
      dueDate,
      completion,
      completionDueDate:
        completion === null
          ? dueDate
          : dueDateAt(task, events, completion),
      completionDate: localDateKey(completion, input.timezoneOffset),
    };
  });
  const planned = taskStates.filter(({ task, dueDate }) => {
    const created = localDateKey(task.createdAt, input.timezoneOffset);
    const deleted = localDateKey(task.deletedAt, input.timezoneOffset);
    return (
      inWindow(dueDate, window) &&
      (!created || created <= window.effectiveEnd) &&
      (!deleted || deleted >= window.start)
    );
  });
  const completedPlanned = planned.filter(
    ({ completion }) => completion !== null,
  );
  const completed = taskStates.filter(({ completionDate }) =>
    inWindow(completionDate, window),
  );
  const completedWithDeadline = completed.filter(
    ({ completionDueDate }) => completionDueDate,
  );
  const onTime = completedWithDeadline.filter(
    ({ completionDate, completionDueDate }) =>
      Boolean(
        completionDate &&
          completionDueDate &&
          completionDate <= completionDueDate,
      ),
  );
  const overdue = planned.filter(({ completion }) => completion === null);
  const rescheduled = input.events.filter(
    (event) =>
      event.eventType === "task_rescheduled" &&
      inWindow(localDateKey(event.createdAt, input.timezoneOffset), window) &&
      (input.projectId === null || event.projectId === input.projectId),
  );

  const completionByDay = new Map<string, number>();
  for (const row of completed) {
    if (!row.completionDate) continue;
    completionByDay.set(
      row.completionDate,
      (completionByDay.get(row.completionDate) ?? 0) + 1,
    );
  }
  const plannedByDay = new Map<string, number>();
  for (const row of planned) {
    if (!row.dueDate) continue;
    plannedByDay.set(row.dueDate, (plannedByDay.get(row.dueDate) ?? 0) + 1);
  }

  const focus = focusRows(input.timeEntries, input.events).filter(
    (entry) =>
      inWindow(
        localDateKey(entry.completedAt, input.timezoneOffset),
        window,
      ) &&
      (input.projectId === null || entry.projectId === input.projectId),
  );
  const focusByDay = new Map<string, number>();
  for (const entry of focus) {
    const key = localDateKey(entry.completedAt, input.timezoneOffset);
    if (!key) continue;
    focusByDay.set(key, (focusByDay.get(key) ?? 0) + entry.duration);
  }

  const habits = habitUniverse(input.habits, input.events);
  const habitResult = expectedHabits(
    habits,
    habitCompletionMap(input.habitLogs, input.events),
    window,
    input.timezoneOffset,
  );

  const projectMap = new Map<
    number | null,
    WindowResult["projects"][number]
  >();
  const projectDetails = new Map(
    input.projects.map((project) => [project.id, project]),
  );
  const ensureProject = (projectId: number | null) => {
    const existing = projectMap.get(projectId);
    if (existing) return existing;
    const project = projectId === null ? null : projectDetails.get(projectId);
    const next = {
      id: projectId,
      title: project?.title ?? (projectId === null ? "Без проекта" : "Удалённый проект"),
      color: project?.color ?? "#94a3b8",
      planned: 0,
      completed: 0,
      focusSeconds: 0,
      overdue: 0,
    };
    projectMap.set(projectId, next);
    return next;
  };
  for (const row of planned) {
    const project = ensureProject(row.task.projectId);
    project.planned += 1;
    if (row.completion !== null) project.completed += 1;
    else project.overdue += 1;
  }
  for (const entry of focus) {
    ensureProject(entry.projectId).focusSeconds += entry.duration;
  }

  const daily = dateRange(window.start, window.effectiveEnd).map((date) => ({
    date,
    planned: plannedByDay.get(date) ?? 0,
    completed: completionByDay.get(date) ?? 0,
    focusMinutes: Math.round((focusByDay.get(date) ?? 0) / 60),
    habits: habitResult.daily.get(date) ?? 0,
  }));

  return {
    planCompletion: percent(completedPlanned.length, planned.length),
    plannedTasks: planned.length,
    completedPlannedTasks: completedPlanned.length,
    completedTasks: completed.length,
    onTimeRate: percent(onTime.length, completedWithDeadline.length),
    onTimeTasks: onTime.length,
    completedWithDeadline: completedWithDeadline.length,
    focusSeconds: focus.reduce((sum, entry) => sum + entry.duration, 0),
    habitConsistency: percent(habitResult.completed, habitResult.expected),
    habitCompleted: habitResult.completed,
    habitExpected: habitResult.expected,
    overdueTasks: overdue.length,
    rescheduledTasks: rescheduled.length,
    daily,
    projects: [...projectMap.values()]
      .sort(
        (left, right) =>
          right.focusSeconds - left.focusSeconds ||
          right.completed - left.completed ||
          left.title.localeCompare(right.title, "ru"),
      )
      .slice(0, 8),
  } satisfies WindowResult;
}

function rateDelta(current: number, previous: number) {
  return current - previous;
}

function valueDelta(current: number, previous: number) {
  if (!previous) return current ? null : 0;
  return Math.round(((current - previous) / previous) * 100);
}

export function buildAnalyticsSnapshot(input: AnalyticsInput) {
  const ranges = resolveAnalyticsPeriod(
    input.period,
    input.anchor,
    input.today ?? input.anchor,
  );
  const tasks = taskUniverse(input.tasks, input.events);
  const eventsByTask = taskEventsById(input.events);
  const current = computeWindow(input, ranges.current, tasks, eventsByTask);
  const previous = computeWindow(input, ranges.previous, tasks, eventsByTask);
  const bestDay = [...current.daily].sort(
    (left, right) =>
      right.completed * 4 +
        right.habits * 2 +
        Math.min(4, right.focusMinutes / 25) -
        (left.completed * 4 +
          left.habits * 2 +
          Math.min(4, left.focusMinutes / 25)),
  )[0];

  return {
    period: input.period,
    range: ranges.current,
    previousRange: ranges.previous,
    projectId: input.projectId,
    habitsAreGlobal: input.projectId !== null,
    trackingStartedAt: timestamp(input.trackingStartedAt),
    metrics: {
      planCompletion: {
        value: current.planCompletion,
        numerator: current.completedPlannedTasks,
        denominator: current.plannedTasks,
        previous: previous.planCompletion,
        delta: rateDelta(current.planCompletion, previous.planCompletion),
      },
      onTime: {
        value: current.onTimeRate,
        numerator: current.onTimeTasks,
        denominator: current.completedWithDeadline,
        previous: previous.onTimeRate,
        delta: rateDelta(current.onTimeRate, previous.onTimeRate),
      },
      focus: {
        value: current.focusSeconds,
        previous: previous.focusSeconds,
        delta: valueDelta(current.focusSeconds, previous.focusSeconds),
      },
      habits: {
        value: current.habitConsistency,
        numerator: current.habitCompleted,
        denominator: current.habitExpected,
        previous: previous.habitConsistency,
        delta: rateDelta(current.habitConsistency, previous.habitConsistency),
      },
      completedTasks: current.completedTasks,
      overdueTasks: current.overdueTasks,
      rescheduledTasks: current.rescheduledTasks,
    },
    daily: current.daily,
    projects: current.projects,
    bestDay: bestDay?.date ?? null,
  };
}

export type AnalyticsSnapshot = ReturnType<typeof buildAnalyticsSnapshot>;
