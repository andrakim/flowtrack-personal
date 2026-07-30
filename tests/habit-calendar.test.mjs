import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appUrl = new URL("../app/flowtrack-app.tsx", import.meta.url);
const routeUrl = new URL("../app/api/data/route.ts", import.meta.url);
const stylesUrl = new URL("../app/globals.css", import.meta.url);

test("habit calendar applies completion immediately and saves in the background", async () => {
  const source = await readFile(appUrl, "utf8");
  const optimisticUpdate = source.indexOf("const optimisticLog: HabitLog");
  const request = source.indexOf('action: "toggleHabit"', optimisticUpdate);

  assert.ok(optimisticUpdate >= 0, "Missing optimistic habit state");
  assert.ok(
    source.indexOf("setData((current)", optimisticUpdate) < request,
    "The calendar must update before the network request",
  );
  assert.match(source, /savingHabitKeys\.has/);
  assert.match(source, /aria-busy=\{saving\}/);
  assert.match(source, /replaceHabitLog\([\s\S]*previousLog/);
});

test("habit completion endpoint accepts an idempotent target state", async () => {
  const source = await readFile(routeUrl, "utf8");

  assert.match(source, /typeof payload\.completed === "boolean"/);
  assert.match(source, /return ok\(\{ completed, habitLog \}\)/);
  assert.match(source, /\.returning\(\)/);
});

test("habit calendar has theme-safe surfaces and motion feedback", async () => {
  const styles = await readFile(stylesUrl, "utf8");

  assert.match(styles, /\.habit-card[\s\S]*background:\s*var\(--surface-1\)/);
  assert.match(styles, /\.day-pending/);
  assert.match(styles, /@keyframes habit-day-feedback/);
  assert.match(styles, /@keyframes calendar-month-in/);
  assert.match(styles, /data-flowtrack-motion="reduced"/);
});
