import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildAnalyticsSnapshot,
  resolveAnalyticsPeriod,
} from "../app/analytics-model.ts";

const appUrl = new URL("../app/flowtrack-app.tsx", import.meta.url);
const routeUrl = new URL("../app/api/analytics/route.ts", import.meta.url);
const schemaUrl = new URL("../db/schema.ts", import.meta.url);
const migrationUrl = new URL(
  "../drizzle/0004_nappy_songbird.sql",
  import.meta.url,
);
const stylesUrl = new URL("../app/globals.css", import.meta.url);

function at(date) {
  return new Date(`${date}T12:00:00.000Z`);
}

function event({
  id,
  entityType,
  entityId,
  eventType,
  date,
  effectiveDate = null,
  projectId = null,
  durationSeconds = null,
  previousValue = null,
  nextValue = null,
}) {
  return {
    id,
    entityType,
    entityId,
    eventType,
    effectiveDate,
    projectId,
    durationSeconds,
    previousValue,
    nextValue,
    createdAt: at(date),
  };
}

test("uses calendar-aligned comparison periods", () => {
  const week = resolveAnalyticsPeriod("week", "2026-07-30");
  assert.deepEqual(week.current, {
    start: "2026-07-27",
    end: "2026-08-02",
    effectiveEnd: "2026-07-30",
  });
  assert.deepEqual(week.previous, {
    start: "2026-07-20",
    end: "2026-07-26",
    effectiveEnd: "2026-07-26",
  });

  const quarter = resolveAnalyticsPeriod("quarter", "2026-07-30");
  assert.equal(quarter.current.start, "2026-07-01");
  assert.equal(quarter.current.end, "2026-09-30");
  assert.equal(quarter.previous.start, "2026-04-01");
  assert.equal(quarter.previous.end, "2026-06-30");

  const pastMonth = resolveAnalyticsPeriod(
    "month",
    "2026-06-01",
    "2026-07-30",
  );
  assert.equal(pastMonth.current.effectiveEnd, "2026-06-30");
});

