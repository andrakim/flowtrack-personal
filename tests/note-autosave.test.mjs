import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appUrl = new URL("../app/flowtrack-app.tsx", import.meta.url);
const editorUrl = new URL("../app/rich-text-editor.tsx", import.meta.url);
const stylesUrl = new URL("../app/globals.css", import.meta.url);

test("keeps note drafts locally and autosaves after a short idle period", async () => {
  const source = await readFile(appUrl, "utf8");

  assert.match(source, /flowtrack:note-draft:v1:/);
  assert.match(source, /window\.localStorage\.setItem/);
  assert.match(source, /window\.setTimeout\(\(\) => \{[\s\S]*saveNow\(\);[\s\S]*\}, 1200\)/);
  assert.match(source, /window\.addEventListener\("online", handleOnline\)/);
  assert.match(source, /window\.addEventListener\("beforeunload", handleBeforeUnload\)/);
});

test("supports explicit save, visible save states, and safe closing", async () => {
  const source = await readFile(appUrl, "utf8");

  assert.match(
    source,
    /\(event\.metaKey \|\| event\.ctrlKey\)[\s\S]*event\.key\.toLowerCase\(\) === "s"/,
  );
  for (const label of [
    "Сохраняю…",
    "Ошибка сохранения",
    "Есть изменения",
    "Сохранено",
  ]) {
    assert.ok(source.includes(label), `Missing save state: ${label}`);
  }
  assert.match(source, /черновик сохранён на этом устройстве/);
  assert.match(source, /role="status"/);
});

test("adds fullscreen writing and live text statistics", async () => {
  const [app, editor, styles] = await Promise.all([
    readFile(appUrl, "utf8"),
    readFile(editorUrl, "utf8"),
    readFile(stylesUrl, "utf8"),
  ]);

  assert.match(app, /modal-note-fullscreen/);
  assert.match(app, /Открыть на весь экран/);
  assert.match(app, /noteStatsLabel\(stats\)/);
  assert.match(editor, /readingMinutes: words \? Math\.max\(1, Math\.ceil\(words \/ 200\)\) : 0/);
  assert.match(styles, /\.modal-note-fullscreen\s*\{[^}]*height:\s*100dvh;/s);
});
