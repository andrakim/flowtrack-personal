import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appUrl = new URL("../app/flowtrack-app.tsx", import.meta.url);
const stylesUrl = new URL("../app/globals.css", import.meta.url);

test("uses a focused five-item mobile navigation with an overflow menu", async () => {
  const source = await readFile(appUrl, "utf8");

  assert.match(source, /const MOBILE_PRIMARY_NAV_ITEMS = \[/);
  for (const label of ["Сегодня", "Привычки", "План", "Проекты"]) {
    assert.match(source, new RegExp(`label: "${label}"`));
  }
  assert.match(source, /aria-label="Основная навигация"/);
  assert.match(source, /aria-haspopup="dialog"/);
  assert.match(source, /<span>Ещё<\/span>/);
  assert.match(source, /aria-labelledby="mobile-more-title"/);
});

test("keeps settings, data and secondary sections reachable on mobile", async () => {
  const source = await readFile(appUrl, "utf8");

  for (const label of ["Таймер", "Заметки", "Цели"]) {
    assert.match(source, new RegExp(`label: "${label}"`));
  }
  assert.match(source, /<strong>Быстро добавить<\/strong>/);
  assert.match(source, /<strong>Настройки<\/strong>/);
  assert.match(source, /<strong>Данные и резервные копии<\/strong>/);
  assert.match(source, /aria-label="Открыть профиль и настройки"/);
  assert.match(source, /className="mobile-header-actions"/);
});

test("reserves safe areas and prevents mobile controls from covering content", async () => {
  const styles = await readFile(stylesUrl, "utf8");

  assert.match(
    styles,
    /\.mobile-bottom-nav\s*\{[\s\S]*?grid-template-columns:\s*repeat\(5,/,
  );
  assert.match(styles, /env\(safe-area-inset-bottom\)/);
  assert.match(styles, /env\(safe-area-inset-top\)/);
  assert.match(
    styles,
    /\.mobile-floating-tools\s*\{\s*display:\s*none\s*!important;/,
  );
  assert.match(styles, /\.mobile-more-sheet\s*\{/);
  assert.doesNotMatch(
    styles,
    /\.mobile-header\s*>\s*button\s*\{[\s\S]*?visibility:\s*hidden;/,
  );
});
