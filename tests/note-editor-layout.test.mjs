import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const stylesUrl = new URL("../app/globals.css", import.meta.url);

test("keeps the note formatting toolbar visible while long text scrolls", async () => {
  const styles = await readFile(stylesUrl, "utf8");

  assert.match(
    styles,
    /\.rich-editor\s*\{[^}]*overflow:\s*visible;/s,
    "The editor wrapper must not trap sticky positioning",
  );
  assert.match(
    styles,
    /\.rich-toolbar\s*\{[^}]*position:\s*sticky;[^}]*top:\s*0;/s,
    "The formatting toolbar must stick to the note modal scrollport",
  );
});
