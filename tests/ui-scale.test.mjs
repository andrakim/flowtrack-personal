import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appUrl = new URL("../app/flowtrack-app.tsx", import.meta.url);
const stylesUrl = new URL("../app/globals.css", import.meta.url);
const preferencesUrl = new URL("../app/ui-preferences.ts", import.meta.url);

test("offers three device-local interface scales with a comfortable default", async () => {
  const [source, preferences] = await Promise.all([
    readFile(appUrl, "utf8"),
    readFile(preferencesUrl, "utf8"),
  ]);

  assert.match(
    preferences,
    /type UiScale = "compact" \| "comfortable" \| "large"/,
  );
  assert.match(preferences, /scale: "comfortable"/);
  assert.match(preferences, /flowtrack:ui-preferences:v1/);
  assert.match(preferences, /flowtrack:ui-scale:v1/);
  assert.match(
    preferences,
    /window\.localStorage\.setItem\(\s*UI_PREFERENCES_STORAGE_KEY/,
  );
  assert.match(source, /role="radiogroup"/);
  assert.match(
    source,
    /aria-checked=\{uiPreferences\.scale === option\.id\}/,
  );
});

test("scales design tokens without browser zoom or transformed app geometry", async () => {
  const styles = await readFile(stylesUrl, "utf8");

  for (const mode of ["compact", "comfortable", "large"]) {
    assert.match(
      styles,
      new RegExp(`\\.app-shell\\[data-ui-scale="${mode}"\\]`),
      `Missing ${mode} scale tokens`,
    );
  }
  assert.match(styles, /width:\s*var\(--ft-sidebar-width,\s*262px\)/);
  assert.match(
    styles,
    /margin-left:\s*var\(--ft-sidebar-width,\s*262px\)/,
  );
  assert.doesNotMatch(styles, /\bzoom\s*:/);
  assert.doesNotMatch(
    styles,
    /\.app-shell\s*\{[^}]*transform:\s*scale\(/s,
  );
});
