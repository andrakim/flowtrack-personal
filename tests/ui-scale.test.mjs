import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appUrl = new URL("../app/flowtrack-app.tsx", import.meta.url);
const stylesUrl = new URL("../app/globals.css", import.meta.url);

test("offers three device-local interface scales with a comfortable default", async () => {
  const source = await readFile(appUrl, "utf8");

  assert.match(source, /type UiScale = "compact" \| "comfortable" \| "large"/);
  assert.match(source, /DEFAULT_UI_SCALE: UiScale = "comfortable"/);
  assert.match(source, /flowtrack:ui-scale:v1/);
  assert.match(source, /window\.localStorage\.setItem\(UI_SCALE_STORAGE_KEY, scale\)/);
  assert.match(source, /role="radiogroup"/);
  assert.match(source, /aria-checked=\{uiScale === option\.id\}/);
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
