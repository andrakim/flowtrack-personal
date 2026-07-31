import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appUrl = new URL("../app/flowtrack-app.tsx", import.meta.url);
const stylesUrl = new URL("../app/globals.css", import.meta.url);

test("offers weekly, monthly and daily paper templates without recording completion", async () => {
  const source = await readFile(appUrl, "utf8");

  assert.match(source, /type PrintTemplate = "week" \| "month" \| "day"/);
  for (const label of ["Неделя", "Месяц", "День"]) {
    assert.match(source, new RegExp(`label: "${label}"`));
  }
  assert.match(source, /Печать \/ PDF/);
  assert.match(source, /window\.print\(\)/);
  assert.match(
    source,
    /const orientation = template === "day" \? "portrait" : "landscape"/,
  );
  assert.match(
    source,
    /@page \{ size: A4 \$\{orientation\}; margin: 8mm; \}/,
  );
  assert.match(source, /Формируй чистые листы для ручных отметок/);
  assert.match(source, /На лист попадут названия привычек и пустые поля/);
});

test("keeps paper entry separate and makes the selected sheet print-ready", async () => {
  const [source, styles] = await Promise.all([
    readFile(appUrl, "utf8"),
    readFile(stylesUrl, "utf8"),
  ]);

  assert.match(source, /Внести отметки с бумаги/);
  assert.match(source, /void onToggleHabit\(habit\.id, key, !completed\)/);
  assert.match(source, /print-export/);
  assert.match(styles, /@media print[\s\S]*?@page[\s\S]*?margin:\s*8mm/);
  assert.match(styles, /\.print-export[\s\S]*?visibility:\s*visible/);
  assert.match(styles, /\.print-page > :not\(\.print-export\)[\s\S]*?display:\s*none/);
  assert.match(styles, /\.print-export[\s\S]*?break-after:\s*avoid-page/);
  assert.match(styles, /\.paper-entry-toggle-active/);
});
