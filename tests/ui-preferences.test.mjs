import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appUrl = new URL("../app/flowtrack-app.tsx", import.meta.url);
const stylesUrl = new URL("../app/globals.css", import.meta.url);
const preferencesUrl = new URL("../app/ui-preferences.ts", import.meta.url);
const layoutUrl = new URL("../app/layout.tsx", import.meta.url);

test("boots device preferences before the interface paints", async () => {
  const [layout, preferences] = await Promise.all([
    readFile(layoutUrl, "utf8"),
    readFile(preferencesUrl, "utf8"),
  ]);

  assert.match(layout, /UI_PREFERENCES_BOOT_SCRIPT/);
  assert.match(layout, /suppressHydrationWarning/);
  assert.match(preferences, /flowtrack:ui-preferences:v1/);
  assert.match(preferences, /dataset\.flowtrackTheme/);
  assert.match(preferences, /dataset\.flowtrackAccent/);
  assert.match(preferences, /dataset\.flowtrackMotion/);
});

test("provides theme, accent, sidebar, launch, motion and reset controls", async () => {
  const source = await readFile(appUrl, "utf8");

  assert.match(source, /type SettingsTab = "appearance" \| "launch" \| "account"/);
  assert.match(source, /aria-label="Тема интерфейса"/);
  assert.match(source, /aria-label="Акцентный цвет"/);
  assert.match(source, /aria-label="Режим боковой панели"/);
  assert.match(source, /aria-label="Анимации интерфейса"/);
  assert.match(source, /aria-label="Стартовый раздел"/);
  assert.match(source, /resetUiPreferences\(\)/);
});

test("supports light, dark and system themes with five accents", async () => {
  const styles = await readFile(stylesUrl, "utf8");

  assert.match(styles, /data-flowtrack-theme="dark"/);
  assert.match(styles, /prefers-color-scheme:\s*dark/);
  assert.match(styles, /--sidebar-bg:\s*linear-gradient/);
  assert.match(styles, /--sidebar-text:\s*#172033/);
  assert.match(
    styles,
    /data-flowtrack-theme="dark"[\s\S]*?--sidebar-text:\s*#f8fafc/,
  );
  assert.match(styles, /background:\s*var\(--sidebar-bg\)/);
  assert.match(styles, /color:\s*var\(--sidebar-text\)/);
  for (const accent of ["blue", "emerald", "orange", "graphite"]) {
    assert.match(
      styles,
      new RegExp(`data-flowtrack-accent="${accent}"`),
      `Missing ${accent} accent tokens`,
    );
  }
  assert.match(styles, /--accent:\s*#7c3aed/);
});

test("supports compact and automatic sidebars plus reduced motion", async () => {
  const styles = await readFile(stylesUrl, "utf8");

  assert.match(styles, /data-sidebar-mode="compact"/);
  assert.match(styles, /data-sidebar-mode="auto"/);
  assert.match(styles, /--ft-sidebar-width:\s*88px/);
  assert.match(styles, /data-flowtrack-motion="reduced"/);
  assert.match(styles, /prefers-reduced-motion:\s*reduce/);
});

test("keeps every desktop sidebar action reachable in a short browser window", async () => {
  const styles = await readFile(stylesUrl, "utf8");

  assert.match(
    styles,
    /\.sidebar\s*\{[\s\S]*?height:\s*100dvh;[\s\S]*?overflow:\s*hidden;/,
  );
  assert.match(
    styles,
    /\.desktop-sidebar-nav\s*\{[\s\S]*?overflow-y:\s*auto;/,
  );
  assert.match(
    styles,
    /@media \(min-width:\s*781px\) and \(max-height:\s*960px\)/,
  );
});

test("remembers the last section only when requested", async () => {
  const [source, preferences] = await Promise.all([
    readFile(appUrl, "utf8"),
    readFile(preferencesUrl, "utf8"),
  ]);

  assert.match(preferences, /flowtrack:last-view:v1/);
  assert.match(source, /getStoredLastView\(VIEW_IDS,\s*"overview"\)/);
  assert.match(source, /storeLastView\(next\)/);
});
