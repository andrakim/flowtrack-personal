import assert from "node:assert/strict";
import { readdir, stat } from "node:fs/promises";
import test from "node:test";

const assetsDirectory = new URL("../dist/client/assets/", import.meta.url);

test("loads the rich-text editor outside the initial FlowTrack bundle", async () => {
  const files = await readdir(assetsDirectory);
  const flowTrackBundle = files.find((file) =>
    /^flowtrack-app-[\w-]+\.js$/.test(file),
  );
  const richTextEditorBundle = files.find((file) =>
    /^rich-text-editor-[\w-]+\.js$/.test(file),
  );

  assert.ok(flowTrackBundle, "FlowTrack client bundle was not emitted");
  assert.ok(
    richTextEditorBundle,
    "Rich-text editor must be emitted as a lazy-loaded bundle",
  );

  const flowTrackBundleStats = await stat(
    new URL(flowTrackBundle, assetsDirectory),
  );
  assert.ok(
    flowTrackBundleStats.size < 250_000,
    `Initial FlowTrack bundle is ${flowTrackBundleStats.size} bytes`,
  );
});
