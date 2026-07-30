import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

const databaseModule = fileURLToPath(
  new URL("../db/index.ts", import.meta.url),
);

test("does not run database migrations inside user requests", async () => {
  const source = await readFile(databaseModule, "utf8");

  assert.doesNotMatch(source, /\bCREATE\s+(?:TABLE|INDEX)\b/i);
  assert.doesNotMatch(source, /\bALTER\s+TABLE\b/i);
  assert.doesNotMatch(source, /\bPRAGMA\s+table_info\b/i);
  assert.match(source, /return drizzle\(env\.DB,\s*\{\s*schema\s*\}\)/);
});
