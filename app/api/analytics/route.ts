import { asc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import {
  analyticsEvents,
  analyticsTracking,
  habitLogs,
  habits,
  projects,
  tasks,
  timeEntries,
} from "@/db/schema";
import {
  buildAnalyticsSnapshot,
  type AnalyticsPeriod,
} from "@/app/analytics-model";
import {
  ensureCurrentUser,
  isAuthenticationRequiredError,
} from "@/app/api/data/current-user";

const PERIODS = new Set<AnalyticsPeriod>([
  "week",
  "month",
  "quarter",
  "year",
]);
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

function errorMessage(error: unknown) {
  const value = error instanceof Error ? error.message : "Неизвестная ошибка";
  if (value.includes("no such table")) {
    return "Аналитика ещё подготавливается. Обновите страницу через минуту.";
  }
  return value;
}

function parsePeriod(value: string | null): AnalyticsPeriod {
  return PERIODS.has(value as AnalyticsPeriod)
    ? (value as AnalyticsPeriod)
    : "week";
}

function parseDate(value: string | null) {
  if (value && DATE_KEY.test(value)) return value;
  return new Date().toISOString().slice(0, 10);
}

function parseTimezoneOffset(value: string | null) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(-840, Math.min(840, Math.round(parsed)));
}

function parseProjectId(value: string | null) {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const period = parsePeriod(url.searchParams.get("period"));
    const anchor = parseDate(url.searchParams.get("anchor"));
    const today = parseDate(url.searchParams.get("today"));
    const timezoneOffset = parseTimezoneOffset(
      url.searchParams.get("timezoneOffset"),
    );
    const projectId = parseProjectId(url.searchParams.get("projectId"));
    const db = await getDb();
    const currentUser = await ensureCurrentUser(db);
    const userId = currentUser.id;

    const [
      taskRows,
      habitRows,
      timeRows,
      projectRows,
      eventRows,
      trackingRows,
    ] = await Promise.all([
      db.select().from(tasks).where(eq(tasks.userId, userId)),
      db.select().from(habits).where(eq(habits.userId, userId)),
      db
        .select()
        .from(timeEntries)
        .where(eq(timeEntries.userId, userId))
        .orderBy(asc(timeEntries.startTime)),
      db.select().from(projects).where(eq(projects.userId, userId)),
      db
        .select()
        .from(analyticsEvents)
        .where(eq(analyticsEvents.userId, userId))
        .orderBy(asc(analyticsEvents.createdAt), asc(analyticsEvents.id)),
      db
        .select()
        .from(analyticsTracking)
        .where(eq(analyticsTracking.userId, userId))
        .limit(1),
    ]);

    const habitIds = habitRows.map((habit) => habit.id);
    const logRows = habitIds.length
      ? await db
          .select()
          .from(habitLogs)
          .where(inArray(habitLogs.habitId, habitIds))
          .orderBy(asc(habitLogs.date))
      : [];

    return Response.json(
      buildAnalyticsSnapshot({
        period,
        anchor,
        today,
        timezoneOffset,
        projectId,
        trackingStartedAt: trackingRows[0]?.startedAt ?? null,
        tasks: taskRows,
        habits: habitRows,
        habitLogs: logRows,
        timeEntries: timeRows,
        projects: projectRows,
        events: eventRows,
      }),
    );
  } catch (error) {
    return Response.json(
      { error: errorMessage(error) },
      { status: isAuthenticationRequiredError(error) ? 401 : 500 },
    );
  }
}
