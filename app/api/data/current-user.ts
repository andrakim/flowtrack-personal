import { and, eq, isNull, ne } from "drizzle-orm";
import type { getDb } from "@/db";
import {
  goals,
  habits,
  importBatches,
  notes,
  pomodoroState,
  projects,
  tasks,
  timeEntries,
  users,
} from "@/db/schema";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import {
  normalizeEmail,
  roleForIdentity,
} from "./owner-role";

type FlowDb = Awaited<ReturnType<typeof getDb>>;

export class AuthenticationRequiredError extends Error {
  constructor() {
    super("Войдите в FlowTrack, чтобы продолжить");
    this.name = "AuthenticationRequiredError";
  }
}

export function isAuthenticationRequiredError(
  error: unknown,
): error is AuthenticationRequiredError {
  return error instanceof AuthenticationRequiredError;
}

async function getConfiguredOwnerEmail() {
  const { env } = await import("cloudflare:workers");
  const value = (env as Record<string, unknown>).FLOWTRACK_OWNER_EMAIL;
  if (typeof value !== "string") return null;
  const email = normalizeEmail(value);
  return email || null;
}

export async function ensureCurrentUser(db: FlowDb) {
  const identity = await getChatGPTUser();
  if (!identity) throw new AuthenticationRequiredError();

  const email = normalizeEmail(identity.email);
  const configuredOwnerEmail = await getConfiguredOwnerEmail();
  const displayName =
    identity.fullName?.trim() || identity.displayName.trim() || email;
  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existing) {
    const now = new Date();
    const role = roleForIdentity(
      email,
      configuredOwnerEmail,
      existing.role,
    );

    if (configuredOwnerEmail && role === "owner") {
      const [, updatedRows] = await db.batch([
        db
          .update(users)
          .set({ role: "member" })
          .where(and(eq(users.role, "owner"), ne(users.email, email))),
        db
          .update(users)
          .set({ displayName, lastSeenAt: now, role })
          .where(eq(users.id, existing.id))
          .returning(),
      ]);
      return (
        updatedRows[0] ?? {
          ...existing,
          displayName,
          lastSeenAt: now,
          role,
        }
      );
    }

    const [user] = await db
      .update(users)
      .set({ displayName, lastSeenAt: now, role })
      .where(eq(users.id, existing.id))
      .returning();
    return user ?? { ...existing, displayName, lastSeenAt: now, role };
  }

  const [firstUser] = await db.select({ id: users.id }).from(users).limit(1);
  const role = roleForIdentity(
    email,
    configuredOwnerEmail,
    firstUser ? "member" : "owner",
  );
  const userValues = {
    email,
    displayName,
    role,
    lastSeenAt: new Date(),
  };
  let created;

  if (configuredOwnerEmail && role === "owner") {
    const [, createdRows] = await db.batch([
      db.update(users).set({ role: "member" }).where(eq(users.role, "owner")),
      db.insert(users).values(userValues).returning(),
    ]);
    [created] = createdRows;
  } else {
    [created] = await db.insert(users).values(userValues).returning();
  }

  if (!created) {
    throw new Error("Не удалось создать профиль пользователя");
  }

  if (!firstUser) {
    await db.batch([
      db
        .update(projects)
        .set({ userId: created.id })
        .where(isNull(projects.userId)),
      db
        .update(habits)
        .set({ userId: created.id })
        .where(isNull(habits.userId)),
      db
        .update(tasks)
        .set({ userId: created.id })
        .where(isNull(tasks.userId)),
      db
        .update(timeEntries)
        .set({ userId: created.id })
        .where(isNull(timeEntries.userId)),
      db
        .update(pomodoroState)
        .set({ userId: created.id })
        .where(isNull(pomodoroState.userId)),
      db
        .update(notes)
        .set({ userId: created.id })
        .where(isNull(notes.userId)),
      db
        .update(goals)
        .set({ userId: created.id })
        .where(isNull(goals.userId)),
      db
        .update(importBatches)
        .set({ userId: created.id })
        .where(isNull(importBatches.userId)),
    ]);
  }

  return created;
}
