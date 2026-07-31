import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const schemaUrl = new URL("../db/schema.ts", import.meta.url);
const migrationUrl = new URL(
  "../drizzle/0005_special_ultimates.sql",
  import.meta.url,
);
const routeUrl = new URL("../app/api/team/route.ts", import.meta.url);
const teamAppUrl = new URL(
  "../app/team/team-workspace-app.tsx",
  import.meta.url,
);
const teamPageUrl = new URL("../app/team/page.tsx", import.meta.url);
const personalAppUrl = new URL("../app/flowtrack-app.tsx", import.meta.url);
const migrationsUrl = new URL("../drizzle/", import.meta.url);

test("applies the full migration chain without changing personal records", async () => {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  const files = (await readdir(migrationsUrl))
    .filter((file) => /^\d{4}_.+\.sql$/.test(file))
    .sort();

  try {
    for (const file of files) {
      const sql = (await readFile(new URL(file, migrationsUrl), "utf8")).replaceAll(
        "--> statement-breakpoint",
        "",
      );
      database.exec(sql);
    }
    const workspaceTables = database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = ? AND name LIKE ? ORDER BY name",
      )
      .all("table", "workspace%");
    assert.deepEqual(
      workspaceTables.map((row) => row.name),
      [
        "workspace_activity",
        "workspace_invites",
        "workspace_members",
        "workspaces",
      ],
    );

    database
      .prepare("INSERT INTO users (email, display_name) VALUES (?, ?)")
      .run("personal@example.com", "Личный пользователь");
    const user = database
      .prepare("SELECT id FROM users WHERE email = ?")
      .get("personal@example.com");
    database
      .prepare("INSERT INTO projects (user_id, title) VALUES (?, ?)")
      .run(user.id, "Личный проект");
    const personalProject = database
      .prepare("SELECT user_id, workspace_id FROM projects WHERE title = ?")
      .get("Личный проект");
    assert.equal(personalProject.user_id, user.id);
    assert.equal(personalProject.workspace_id, null);

    const workspace = database
      .prepare("INSERT INTO workspaces (name, owner_user_id) VALUES (?, ?)")
      .run("Общее пространство", user.id);
    const sharedProject = database
      .prepare(
        "INSERT INTO projects (user_id, workspace_id, created_by_user_id, title) VALUES (NULL, ?, ?, ?)",
      )
      .run(workspace.lastInsertRowid, user.id, "Общий проект");
    const column = database
      .prepare(
        "INSERT INTO kanban_columns (project_id, title, `order`) VALUES (?, ?, ?)",
      )
      .run(sharedProject.lastInsertRowid, "Запланировано", 0);
    const sharedTask = database
      .prepare(
        "INSERT INTO tasks (user_id, workspace_id, created_by_user_id, title, project_id, kanban_column_id) VALUES (NULL, ?, ?, ?, ?, ?)",
      )
      .run(
        workspace.lastInsertRowid,
        user.id,
        "Общая задача",
        sharedProject.lastInsertRowid,
        column.lastInsertRowid,
      );
    database
      .prepare("UPDATE tasks SET status = ? WHERE id = ?")
      .run("doing", sharedTask.lastInsertRowid);
    const sharedAnalytics = database
      .prepare(
        "SELECT COUNT(*) AS count FROM analytics_events WHERE entity_type = ? AND entity_id = ?",
      )
      .get("task", sharedTask.lastInsertRowid);
    assert.equal(
      sharedAnalytics.count,
      0,
      "shared task changes must not enter a member's personal analytics",
    );
  } finally {
    database.close();
  }
});

test("adds a backwards-compatible shared workspace schema", async () => {
  const [schema, migration] = await Promise.all([
    readFile(schemaUrl, "utf8"),
    readFile(migrationUrl, "utf8"),
  ]);

  for (const table of [
    "workspaces",
    "workspaceMembers",
    "workspaceInvites",
    "workspaceActivity",
  ]) {
    assert.match(schema, new RegExp(`export const ${table} = sqliteTable`));
  }
  assert.match(schema, /projects[\s\S]*?workspaceId:\s*integer\("workspace_id"\)/);
  assert.match(schema, /tasks[\s\S]*?assigneeUserId:\s*integer\("assignee_user_id"\)/);
  assert.match(migration, /CREATE TABLE `workspaces`/);
  assert.match(migration, /CREATE TABLE `workspace_members`/);
  assert.match(migration, /ALTER TABLE `projects` ADD `workspace_id` integer/);
  assert.match(migration, /ALTER TABLE `tasks` ADD `assignee_user_id` integer/);
  assert.doesNotMatch(
    migration,
    /ALTER TABLE `(?:projects|tasks)` ADD `workspace_id` integer NOT NULL/,
    "existing personal records must remain valid after the migration",
  );
});

