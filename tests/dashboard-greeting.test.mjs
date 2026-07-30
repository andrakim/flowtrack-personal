import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
let vite;
let greeting;

test.before(async () => {
  vite = await createServer({
    appType: "custom",
    configFile: false,
    root,
    server: {
      middlewareMode: true,
    },
  });
  greeting = await vite.ssrLoadModule("/app/dashboard-greeting.ts");
});

test.after(async () => {
  await vite?.close();
});

test("uses the first name from the authenticated profile", () => {
  assert.equal(
    greeting.dashboardGreeting(
      {
        displayName: "Мария Иванова",
        email: "maria@example.com",
        fullName: "Мария Иванова",
      },
      14,
    ),
    "Добрый день, Мария",
  );
});

test("changes the greeting according to the local hour", () => {
  assert.equal(greeting.greetingForHour(7), "Доброе утро");
  assert.equal(greeting.greetingForHour(13), "Добрый день");
  assert.equal(greeting.greetingForHour(20), "Добрый вечер");
  assert.equal(greeting.greetingForHour(2), "Доброй ночи");
});

test("does not expose an email when the profile has no name", () => {
  assert.equal(
    greeting.dashboardGreeting(
      {
        displayName: "person@example.com",
        email: "person@example.com",
        fullName: null,
      },
      9,
    ),
    "Доброе утро",
  );
});
