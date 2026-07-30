import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
let vite;

test.before(async () => {
  vite = await createServer({
    appType: "custom",
    configFile: false,
    root,
    resolve: {
      alias: {
        "@": root,
      },
    },
    server: {
      middlewareMode: true,
    },
  });
});

test.after(async () => {
  await vite?.close();
});

test("accepts large integer values for financial goals", async () => {
  const { normalizePlan } = await vite.ssrLoadModule(
    "/app/api/data/plan.ts",
  );
  const normalized = normalizePlan({
    format: "flowtrack-plan",
    schemaVersion: 1,
    data: {
      goals: [
        {
          ref: "savings",
          title: "Накопить 10 миллионов сумов",
          targetValue: 10_000_000,
          currentValue: 5_300_000,
          unit: "сум",
        },
      ],
    },
  });

  assert.equal(normalized.goals[0].targetValue, 10_000_000);
  assert.equal(normalized.goals[0].currentValue, 5_300_000);
});

test("assigns the owner role only to the configured account", async () => {
  const { roleForIdentity } = await vite.ssrLoadModule(
    "/app/api/data/owner-role.ts",
  );

  assert.equal(
    roleForIdentity(
      "owner@example.com",
      " OWNER@example.com ",
      "member",
    ),
    "owner",
  );
  assert.equal(
    roleForIdentity(
      "first-user@example.com",
      "owner@example.com",
      "owner",
    ),
    "member",
  );
  assert.equal(
    roleForIdentity("first-user@example.com", null, "owner"),
    "owner",
  );
});
