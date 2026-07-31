import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
} from "drizzle-orm";
import { getDb } from "@/db";
import {
  kanbanColumns,
  projects,
  tasks,
  users,
  workspaceActivity,
  workspaceInvites,
  workspaceMembers,
  workspaces,
} from "@/db/schema";
import {
  ensureCurrentUser,
  isAuthenticationRequiredError,
} from "@/app/api/data/current-user";
import { normalizeEmail } from "@/app/api/data/owner-role";

type FlowDb = Awaited<ReturnType<typeof getDb>>;
type Payload = Record<string, unknown>;
type WorkspaceRole = "owner" | "admin" | "member" | "viewer";
type InviteRole = Exclude<WorkspaceRole, "owner">;
type TaskStatus = "todo" | "doing" | "done";

const HEX_PATTERN = /^#[0-9a-f]{6}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MANAGE_ROLES: readonly WorkspaceRole[] = ["owner", "admin"];
const WRITE_ROLES: readonly WorkspaceRole[] = ["owner", "admin", "member"];

class WorkspaceAccessError extends Error {
  constructor(message = "Недостаточно прав для этого действия") {
    super(message);
    this.name = "WorkspaceAccessError";
  }
}

function errorMessage(error: unknown) {
  const value = error instanceof Error ? error.message : "Неизвестная ошибка";
  if (value.includes("no such table")) {
    return "Team Workspace ещё не подготовлен. Обновите версию сайта.";
  }
  return value;
}