test("keeps personal habits outside Team Workspace", async () => {
  const [schema, route] = await Promise.all([
    readFile(schemaUrl, "utf8"),
    readFile(routeUrl, "utf8"),
  ]);
  const habitsBlock = schema.match(
    /export const habits =[\s\S]*?export const habitLogs =/,
  )?.[0];

  assert.ok(habitsBlock, "habits schema block was not found");
  assert.doesNotMatch(habitsBlock, /workspaceId|workspace_id/);
  assert.doesNotMatch(
    route.match(/from "@\/db\/schema";[\s\S]*?from "@\/app\/api\/data\/current-user";/)?.[0] ?? "",
    /habits|notes|goals|timeEntries/,
  );
  assert.match(route, /userId:\s*null,[\s\S]*?workspaceId/);
});

test("authorizes every shared read and mutation from the signed-in membership", async () => {
  const route = await readFile(routeUrl, "utf8");

  assert.match(route, /const currentUser = await ensureCurrentUser\(db\)/);
  assert.match(
    route,
    /eq\(workspaceMembers\.userId,\s*currentUser\.id\)/,
  );
  assert.match(route, /async function workspaceAccess/);
  assert.match(route, /eq\(workspaceMembers\.userId,\s*userId\)/);
  assert.match(route, /eq\(workspaces\.id,\s*workspaceId\)/);
  assert.match(route, /const MANAGE_ROLES:[\s\S]*?\["owner", "admin"\]/);
  assert.match(
    route,
    /const WRITE_ROLES:[\s\S]*?\["owner", "admin", "member"\]/,
  );
  assert.match(
    route,
    /case "updateMemberRole"[\s\S]*?requireRole\(access, \["owner"\]\)/,
  );
  assert.match(route, /case "createProject"[\s\S]*?requireRole\(access, MANAGE_ROLES\)/);
  assert.match(route, /case "createTask"[\s\S]*?requireRole\(access, WRITE_ROLES\)/);
  assert.match(route, /case "reorderTasks"[\s\S]*?requireRole\(access, WRITE_ROLES\)/);
});

test("binds invitations to the authenticated email", async () => {
  const route = await readFile(routeUrl, "utf8");

  assert.match(
    route,
    /eq\(workspaceInvites\.email,\s*currentUser\.email\)/,
  );
  assert.match(
    route,
    /eq\(workspaceInvites\.status,\s*"pending"\)/,
  );
  assert.match(route, /gt\(workspaceInvites\.expiresAt,\s*new Date\(\)\)/);
  assert.match(route, /target: \[workspaceInvites\.workspaceId, workspaceInvites\.email\]/);
});

test("exposes the complete first Team Workspace flow in the UI", async () => {
  const [page, client, personal] = await Promise.all([
    readFile(teamPageUrl, "utf8"),
    readFile(teamAppUrl, "utf8"),
    readFile(personalAppUrl, "utf8"),
  ]);

  assert.match(page, /requireChatGPTUser\("\/team"\)/);
  assert.match(personal, /href="\/team"/);
  for (const action of [
    "createWorkspace",
    "createProject",
    "createTask",
    "inviteMember",
    "acceptInvite",
    "updateMemberRole",
    "removeMember",
    "leaveWorkspace",
  ]) {
    assert.match(client, new RegExp(`"${action}"`));
  }
  assert.match(client, /<DndContext/);
  assert.match(client, /reorderCardsWithinColumn/);
  assert.match(client, /assigneeUserId/);
  assert.match(client, /Личное остаётся личным/);
});

test("supports family, team and work scenarios without renaming the feature", async () => {
  const [schema, client] = await Promise.all([
    readFile(schemaUrl, "utf8"),
    readFile(teamAppUrl, "utf8"),
  ]);

  assert.match(schema, /enum: \["family", "team", "work", "other"\]/);
  assert.match(client, /Team Workspace/);
  assert.match(client, /family: "Семья"/);
  assert.match(client, /team: "Команда"/);
  assert.match(client, /work: "Работа"/);
});