test("calculates plan, deadlines, focus, habits and comparisons without a synthetic score", () => {
  const tasks = [
    {
      id: 1,
      status: "done",
      dueDate: "2026-07-28",
      projectId: 10,
      createdAt: at("2026-07-20"),
      completedAt: at("2026-07-28"),
      deletedAt: null,
    },
    {
      id: 2,
      status: "todo",
      dueDate: "2026-07-29",
      projectId: 10,
      createdAt: at("2026-07-20"),
      completedAt: null,
      deletedAt: null,
    },
    {
      id: 3,
      status: "done",
      dueDate: "2026-07-22",
      projectId: 10,
      createdAt: at("2026-07-15"),
      completedAt: at("2026-07-22"),
      deletedAt: null,
    },
  ];
  const events = [
    ...tasks.map((task, index) =>
      event({
        id: index + 1,
        entityType: "task",
        entityId: task.id,
        eventType: "task_created",
        date: task.createdAt.toISOString().slice(0, 10),
        projectId: task.projectId,
        nextValue: task.dueDate,
      }),
    ),
    event({
      id: 4,
      entityType: "task",
      entityId: 1,
      eventType: "task_completed",
      date: "2026-07-28",
      projectId: 10,
    }),
    event({
      id: 5,
      entityType: "task",
      entityId: 3,
      eventType: "task_completed",
      date: "2026-07-22",
      projectId: 10,
    }),
    event({
      id: 6,
      entityType: "task",
      entityId: 2,
      eventType: "task_rescheduled",
      date: "2026-07-29",
      projectId: 10,
      previousValue: "2026-07-28",
      nextValue: "2026-07-29",
    }),
    event({
      id: 7,
      entityType: "habit",
      entityId: 20,
      eventType: "habit_created",
      date: "2026-07-20",
      nextValue: "daily:1",
    }),
    ...["2026-07-27", "2026-07-28", "2026-07-29", "2026-07-30"].map(
      (date, index) =>
        event({
          id: 8 + index,
          entityType: "habit",
          entityId: 20,
          eventType: "habit_completed",
          date,
          effectiveDate: date,
        }),
    ),
    ...["2026-07-20", "2026-07-21", "2026-07-22"].map((date, index) =>
      event({
        id: 12 + index,
        entityType: "habit",
        entityId: 20,
        eventType: "habit_completed",
        date,
        effectiveDate: date,
      }),
    ),
    event({
      id: 15,
      entityType: "focus",
      entityId: 30,
      eventType: "focus_completed",
      date: "2026-07-28",
      projectId: 10,
      durationSeconds: 1500,
    }),
    event({
      id: 16,
      entityType: "focus",
      entityId: 31,
      eventType: "focus_completed",
      date: "2026-07-22",
      projectId: 10,
      durationSeconds: 600,
    }),
  ];

  const snapshot = buildAnalyticsSnapshot({
    period: "week",
    anchor: "2026-07-30",
    timezoneOffset: 0,
    projectId: null,
    trackingStartedAt: at("2026-07-30"),
    tasks,
    habits: [
      {
        id: 20,
        frequency: "daily",
        targetPerDay: 1,
        createdAt: at("2026-07-20"),
        deletedAt: null,
      },
    ],
    habitLogs: [],
    timeEntries: [],
    projects: [
      {
        id: 10,
        title: "FlowTrack",
        color: "#7c3aed",
        status: "active",
        deletedAt: null,
      },
    ],
    events,
  });

  assert.equal(snapshot.metrics.planCompletion.value, 50);
  assert.equal(snapshot.metrics.planCompletion.delta, -50);
  assert.equal(snapshot.metrics.onTime.value, 100);
  assert.equal(snapshot.metrics.focus.value, 1500);
  assert.equal(snapshot.metrics.focus.delta, 150);
  assert.equal(snapshot.metrics.habits.value, 100);
  assert.equal(snapshot.metrics.rescheduledTasks, 1);
  assert.equal(snapshot.metrics.overdueTasks, 1);
  assert.equal(snapshot.projects[0].title, "FlowTrack");
  assert.equal(snapshot.projects[0].focusSeconds, 1500);
  assert.ok(!("productivityScore" in snapshot.metrics));
});

test("analytics data is user-scoped and backed by an event history migration", async () => {
  const [route, schema, migration] = await Promise.all([
    readFile(routeUrl, "utf8"),
    readFile(schemaUrl, "utf8"),
    readFile(migrationUrl, "utf8"),
  ]);

  assert.match(route, /ensureCurrentUser\(db\)/);
  assert.match(route, /eq\(analyticsEvents\.userId,\s*userId\)/);
  assert.match(schema, /export const analyticsEvents/);
  assert.match(schema, /export const analyticsTracking/);
  assert.match(migration, /INSERT INTO `analytics_events`[\s\S]*FROM `tasks`/);
  assert.match(migration, /CREATE TRIGGER `analytics_tasks_due_after_update`/);
  assert.match(migration, /CREATE TRIGGER `analytics_habit_logs_after_update`/);
  assert.match(migration, /CREATE TRIGGER `analytics_time_entries_after_update`/);
});

test("analytics is reachable on desktop and mobile and has responsive theme-safe visuals", async () => {
  const [app, styles] = await Promise.all([
    readFile(appUrl, "utf8"),
    readFile(stylesUrl, "utf8"),
  ]);

  assert.match(app, /\| "analytics"/);
  assert.match(app, /label: "Аналитика", icon: BarChart3/);
  assert.match(app, /view === "analytics"/);
  assert.match(app, /<AnalyticsHeatmap/);
  assert.match(app, /<AnalyticsNarrative/);
  assert.match(styles, /\.analytics-metrics-grid/);
  assert.match(styles, /\.analytics-heatmap-grid/);
  assert.match(styles, /background:\s*var\(--surface-1\)/);
  assert.match(styles, /data-flowtrack-motion="reduced"[\s\S]*analytics-metric/);
  assert.match(
    styles,
    /@media \(max-width: 780px\)[\s\S]*\.analytics-toolbar[\s\S]*grid-template-columns:\s*1fr/,
  );
});