function idFrom(payload: Payload, key = "id") {
  const value = Number(payload[key]);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Некорректный идентификатор: ${key}`);
  }
  return value;
}

function optionalId(payload: Payload, key: string) {
  const value = Number(payload[key]);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function requiredText(payload: Payload, key: string, max = 255) {
  const value = String(payload[key] ?? "").trim();
  if (!value) throw new Error(`Поле «${key}» обязательно`);
  return value.slice(0, max);
}

function optionalText(payload: Payload, key: string, max = 4000) {
  const value = String(payload[key] ?? "").trim();
  return value ? value.slice(0, max) : null;
}

function optionalDate(payload: Payload, key: string) {
  const value = String(payload[key] ?? "").trim();
  if (!value) return null;
  if (!DATE_PATTERN.test(value)) throw new Error(`Некорректная дата: ${key}`);
  return value;
}

function colorFrom(payload: Payload) {
  const value = String(payload.color ?? "");
  return HEX_PATTERN.test(value) ? value : "#6366f1";
}

function workspaceKindFrom(payload: Payload) {
  const value = String(payload.kind ?? "team");
  return ["family", "team", "work", "other"].includes(value)
    ? (value as "family" | "team" | "work" | "other")
    : "team";
}

function inviteRoleFrom(payload: Payload): InviteRole {
  const value = String(payload.role ?? "member");
  return ["admin", "member", "viewer"].includes(value)
    ? (value as InviteRole)
    : "member";
}

function priorityFrom(payload: Payload) {
  const value = String(payload.priority ?? "medium");
  return ["low", "medium", "high"].includes(value)
    ? (value as "low" | "medium" | "high")
    : "medium";
}

function tagsFrom(payload: Payload) {
  const raw = payload.tags;
  const values = Array.isArray(raw)
    ? raw
    : String(raw ?? "")
        .split(",")
        .map((item) => item.trim());
  return [...new Set(values.map(String).map((item) => item.trim()).filter(Boolean))]
    .slice(0, 12)
    .map((item) => item.slice(0, 40));
}

function reorderItems(payload: Payload, withColumn = false) {
  const rawItems = payload.items;
  if (!Array.isArray(rawItems) || !rawItems.length || rawItems.length > 500) {
    throw new Error("Некорректный набор элементов для сортировки");
  }
  const items = rawItems.map((raw) => {
    if (!raw || typeof raw !== "object") {
      throw new Error("Некорректный элемент сортировки");
    }
    const item = raw as Payload;
    const order = Number(item.order);
    if (!Number.isInteger(order) || order < 0 || order > 10_000) {
      throw new Error("Некорректный порядок элемента");
    }
    return {
      id: idFrom(item),
      order,
      ...(withColumn ? { columnId: idFrom(item, "columnId") } : {}),
    };
  });
  if (new Set(items.map((item) => item.id)).size !== items.length) {
    throw new Error("Один элемент нельзя сортировать дважды");
  }
  return items;
}

async function workspaceAccess(db: FlowDb, userId: number, workspaceId: number) {
  const [access] = await db
    .select({
      memberId: workspaceMembers.id,
      role: workspaceMembers.role,
      workspaceId: workspaces.id,
      name: workspaces.name,
      archived: workspaces.archived,
      ownerUserId: workspaces.ownerUserId,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(
      and(
        eq(workspaceMembers.userId, userId),
        eq(workspaces.id, workspaceId),
        eq(workspaces.archived, false),
      ),
    )
    .limit(1);
  if (!access) throw new WorkspaceAccessError("Team Workspace не найден");
  return access;
}

function requireRole(
  access: { role: WorkspaceRole },
  allowed: readonly WorkspaceRole[],
) {
  if (!allowed.includes(access.role)) throw new WorkspaceAccessError();
}

async function recordActivity(
  db: FlowDb,
  values: {
    workspaceId: number;
    actorUserId: number;
    action: string;
    summary: string;
    entityType?: string;
    entityId?: number;
  },
) {
  await db.insert(workspaceActivity).values(values);
}

async function workspaceProject(
  db: FlowDb,
  workspaceId: number,
  projectId: number,
) {
  const [project] = await db
    .select()
    .from(projects)
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.workspaceId, workspaceId),
        isNull(projects.deletedAt),
      ),
    )
    .limit(1);
  if (!project) throw new Error("Общий проект не найден");
  return project;
}

async function projectColumn(
  db: FlowDb,
  workspaceId: number,
  projectId: number,
  columnId: number,
) {
  await workspaceProject(db, workspaceId, projectId);
  const [column] = await db
    .select()
    .from(kanbanColumns)
    .where(
      and(
        eq(kanbanColumns.id, columnId),
        eq(kanbanColumns.projectId, projectId),
      ),
    )
    .limit(1);
  if (!column) throw new Error("Колонка общего проекта не найдена");
  return column;
}

async function projectColumns(db: FlowDb, projectId: number) {
  return db
    .select()
    .from(kanbanColumns)
    .where(eq(kanbanColumns.projectId, projectId))
    .orderBy(asc(kanbanColumns.order), asc(kanbanColumns.id));
}

function statusForColumn(
  columns: Array<{ id: number; order: number }>,
  columnId: number,
): TaskStatus {
  const index = columns.findIndex((column) => column.id === columnId);
  if (index < 0) throw new Error("Колонка общего проекта не найдена");
  if (columns.length > 1 && index === columns.length - 1) return "done";
  if (index > 0) return "doing";
  return "todo";
}

async function validateAssignee(
  db: FlowDb,
  workspaceId: number,
  assigneeUserId: number | null,
) {
  if (!assigneeUserId) return null;
  const [member] = await db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, assigneeUserId),
      ),
    )
    .limit(1);
  if (!member) throw new Error("Ответственный не состоит в Team Workspace");
  return assigneeUserId;
}

export async function GET(request: Request) {
  try {
    const db = await getDb();
    const currentUser = await ensureCurrentUser(db);
    const membershipRows = await db
      .select({
        id: workspaces.id,
        name: workspaces.name,
        description: workspaces.description,
        kind: workspaces.kind,
        color: workspaces.color,
        role: workspaceMembers.role,
        ownerUserId: workspaces.ownerUserId,
        updatedAt: workspaces.updatedAt,
      })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
      .where(
        and(
          eq(workspaceMembers.userId, currentUser.id),
          eq(workspaces.archived, false),
        ),
      )
      .orderBy(desc(workspaces.updatedAt), asc(workspaces.name));

    const workspaceIds = membershipRows.map((workspace) => workspace.id);
    const allMemberships = workspaceIds.length
      ? await db
          .select({ workspaceId: workspaceMembers.workspaceId })
          .from(workspaceMembers)
          .where(inArray(workspaceMembers.workspaceId, workspaceIds))
      : [];
    const memberCounts = new Map<number, number>();
    allMemberships.forEach(({ workspaceId }) =>
      memberCounts.set(workspaceId, (memberCounts.get(workspaceId) ?? 0) + 1),
    );
    const availableWorkspaces = membershipRows.map((workspace) => ({
      ...workspace,
      memberCount: memberCounts.get(workspace.id) ?? 0,
    }));

    const pendingInvites = await db
      .select({
        id: workspaceInvites.id,
        workspaceId: workspaceInvites.workspaceId,
        workspaceName: workspaces.name,
        workspaceColor: workspaces.color,
        role: workspaceInvites.role,
        expiresAt: workspaceInvites.expiresAt,
      })
      .from(workspaceInvites)
      .innerJoin(workspaces, eq(workspaceInvites.workspaceId, workspaces.id))
      .where(
        and(
          eq(workspaceInvites.email, currentUser.email),
          eq(workspaceInvites.status, "pending"),
          gt(workspaceInvites.expiresAt, new Date()),
          eq(workspaces.archived, false),
        ),
      )
      .orderBy(desc(workspaceInvites.createdAt));

    const requestedId = Number(new URL(request.url).searchParams.get("workspaceId"));
    const selectedWorkspace =
      availableWorkspaces.find((workspace) => workspace.id === requestedId) ??
      availableWorkspaces[0] ??
      null;

    if (!selectedWorkspace) {
      return Response.json({
        viewer: { id: currentUser.id, email: currentUser.email },
        workspaces: availableWorkspaces,
        pendingInvites,
        selected: null,
      });
    }

    const selectedId = selectedWorkspace.id;
    const [members, projectRows, recentActivity] = await Promise.all([
      db
        .select({
          id: workspaceMembers.id,
          userId: users.id,
          displayName: users.displayName,
          email: users.email,
          role: workspaceMembers.role,
          joinedAt: workspaceMembers.joinedAt,
        })
        .from(workspaceMembers)
        .innerJoin(users, eq(workspaceMembers.userId, users.id))
        .where(eq(workspaceMembers.workspaceId, selectedId))
        .orderBy(asc(workspaceMembers.joinedAt)),
      db
        .select()
        .from(projects)
        .where(
          and(
            eq(projects.workspaceId, selectedId),
            eq(projects.archived, false),
            isNull(projects.deletedAt),
          ),
        )
        .orderBy(desc(projects.createdAt)),
      db
        .select({
          id: workspaceActivity.id,
          action: workspaceActivity.action,
          entityType: workspaceActivity.entityType,
          entityId: workspaceActivity.entityId,
          summary: workspaceActivity.summary,
          createdAt: workspaceActivity.createdAt,
          actorName: users.displayName,
        })
        .from(workspaceActivity)
        .leftJoin(users, eq(workspaceActivity.actorUserId, users.id))
        .where(eq(workspaceActivity.workspaceId, selectedId))
        .orderBy(desc(workspaceActivity.createdAt))
        .limit(40),
    ]);

    const projectIds = projectRows.map((project) => project.id);
    const [columns, taskRows, invites] = await Promise.all([
      projectIds.length
        ? db
            .select()
            .from(kanbanColumns)
            .where(inArray(kanbanColumns.projectId, projectIds))
            .orderBy(asc(kanbanColumns.projectId), asc(kanbanColumns.order))
        : Promise.resolve([]),
      db
        .select()
        .from(tasks)
        .where(
          and(
            eq(tasks.workspaceId, selectedId),
            isNull(tasks.deletedAt),
          ),
        )
        .orderBy(asc(tasks.kanbanOrder), desc(tasks.createdAt)),
      MANAGE_ROLES.includes(selectedWorkspace.role)
        ? db
            .select({
              id: workspaceInvites.id,
              email: workspaceInvites.email,
              role: workspaceInvites.role,
              status: workspaceInvites.status,
              expiresAt: workspaceInvites.expiresAt,
              createdAt: workspaceInvites.createdAt,
            })
            .from(workspaceInvites)
            .where(eq(workspaceInvites.workspaceId, selectedId))
            .orderBy(desc(workspaceInvites.createdAt))
        : Promise.resolve([]),
    ]);

    return Response.json({
      viewer: { id: currentUser.id, email: currentUser.email },
      workspaces: availableWorkspaces,
      pendingInvites,
      selected: {
        workspace: selectedWorkspace,
        members,
        projects: projectRows,
        columns,
        tasks: taskRows,
        invites,
        activity: recentActivity,
      },
    });
  } catch (error) {
    return Response.json(
      { error: errorMessage(error) },
      {
        status: isAuthenticationRequiredError(error)
          ? 401
          : error instanceof WorkspaceAccessError
            ? 403
            : 500,
      },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { action?: string; payload?: Payload };
    const action = body.action;
    const payload = body.payload ?? {};
    const db = await getDb();
    const currentUser = await ensureCurrentUser(db);
    const userId = currentUser.id;

    switch (action) {
      case "createWorkspace": {
        const [workspace] = await db
          .insert(workspaces)
          .values({
            name: requiredText(payload, "name", 90),
            description: optionalText(payload, "description", 500),
            kind: workspaceKindFrom(payload),
            color: colorFrom(payload),
            ownerUserId: userId,
            updatedAt: new Date(),
          })
          .returning();
        if (!workspace) throw new Error("Не удалось создать Team Workspace");
        try {
          await db.insert(workspaceMembers).values({
            workspaceId: workspace.id,
            userId,
            role: "owner",
          });
          await recordActivity(db, {
            workspaceId: workspace.id,
            actorUserId: userId,
            action: "workspace_created",
            entityType: "workspace",
            entityId: workspace.id,
            summary: `Создано пространство «${workspace.name}»`,
          });
        } catch (error) {
          await db.delete(workspaces).where(eq(workspaces.id, workspace.id));
          throw error;
        }
        return Response.json({ ok: true, workspace });
      }

      case "updateWorkspace": {
        const workspaceId = idFrom(payload, "workspaceId");
        const access = await workspaceAccess(db, userId, workspaceId);
        requireRole(access, MANAGE_ROLES);
        const [workspace] = await db
          .update(workspaces)
          .set({
            name: requiredText(payload, "name", 90),
            description: optionalText(payload, "description", 500),
            kind: workspaceKindFrom(payload),
            color: colorFrom(payload),
            updatedAt: new Date(),
          })
          .where(eq(workspaces.id, workspaceId))
          .returning();
        await recordActivity(db, {
          workspaceId,
          actorUserId: userId,
          action: "workspace_updated",
          entityType: "workspace",
          entityId: workspaceId,
          summary: `Обновлены настройки «${workspace?.name ?? access.name}»`,
        });
        return Response.json({ ok: true, workspace });
      }

      case "inviteMember": {
        const workspaceId = idFrom(payload, "workspaceId");
        const access = await workspaceAccess(db, userId, workspaceId);
        requireRole(access, MANAGE_ROLES);
        const email = normalizeEmail(requiredText(payload, "email", 320));
        if (!email || !email.includes("@")) throw new Error("Некорректный email");
        const role = inviteRoleFrom(payload);
        const [existingUser] = await db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.email, email))
          .limit(1);
        if (existingUser) {
          const [existingMember] = await db
            .select({ id: workspaceMembers.id })
            .from(workspaceMembers)
            .where(
              and(
                eq(workspaceMembers.workspaceId, workspaceId),
                eq(workspaceMembers.userId, existingUser.id),
              ),
            )
            .limit(1);
          if (existingMember) throw new Error("Пользователь уже состоит в пространстве");
        }
        const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
        const token = crypto.randomUUID();
        const [invite] = await db
          .insert(workspaceInvites)
          .values({
            workspaceId,
            email,
            role,
            token,
            status: "pending",
            invitedByUserId: userId,
            expiresAt,
            respondedAt: null,
          })
          .onConflictDoUpdate({
            target: [workspaceInvites.workspaceId, workspaceInvites.email],
            set: {
              role,
              token,
              status: "pending",
              invitedByUserId: userId,
              expiresAt,
              respondedAt: null,
            },
          })
          .returning();
        await recordActivity(db, {
          workspaceId,
          actorUserId: userId,
          action: "member_invited",
          entityType: "invite",
          entityId: invite?.id,
          summary: `Приглашён участник ${email}`,
        });
        return Response.json({ ok: true, invite });
      }

      case "acceptInvite": {
        const inviteId = idFrom(payload, "inviteId");
        const [invite] = await db
          .select()
          .from(workspaceInvites)
          .where(
            and(
              eq(workspaceInvites.id, inviteId),
              eq(workspaceInvites.email, currentUser.email),
              eq(workspaceInvites.status, "pending"),
              gt(workspaceInvites.expiresAt, new Date()),
            ),
          )
          .limit(1);
        if (!invite) throw new WorkspaceAccessError("Приглашение недоступно");
        await db.batch([
          db
            .insert(workspaceMembers)
            .values({
              workspaceId: invite.workspaceId,
              userId,
              role: invite.role,
            })
            .onConflictDoUpdate({
              target: [workspaceMembers.workspaceId, workspaceMembers.userId],
              set: { role: invite.role, joinedAt: new Date() },
            }),
          db
            .update(workspaceInvites)
            .set({ status: "accepted", respondedAt: new Date() })
            .where(eq(workspaceInvites.id, invite.id)),
          db.insert(workspaceActivity).values({
            workspaceId: invite.workspaceId,
            actorUserId: userId,
            action: "invite_accepted",
            entityType: "member",
            entityId: userId,
            summary: `${currentUser.displayName} присоединился к пространству`,
          }),
        ]);
        return Response.json({ ok: true, workspaceId: invite.workspaceId });
      }

      case "declineInvite": {
        const inviteId = idFrom(payload, "inviteId");
        const [invite] = await db
          .update(workspaceInvites)
          .set({ status: "declined", respondedAt: new Date() })
          .where(
            and(
              eq(workspaceInvites.id, inviteId),
              eq(workspaceInvites.email, currentUser.email),
              eq(workspaceInvites.status, "pending"),
            ),
          )
          .returning();
        if (!invite) throw new WorkspaceAccessError("Приглашение недоступно");
        return Response.json({ ok: true });
      }

      case "updateMemberRole": {
        const workspaceId = idFrom(payload, "workspaceId");
        const memberId = idFrom(payload, "memberId");
        const access = await workspaceAccess(db, userId, workspaceId);
        requireRole(access, ["owner"]);
        const role = inviteRoleFrom(payload);
        const [member] = await db
          .select()
          .from(workspaceMembers)
          .where(
            and(
              eq(workspaceMembers.id, memberId),
              eq(workspaceMembers.workspaceId, workspaceId),
            ),
          )
          .limit(1);
        if (!member || member.role === "owner") {
          throw new WorkspaceAccessError("Роль владельца нельзя изменить");
        }
        await db
          .update(workspaceMembers)
          .set({ role })
          .where(eq(workspaceMembers.id, memberId));
        await recordActivity(db, {
          workspaceId,
          actorUserId: userId,
          action: "member_role_updated",
          entityType: "member",
          entityId: member.userId,
          summary: `Изменена роль участника на «${role}»`,
        });
        return Response.json({ ok: true });
      }

      case "removeMember": {
        const workspaceId = idFrom(payload, "workspaceId");
        const memberId = idFrom(payload, "memberId");
        const access = await workspaceAccess(db, userId, workspaceId);
        requireRole(access, MANAGE_ROLES);
        const [member] = await db
          .select()
          .from(workspaceMembers)
          .where(
            and(
              eq(workspaceMembers.id, memberId),
              eq(workspaceMembers.workspaceId, workspaceId),
            ),
          )
          .limit(1);
        if (!member || member.role === "owner") {
          throw new WorkspaceAccessError("Владельца нельзя удалить");
        }
        if (access.role === "admin" && member.role === "admin") {
          throw new WorkspaceAccessError("Администратор не может удалить администратора");
        }
        await db.delete(workspaceMembers).where(eq(workspaceMembers.id, memberId));
        await recordActivity(db, {
          workspaceId,
          actorUserId: userId,
          action: "member_removed",
          entityType: "member",
          entityId: member.userId,
          summary: "Участник удалён из пространства",
        });
        return Response.json({ ok: true });
      }

      case "leaveWorkspace": {
        const workspaceId = idFrom(payload, "workspaceId");
        const access = await workspaceAccess(db, userId, workspaceId);
        if (access.role === "owner") {
          throw new WorkspaceAccessError("Сначала передайте владение пространством");
        }
        await db
          .delete(workspaceMembers)
          .where(
            and(
              eq(workspaceMembers.workspaceId, workspaceId),
              eq(workspaceMembers.userId, userId),
            ),
          );
        await recordActivity(db, {
          workspaceId,
          actorUserId: userId,
          action: "member_left",
          entityType: "member",
          entityId: userId,
          summary: `${currentUser.displayName} покинул пространство`,
        });
        return Response.json({ ok: true });
      }

      case "createProject": {
        const workspaceId = idFrom(payload, "workspaceId");
        const access = await workspaceAccess(db, userId, workspaceId);
        requireRole(access, MANAGE_ROLES);
        const [project] = await db
          .insert(projects)
          .values({
            userId: null,
            workspaceId,
            createdByUserId: userId,
            title: requiredText(payload, "title", 120),
            description: optionalText(payload, "description", 1000),
            color: colorFrom(payload),
          })
          .returning();
        if (!project) throw new Error("Не удалось создать общий проект");
        await db.batch([
          db.insert(kanbanColumns).values({
            projectId: project.id,
            title: "Запланировано",
            order: 0,
            color: "#6366f1",
          }),
          db.insert(kanbanColumns).values({
            projectId: project.id,
            title: "В процессе",
            order: 1,
            color: "#f59e0b",
          }),
          db.insert(kanbanColumns).values({
            projectId: project.id,
            title: "Сделано",
            order: 2,
            color: "#10b981",
          }),
          db.insert(workspaceActivity).values({
            workspaceId,
            actorUserId: userId,
            action: "project_created",
            entityType: "project",
            entityId: project.id,
            summary: `Создан проект «${project.title}»`,
          }),
        ]);
        return Response.json({ ok: true, project });
      }

      case "deleteProject": {
        const workspaceId = idFrom(payload, "workspaceId");
        const projectId = idFrom(payload, "projectId");
        const access = await workspaceAccess(db, userId, workspaceId);
        requireRole(access, MANAGE_ROLES);
        const project = await workspaceProject(db, workspaceId, projectId);
        await db
          .update(projects)
          .set({ deletedAt: new Date() })
          .where(eq(projects.id, projectId));
        await recordActivity(db, {
          workspaceId,
          actorUserId: userId,
          action: "project_deleted",
          entityType: "project",
          entityId: projectId,
          summary: `Проект «${project.title}» перемещён в корзину`,
        });
        return Response.json({ ok: true });
      }

      case "createTask": {
        const workspaceId = idFrom(payload, "workspaceId");
        const projectId = idFrom(payload, "projectId");
        const columnId = idFrom(payload, "columnId");
        const access = await workspaceAccess(db, userId, workspaceId);
        requireRole(access, WRITE_ROLES);
        await projectColumn(db, workspaceId, projectId, columnId);
        const columns = await projectColumns(db, projectId);
        const assigneeUserId = await validateAssignee(
          db,
          workspaceId,
          optionalId(payload, "assigneeUserId"),
        );
        const [last] = await db
          .select({ order: tasks.kanbanOrder })
          .from(tasks)
          .where(
            and(
              eq(tasks.workspaceId, workspaceId),
              eq(tasks.kanbanColumnId, columnId),
              isNull(tasks.deletedAt),
            ),
          )
          .orderBy(desc(tasks.kanbanOrder))
          .limit(1);
        const [task] = await db
          .insert(tasks)
          .values({
            userId: null,
            workspaceId,
            createdByUserId: userId,
            assigneeUserId,
            title: requiredText(payload, "title", 180),
            description: optionalText(payload, "description", 2000),
            priority: priorityFrom(payload),
            dueDate: optionalDate(payload, "dueDate"),
            projectId,
            kanbanColumnId: columnId,
            kanbanOrder: (last?.order ?? -1) + 1,
            status: statusForColumn(columns, columnId),
            tags: tagsFrom(payload),
          })
          .returning();
        await recordActivity(db, {
          workspaceId,
          actorUserId: userId,
          action: "task_created",
          entityType: "task",
          entityId: task?.id,
          summary: `Создана задача «${task?.title ?? "Без названия"}»`,
        });
        return Response.json({ ok: true, task });
      }

      case "updateTask": {
        const workspaceId = idFrom(payload, "workspaceId");
        const taskId = idFrom(payload, "taskId");
        const access = await workspaceAccess(db, userId, workspaceId);
        requireRole(access, WRITE_ROLES);
        const [current] = await db
          .select()
          .from(tasks)
          .where(
            and(
              eq(tasks.id, taskId),
              eq(tasks.workspaceId, workspaceId),
              isNull(tasks.deletedAt),
            ),
          )
          .limit(1);
        if (!current) throw new Error("Общая задача не найдена");
        const assigneeUserId = await validateAssignee(
          db,
          workspaceId,
          optionalId(payload, "assigneeUserId"),
        );
        const [task] = await db
          .update(tasks)
          .set({
            title: requiredText(payload, "title", 180),
            description: optionalText(payload, "description", 2000),
            priority: priorityFrom(payload),
            dueDate: optionalDate(payload, "dueDate"),
            assigneeUserId,
            tags: tagsFrom(payload),
          })
          .where(eq(tasks.id, taskId))
          .returning();
        await recordActivity(db, {
          workspaceId,
          actorUserId: userId,
          action: "task_updated",
          entityType: "task",
          entityId: taskId,
          summary: `Обновлена задача «${task?.title ?? current.title}»`,
        });
        return Response.json({ ok: true, task });
      }

      case "deleteTask": {
        const workspaceId = idFrom(payload, "workspaceId");
        const taskId = idFrom(payload, "taskId");
        const access = await workspaceAccess(db, userId, workspaceId);
        requireRole(access, WRITE_ROLES);
        const [task] = await db
          .update(tasks)
          .set({ deletedAt: new Date() })
          .where(
            and(
              eq(tasks.id, taskId),
              eq(tasks.workspaceId, workspaceId),
              isNull(tasks.deletedAt),
            ),
          )
          .returning();
        if (!task) throw new Error("Общая задача не найдена");
        await recordActivity(db, {
          workspaceId,
          actorUserId: userId,
          action: "task_deleted",
          entityType: "task",
          entityId: taskId,
          summary: `Удалена задача «${task.title}»`,
        });
        return Response.json({ ok: true });
      }

      case "reorderColumns": {
        const workspaceId = idFrom(payload, "workspaceId");
        const projectId = idFrom(payload, "projectId");
        const access = await workspaceAccess(db, userId, workspaceId);
        requireRole(access, MANAGE_ROLES);
        await workspaceProject(db, workspaceId, projectId);
        const items = reorderItems(payload);
        const columns = await projectColumns(db, projectId);
        if (
          columns.length !== items.length ||
          items.some((item) => !columns.some((column) => column.id === item.id))
        ) {
          throw new Error("Нужно передать полный порядок колонок проекта");
        }
        const orders = items.map((item) => item.order).sort((a, b) => a - b);
        if (orders.some((order, index) => order !== index)) {
          throw new Error("Порядок колонок содержит пропуски");
        }
        const orderedColumns = items
          .map((item) => ({
            ...columns.find((column) => column.id === item.id)!,
            order: item.order,
          }))
          .sort((a, b) => a.order - b.order);
        const projectTasks = await db
          .select()
          .from(tasks)
          .where(
            and(
              eq(tasks.workspaceId, workspaceId),
              eq(tasks.projectId, projectId),
              isNull(tasks.deletedAt),
              isNotNull(tasks.kanbanColumnId),
            ),
          );
        await db.batch([
          ...items.map((item) =>
            db
              .update(kanbanColumns)
              .set({ order: item.order })
              .where(eq(kanbanColumns.id, item.id)),
          ),
          ...projectTasks.map((task) =>
            db
              .update(tasks)
              .set({
                status: statusForColumn(
                  orderedColumns,
                  task.kanbanColumnId as number,
                ),
                completedAt:
                  statusForColumn(
                    orderedColumns,
                    task.kanbanColumnId as number,
                  ) === "done"
                    ? task.completedAt ?? new Date()
                    : null,
              })
              .where(eq(tasks.id, task.id)),
          ),
        ]);
        return Response.json({ ok: true });
      }

      case "reorderTasks": {
        const workspaceId = idFrom(payload, "workspaceId");
        const projectId = idFrom(payload, "projectId");
        const access = await workspaceAccess(db, userId, workspaceId);
        requireRole(access, WRITE_ROLES);
        await workspaceProject(db, workspaceId, projectId);
        const items = reorderItems(payload, true);
        const columns = await projectColumns(db, projectId);
        const columnIds = new Set(columns.map((column) => column.id));
        if (items.some((item) => !columnIds.has(item.columnId as number))) {
          throw new Error("Целевая колонка не относится к проекту");
        }
        const currentTasks = await db
          .select()
          .from(tasks)
          .where(
            and(
              eq(tasks.workspaceId, workspaceId),
              eq(tasks.projectId, projectId),
              isNull(tasks.deletedAt),
              isNotNull(tasks.kanbanColumnId),
            ),
          );
        if (
          currentTasks.length !== items.length ||
          items.some((item) => !currentTasks.some((task) => task.id === item.id))
        ) {
          throw new Error("Нужно передать полный порядок задач проекта");
        }
        const orderSets = new Map<number, number[]>();
        items.forEach((item) => {
          const columnId = item.columnId as number;
          const values = orderSets.get(columnId) ?? [];
          values.push(item.order);
          orderSets.set(columnId, values);
        });
        for (const orders of orderSets.values()) {
          orders.sort((a, b) => a - b);
          if (orders.some((order, index) => order !== index)) {
            throw new Error("Порядок задач содержит пропуски");
          }
        }
        await db.batch(
          items.map((item) => {
            const current = currentTasks.find((task) => task.id === item.id)!;
            const status = statusForColumn(columns, item.columnId as number);
            return db
              .update(tasks)
              .set({
                kanbanColumnId: item.columnId,
                kanbanOrder: item.order,
                status,
                completedAt:
                  status === "done" ? current.completedAt ?? new Date() : null,
              })
              .where(eq(tasks.id, item.id));
          }),
        );
        await recordActivity(db, {
          workspaceId,
          actorUserId: userId,
          action: "tasks_reordered",
          entityType: "project",
          entityId: projectId,
          summary: "Обновлён порядок задач на канбан-доске",
        });
        return Response.json({ ok: true });
      }

      default:
        return Response.json({ error: "Неизвестное действие" }, { status: 400 });
    }
  } catch (error) {
    return Response.json(
      { error: errorMessage(error) },
      {
        status: isAuthenticationRequiredError(error)
          ? 401
          : error instanceof WorkspaceAccessError
            ? 403
            : 400,
      },
    );
  }
}
