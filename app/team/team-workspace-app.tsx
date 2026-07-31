"use client";

import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Activity,
  ArrowLeft,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  ChevronDown,
  CircleAlert,
  Clock3,
  FolderKanban,
  GripVertical,
  House,
  LogOut,
  MailPlus,
  Plus,
  Settings2,
  ShieldCheck,
  Trash2,
  UserMinus,
  Users,
  X,
} from "lucide-react";
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import type { ChatGPTUser } from "@/app/chatgpt-auth";
import { reorderCardsWithinColumn } from "@/app/kanban-order.mjs";
import styles from "./team-workspace.module.css";

type WorkspaceRole = "owner" | "admin" | "member" | "viewer";
type WorkspaceKind = "family" | "team" | "work" | "other";
type Priority = "low" | "medium" | "high";
type Tab = "board" | "members" | "activity";

type WorkspaceSummary = {
  id: number;
  name: string;
  description: string | null;
  kind: WorkspaceKind;
  color: string;
  role: WorkspaceRole;
  ownerUserId: number;
  memberCount: number;
  updatedAt: string;
};

type TeamMember = {
  id: number;
  userId: number;
  displayName: string;
  email: string;
  role: WorkspaceRole;
  joinedAt: string;
};

type TeamProject = {
  id: number;
  workspaceId: number;
  title: string;
  description: string | null;
  color: string;
  status: string;
  createdAt: string;
};

type TeamColumn = {
  id: number;
  projectId: number;
  title: string;
  order: number;
  color: string;
};

type TeamTask = {
  id: number;
  workspaceId: number;
  projectId: number;
  kanbanColumnId: number;
  kanbanOrder: number;
  assigneeUserId: number | null;
  title: string;
  description: string | null;
  priority: Priority;
  dueDate: string | null;
  tags: string[];
  status: "todo" | "doing" | "done";
};

type TeamInvite = {
  id: number;
  email: string;
  role: Exclude<WorkspaceRole, "owner">;
  status: "pending" | "accepted" | "declined" | "revoked";
  expiresAt: string;
  createdAt: string;
};

type PendingInvite = {
  id: number;
  workspaceId: number;
  workspaceName: string;
  workspaceColor: string;
  role: Exclude<WorkspaceRole, "owner">;
  expiresAt: string;
};

type TeamActivity = {
  id: number;
  action: string;
  summary: string;
  actorName: string | null;
  createdAt: string;
};

type TeamData = {
  viewer: { id: number; email: string };
  workspaces: WorkspaceSummary[];
  pendingInvites: PendingInvite[];
  selected: null | {
    workspace: WorkspaceSummary;
    members: TeamMember[];
    projects: TeamProject[];
    columns: TeamColumn[];
    tasks: TeamTask[];
    invites: TeamInvite[];
    activity: TeamActivity[];
  };
};

type ModalState =
  | { kind: "workspace"; workspace?: WorkspaceSummary }
  | { kind: "project" }
  | { kind: "invite" }
  | { kind: "task"; columnId: number; task?: TeamTask };

type ActionResult = Record<string, unknown> & {
  error?: string;
  workspaceId?: number;
  workspace?: WorkspaceSummary;
  project?: TeamProject;
};

const LAST_WORKSPACE_KEY = "flowtrack:last-team-workspace";
const SIGN_IN_PATH = "/signin-with-chatgpt?return_to=%2Fteam";

const ROLE_LABELS: Record<WorkspaceRole, string> = {
  owner: "Владелец",
  admin: "Администратор",
  member: "Участник",
  viewer: "Наблюдатель",
};

const KIND_LABELS: Record<WorkspaceKind, string> = {
  family: "Семья",
  team: "Команда",
  work: "Работа",
  other: "Другое",
};

const PRIORITY_LABELS: Record<Priority, string> = {
  low: "Низкий",
  medium: "Средний",
  high: "Высокий",
};

function taskDragId(id: number) {
  return `team-task:${id}`;
}

function columnDropId(id: number) {
  return `team-column:${id}`;
}

function idFromDrag(value: string | number, prefix: string) {
  const text = String(value);
  return text.startsWith(prefix) ? Number(text.slice(prefix.length)) : null;
}

function initials(value: string) {
  const words = value
    .split(/[\s@._-]+/)
    .map((word) => word.trim())
    .filter(Boolean);
  return (words.length > 1 ? `${words[0][0]}${words[1][0]}` : words[0]?.slice(0, 2))
    ?.toLocaleUpperCase("ru-RU") || "FT";
}

function formatDate(value: string, options?: Intl.DateTimeFormatOptions) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ru-RU", options ?? {
    day: "numeric",
    month: "short",
  }).format(date);
}

function canWrite(role: WorkspaceRole) {
  return role !== "viewer";
}

function canManage(role: WorkspaceRole) {
  return role === "owner" || role === "admin";
}

export default function TeamWorkspaceApp({
  currentUser,
  signOutHref,
}: {
  currentUser: ChatGPTUser;
  signOutHref: string;
}) {
  const [data, setData] = useState<TeamData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("board");
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [modal, setModal] = useState<ModalState | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<number | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const loadData = useCallback(
    async (workspaceId?: number | null, preferredProjectId?: number | null) => {
      try {
        const query = workspaceId ? `?workspaceId=${workspaceId}` : "";
        const response = await fetch(`/api/team${query}`, { cache: "no-store" });
        if (response.status === 401) {
          window.location.assign(SIGN_IN_PATH);
          return;
        }
        const payload = (await response.json()) as TeamData & { error?: string };
        if (!response.ok) throw new Error(payload.error || "Не удалось загрузить Team Workspace");
        setData(payload);
        setSelectedProjectId((current) => {
          const projects = payload.selected?.projects ?? [];
          const requested = preferredProjectId ?? current;
          return projects.some((project) => project.id === requested)
            ? requested
            : projects[0]?.id ?? null;
        });
        if (payload.selected?.workspace.id) {
          window.localStorage.setItem(
            LAST_WORKSPACE_KEY,
            String(payload.selected.workspace.id),
          );
        }
        setError(null);
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Не удалось загрузить Team Workspace",
        );
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    const stored = Number(window.localStorage.getItem(LAST_WORKSPACE_KEY));
    const timeout = window.setTimeout(() => {
      void loadData(Number.isInteger(stored) && stored > 0 ? stored : null);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [loadData]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const selected = data?.selected ?? null;
  const workspace = selected?.workspace ?? null;
  const selectedProject = selected?.projects.find(
    (project) => project.id === selectedProjectId,
  ) ?? null;
  const projectColumns = useMemo(
    () =>
      (selected?.columns ?? [])
        .filter((column) => column.projectId === selectedProjectId)
        .sort((left, right) => left.order - right.order),
    [selected?.columns, selectedProjectId],
  );
  const projectTasks = useMemo(
    () =>
      (selected?.tasks ?? [])
        .filter((task) => task.projectId === selectedProjectId)
        .sort((left, right) => left.kanbanOrder - right.kanbanOrder),
    [selected?.tasks, selectedProjectId],
  );
  const activeTask = projectTasks.find((task) => task.id === activeTaskId) ?? null;

  async function mutate(
    action: string,
    payload: Record<string, unknown>,
    success: string,
    options: {
      reloadWorkspaceId?: number | null;
      reloadFromResult?: boolean;
      projectFromResult?: boolean;
      preferredProjectId?: number | null;
    } = {},
  ) {
    setBusy(true);
    try {
      const response = await fetch("/api/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, payload }),
      });
      if (response.status === 401) {
        window.location.assign(SIGN_IN_PATH);
        return null;
      }
      const result = (await response.json()) as ActionResult;
      if (!response.ok) throw new Error(result.error || "Операция не выполнена");
      const resultWorkspaceId = options.reloadFromResult
        ? Number(result.workspaceId ?? result.workspace?.id)
        : null;
      const resultProjectId = options.projectFromResult
        ? Number(result.project?.id)
        : null;
      const reloadWorkspaceId =
        Number.isInteger(resultWorkspaceId) && resultWorkspaceId! > 0
          ? resultWorkspaceId
          : options.reloadWorkspaceId === undefined
            ? workspace?.id ?? null
            : options.reloadWorkspaceId;
      const preferredProjectId =
        Number.isInteger(resultProjectId) && resultProjectId! > 0
          ? resultProjectId
          : options.preferredProjectId === undefined
            ? selectedProjectId
            : options.preferredProjectId;
      await loadData(reloadWorkspaceId, preferredProjectId);
      setToast(success);
      setError(null);
      return result;
    } catch (mutationError) {
      setError(
        mutationError instanceof Error ? mutationError.message : "Операция не выполнена",
      );
      return null;
    } finally {
      setBusy(false);
    }
  }

  function switchWorkspace(workspaceId: number) {
    setLoading(true);
    setSelectedProjectId(null);
    void loadData(workspaceId, null);
  }

  async function reorderTasksAfterDrag(event: DragEndEvent) {
    setActiveTaskId(null);
    if (!workspace || !selected || !selectedProject || !canWrite(workspace.role)) return;
    const taskId = idFromDrag(event.active.id, "team-task:");
    if (!taskId || !event.over) return;
    const movingTask = projectTasks.find((task) => task.id === taskId);
    if (!movingTask) return;
    const overTaskId = idFromDrag(event.over.id, "team-task:");
    const overTask = overTaskId
      ? projectTasks.find((task) => task.id === overTaskId)
      : null;
    const targetColumnId =
      overTask?.kanbanColumnId ?? idFromDrag(event.over.id, "team-column:");
    if (!targetColumnId || targetColumnId === null) return;

    const groups = new Map<number, TeamTask[]>();
    projectColumns.forEach((column) =>
      groups.set(
        column.id,
        projectTasks
          .filter((task) => task.kanbanColumnId === column.id)
          .sort((left, right) => left.kanbanOrder - right.kanbanOrder),
      ),
    );
    const sourceColumnId = movingTask.kanbanColumnId;

    if (sourceColumnId === targetColumnId) {
      const current = groups.get(sourceColumnId) ?? [];
      const reordered = reorderCardsWithinColumn(
        current.map((task) => ({ ...task, order: task.kanbanOrder })),
        taskId,
        overTaskId,
      ) as Array<TeamTask & { order: number }>;
      groups.set(
        sourceColumnId,
        reordered.map((task, index) => ({ ...task, kanbanOrder: index })),
      );
    } else {
      const source = (groups.get(sourceColumnId) ?? []).filter(
        (task) => task.id !== taskId,
      );
      const target = [...(groups.get(targetColumnId) ?? [])].filter(
        (task) => task.id !== taskId,
      );
      const targetIndex = overTaskId
        ? Math.max(0, target.findIndex((task) => task.id === overTaskId))
        : target.length;
      target.splice(targetIndex < 0 ? target.length : targetIndex, 0, {
        ...movingTask,
        kanbanColumnId: targetColumnId,
      });
      groups.set(
        sourceColumnId,
        source.map((task, index) => ({ ...task, kanbanOrder: index })),
      );
      groups.set(
        targetColumnId,
        target.map((task, index) => ({ ...task, kanbanOrder: index })),
      );
    }

    const reorderedProjectTasks = projectColumns.flatMap(
      (column) => groups.get(column.id) ?? [],
    );
    const reorderedIds = new Set(reorderedProjectTasks.map((task) => task.id));
    setData((current) =>
      current?.selected
        ? {
            ...current,
            selected: {
              ...current.selected,
              tasks: [
                ...current.selected.tasks.filter((task) => !reorderedIds.has(task.id)),
                ...reorderedProjectTasks,
              ],
            },
          }
        : current,
    );
    const saved = await mutate(
      "reorderTasks",
      {
        workspaceId: workspace.id,
        projectId: selectedProject.id,
        items: reorderedProjectTasks.map((task) => ({
          id: task.id,
          columnId: task.kanbanColumnId,
          order: task.kanbanOrder,
        })),
      },
      "Порядок задач обновлён",
      { preferredProjectId: selectedProject.id },
    );
    if (!saved) await loadData(workspace.id, selectedProject.id);
  }

  if (loading && !data) {
    return (
      <main className={styles.loadingScreen}>
        <div className={styles.loadingMark}><Users size={24} /></div>
        <strong>Открываем Team Workspace…</strong>
        <span>Подключаем общие проекты и участников</span>
      </main>
    );
  }

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <Link className={styles.brand} href="/" aria-label="FlowTrack — личное пространство">
          <span className={styles.brandMark}><Users size={21} /></span>
          <span>
            <strong>FlowTrack</strong>
            <small>Team Workspace</small>
          </span>
        </Link>

        <div className={styles.workspacePicker}>
          <span>Текущее пространство</span>
          {data?.workspaces.length ? (
            <label>
              <i style={{ background: workspace?.color ?? "#6366f1" }} />
              <select
                value={workspace?.id ?? ""}
                onChange={(event) => switchWorkspace(Number(event.target.value))}
                aria-label="Выбрать Team Workspace"
              >
                {data.workspaces.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
              <ChevronDown size={15} />
            </label>
          ) : (
            <button type="button" onClick={() => setModal({ kind: "workspace" })}>
              <Plus size={16} /> Создать пространство
            </button>
          )}
        </div>

        {workspace && (
          <nav className={styles.nav} aria-label="Разделы Team Workspace">
            <button
              className={tab === "board" ? styles.navActive : ""}
              type="button"
              onClick={() => setTab("board")}
            >
              <FolderKanban size={18} /><span>Общая доска</span>
            </button>
            <button
              className={tab === "members" ? styles.navActive : ""}
              type="button"
              onClick={() => setTab("members")}
            >
              <Users size={18} /><span>Участники</span>
              <i>{selected?.members.length ?? 0}</i>
            </button>
            <button
              className={tab === "activity" ? styles.navActive : ""}
              type="button"
              onClick={() => setTab("activity")}
            >
              <Activity size={18} /><span>Активность</span>
            </button>
          </nav>
        )}

        <div className={styles.sidebarBottom}>
          <div className={styles.privacyNote}>
            <ShieldCheck size={18} />
            <span>
              <strong>Личное остаётся личным</strong>
              <small>Привычки, заметки и цели не видны команде</small>
            </span>
          </div>
          <div className={styles.accountLine} title={currentUser.email}>
            <span>{initials(currentUser.displayName)}</span>
            <strong>{currentUser.displayName}</strong>
          </div>
          <Link href="/"><ArrowLeft size={17} /><span>Личное пространство</span></Link>
          <a href={signOutHref}><LogOut size={17} /><span>Выйти</span></a>
        </div>
      </aside>

      <main className={styles.main}>
        <header className={styles.mobileHeader}>
          <Link href="/" aria-label="Вернуться в личное пространство"><ArrowLeft size={19} /></Link>
          <span><Users size={18} /><strong>Team Workspace</strong></span>
          <button type="button" onClick={() => setModal({ kind: "workspace" })} aria-label="Создать пространство">
            <Plus size={19} />
          </button>
        </header>

        {error && (
          <div className={styles.errorBanner} role="alert">
            <CircleAlert size={18} />
            <span>{error}</span>
            <button type="button" onClick={() => setError(null)} aria-label="Закрыть"><X size={16} /></button>
          </div>
        )}

        {!!data?.pendingInvites.length && (
          <section className={styles.inviteBanner} aria-label="Приглашения">
            <div className={styles.inviteIcon}><MailPlus size={22} /></div>
            <div className={styles.inviteCopy}>
              <strong>Вас приглашают в Team Workspace</strong>
              {data.pendingInvites.map((invite) => (
                <div className={styles.inviteRow} key={invite.id}>
                  <span>
                    <i style={{ background: invite.workspaceColor }} />
                    {invite.workspaceName} · {ROLE_LABELS[invite.role]}
                  </span>
                  <div>
                    <button
                      className={styles.ghostButton}
                      disabled={busy}
                      type="button"
                      onClick={() => void mutate(
                        "declineInvite",
                        { inviteId: invite.id },
                        "Приглашение отклонено",
                      )}
                    >Отклонить</button>
                    <button
                      className={styles.primaryButton}
                      disabled={busy}
                      type="button"
                      onClick={() => void mutate(
                        "acceptInvite",
                        { inviteId: invite.id },
                        `Вы присоединились к «${invite.workspaceName}»`,
                        { reloadFromResult: true, preferredProjectId: null },
                      )}
                    ><Check size={15} /> Принять</button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {!workspace || !selected ? (
          <EmptyWorkspace onCreate={() => setModal({ kind: "workspace" })} />
        ) : (
          <>
            <section className={styles.workspaceHeader}>
              <div>
                <span className={styles.eyebrow}>
                  {KIND_LABELS[workspace.kind]} · {ROLE_LABELS[workspace.role]}
                </span>
                <h1>{workspace.name}</h1>
                <p>{workspace.description || "Общие проекты, задачи и ответственность — в одном месте."}</p>
              </div>
              <div className={styles.headerActions}>
                <span className={styles.memberPill}>
                  <Users size={16} /> {selected.members.length}
                </span>
                {canManage(workspace.role) && (
                  <button className={styles.ghostButton} type="button" onClick={() => setModal({ kind: "workspace", workspace })}>
                    <Settings2 size={16} /> Настройки
                  </button>
                )}
                <button className={styles.primaryButton} type="button" onClick={() => setModal({ kind: "workspace" })}>
                  <Plus size={16} /> Новое пространство
                </button>
              </div>
            </section>

            <nav className={styles.mobileTabs} aria-label="Разделы пространства">
              <button className={tab === "board" ? styles.mobileTabActive : ""} onClick={() => setTab("board")}><FolderKanban size={17} />Доска</button>
              <button className={tab === "members" ? styles.mobileTabActive : ""} onClick={() => setTab("members")}><Users size={17} />Участники</button>
              <button className={tab === "activity" ? styles.mobileTabActive : ""} onClick={() => setTab("activity")}><Activity size={17} />История</button>
            </nav>

            {tab === "board" && (
              <section className={styles.boardSection}>
                <div className={styles.projectBar}>
                  <div className={styles.projectTabs}>
                    {selected.projects.map((project) => (
                      <button
                        key={project.id}
                        className={project.id === selectedProjectId ? styles.projectActive : ""}
                        type="button"
                        onClick={() => setSelectedProjectId(project.id)}
                      >
                        <i style={{ background: project.color }} />
                        <span>{project.title}</span>
                      </button>
                    ))}
                  </div>
                  {canManage(workspace.role) && (
                    <button className={styles.addProject} type="button" onClick={() => setModal({ kind: "project" })}>
                      <Plus size={16} /> Проект
                    </button>
                  )}
                </div>

                {!selectedProject ? (
                  <EmptyProject
                    canCreate={canManage(workspace.role)}
                    onCreate={() => setModal({ kind: "project" })}
                  />
                ) : (
                  <>
                    <div className={styles.projectHeading}>
                      <div>
                        <span style={{ background: selectedProject.color }} />
                        <div>
                          <h2>{selectedProject.title}</h2>
                          <p>{selectedProject.description || "Общая канбан-доска проекта"}</p>
                        </div>
                      </div>
                      <strong>{projectTasks.length} {projectTasks.length === 1 ? "задача" : "задач"}</strong>
                    </div>
                    <DndContext
                      sensors={sensors}
                      collisionDetection={closestCorners}
                      onDragStart={(event: DragStartEvent) =>
                        setActiveTaskId(idFromDrag(event.active.id, "team-task:"))
                      }
                      onDragCancel={() => setActiveTaskId(null)}
                      onDragEnd={(event) => void reorderTasksAfterDrag(event)}
                    >
                      <div className={styles.board}>
                        {projectColumns.map((column) => {
                          const columnTasks = projectTasks.filter(
                            (task) => task.kanbanColumnId === column.id,
                          );
                          return (
                            <TeamColumnPanel
                              key={column.id}
                              column={column}
                              tasks={columnTasks}
                              members={selected.members}
                              canEdit={canWrite(workspace.role)}
                              onCreateTask={() => setModal({ kind: "task", columnId: column.id })}
                              onEditTask={(task) => setModal({ kind: "task", columnId: column.id, task })}
                            />
                          );
                        })}
                      </div>
                      {typeof document !== "undefined" && createPortal(
                        <DragOverlay dropAnimation={null}>
                          {activeTask ? (
                            <TeamTaskCard
                              task={activeTask}
                              members={selected.members}
                              canEdit={false}
                              overlay
                              onEdit={() => undefined}
                            />
                          ) : null}
                        </DragOverlay>,
                        document.body,
                      )}
                    </DndContext>
                  </>
                )}
              </section>
            )}

            {tab === "members" && (
              <MembersPanel
                workspace={workspace}
                viewerId={data?.viewer.id ?? 0}
                members={selected.members}
                invites={selected.invites}
                busy={busy}
                onInvite={() => setModal({ kind: "invite" })}
                onRole={(memberId, role) => void mutate(
                  "updateMemberRole",
                  { workspaceId: workspace.id, memberId, role },
                  "Роль участника обновлена",
                )}
                onRemove={(member) => {
                  if (window.confirm(`Удалить ${member.displayName} из пространства?`)) {
                    void mutate(
                      "removeMember",
                      { workspaceId: workspace.id, memberId: member.id },
                      "Участник удалён",
                    );
                  }
                }}
                onLeave={() => {
                  if (window.confirm(`Покинуть «${workspace.name}»?`)) {
                    void mutate(
                      "leaveWorkspace",
                      { workspaceId: workspace.id },
                      "Вы покинули пространство",
                      { reloadWorkspaceId: null, preferredProjectId: null },
                    );
                  }
                }}
              />
            )}

            {tab === "activity" && (
              <ActivityPanel activity={selected.activity} />
            )}
          </>
        )}
      </main>

      {modal && (
        <TeamModal
          state={modal}
          selected={selected}
          busy={busy}
          onClose={() => setModal(null)}
          onSubmit={async (action, payload, success, options) => {
            const result = await mutate(action, payload, success, options);
            if (result) setModal(null);
          }}
          onDeleteTask={(task) => {
            if (!workspace || !window.confirm(`Удалить задачу «${task.title}»?`)) return;
            void mutate(
              "deleteTask",
              { workspaceId: workspace.id, taskId: task.id },
              "Задача удалена",
            ).then((result) => result && setModal(null));
          }}
        />
      )}

      {toast && <div className={styles.toast} role="status"><Check size={16} />{toast}</div>}
    </div>
  );
}

function EmptyWorkspace({ onCreate }: { onCreate: () => void }) {
  return (
    <section className={styles.emptyWorkspace}>
      <div className={styles.emptyIllustration}>
        <span><House size={24} /></span>
        <span><BriefcaseBusiness size={24} /></span>
        <span><Users size={31} /></span>
      </div>
      <span className={styles.eyebrow}>Новый уровень FlowTrack</span>
      <h1>Создайте первое Team Workspace</h1>
      <p>
        Оно подойдёт семье, учебной группе или рабочей команде. Личные привычки,
        заметки, цели и аналитика останутся доступны только вам.
      </p>
      <button className={styles.primaryButton} type="button" onClick={onCreate}>
        <Plus size={17} /> Создать пространство
      </button>
      <div className={styles.useCases}>
        <span><House size={18} /><strong>Семья</strong><small>Быт, покупки, планы</small></span>
        <span><Users size={18} /><strong>Команда</strong><small>Учёба и проекты</small></span>
        <span><BriefcaseBusiness size={18} /><strong>Работа</strong><small>Задачи и сроки</small></span>
      </div>
    </section>
  );
}

function EmptyProject({ canCreate, onCreate }: { canCreate: boolean; onCreate: () => void }) {
  return (
    <div className={styles.emptyProject}>
      <span><FolderKanban size={27} /></span>
      <h2>Пока нет общих проектов</h2>
      <p>Первый проект сразу получит колонки «Запланировано», «В процессе» и «Сделано».</p>
      {canCreate && <button className={styles.primaryButton} onClick={onCreate}><Plus size={16} /> Создать проект</button>}
    </div>
  );
}

function TeamColumnPanel({
  column,
  tasks,
  members,
  canEdit,
  onCreateTask,
  onEditTask,
}: {
  column: TeamColumn;
  tasks: TeamTask[];
  members: TeamMember[];
  canEdit: boolean;
  onCreateTask: () => void;
  onEditTask: (task: TeamTask) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: columnDropId(column.id) });
  return (
    <article className={`${styles.column} ${isOver ? styles.columnOver : ""}`} ref={setNodeRef}>
      <header>
        <span><i style={{ background: column.color }} />{column.title}</span>
        <strong>{tasks.length}</strong>
      </header>
      <SortableContext
        items={tasks.map((task) => taskDragId(task.id))}
        strategy={verticalListSortingStrategy}
      >
        <div className={styles.taskList}>
          {tasks.map((task) => (
            <SortableTeamTask
              key={task.id}
              task={task}
              members={members}
              canEdit={canEdit}
              onEdit={() => onEditTask(task)}
            />
          ))}
          {!tasks.length && <div className={styles.columnEmpty}>Перетащите задачу сюда</div>}
        </div>
      </SortableContext>
      {canEdit && (
        <button className={styles.addTask} type="button" onClick={onCreateTask}>
          <Plus size={16} /> Добавить задачу
        </button>
      )}
    </article>
  );
}

function SortableTeamTask({
  task,
  members,
  canEdit,
  onEdit,
}: {
  task: TeamTask;
  members: TeamMember[];
  canEdit: boolean;
  onEdit: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: taskDragId(task.id), disabled: !canEdit });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? styles.taskDragging : undefined}
    >
      <TeamTaskCard
        task={task}
        members={members}
        canEdit={canEdit}
        onEdit={onEdit}
        dragAttributes={attributes}
        dragListeners={listeners}
      />
    </div>
  );
}

function TeamTaskCard({
  task,
  members,
  canEdit,
  overlay = false,
  onEdit,
  dragAttributes,
  dragListeners,
}: {
  task: TeamTask;
  members: TeamMember[];
  canEdit: boolean;
  overlay?: boolean;
  onEdit: () => void;
  dragAttributes?: Record<string, unknown>;
  dragListeners?: Record<string, unknown>;
}) {
  const assignee = members.find((member) => member.userId === task.assigneeUserId);
  return (
    <div className={`${styles.taskCard} ${overlay ? styles.taskOverlay : ""}`}>
      <div className={styles.taskTop}>
        <span className={`${styles.priority} ${styles[`priority${task.priority}`]}`}>
          {PRIORITY_LABELS[task.priority]}
        </span>
        {canEdit && (
          <button
            className={styles.dragHandle}
            type="button"
            aria-label="Перетащить задачу"
            {...dragAttributes}
            {...dragListeners}
          ><GripVertical size={17} /></button>
        )}
      </div>
      <button className={styles.taskTitle} type="button" onClick={onEdit} disabled={!canEdit}>
        {task.title}
      </button>
      {task.description && <p>{task.description}</p>}
      {!!task.tags?.length && (
        <div className={styles.taskTags}>{task.tags.slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)}</div>
      )}
      <footer>
        {task.dueDate ? <span><CalendarDays size={14} />{formatDate(task.dueDate)}</span> : <span />}
        {assignee ? (
          <span className={styles.assignee} title={assignee.displayName}>
            <i>{initials(assignee.displayName)}</i>{assignee.displayName}
          </span>
        ) : (
          <span className={styles.unassigned}>Не назначена</span>
        )}
      </footer>
    </div>
  );
}

function MembersPanel({
  workspace,
  viewerId,
  members,
  invites,
  busy,
  onInvite,
  onRole,
  onRemove,
  onLeave,
}: {
  workspace: WorkspaceSummary;
  viewerId: number;
  members: TeamMember[];
  invites: TeamInvite[];
  busy: boolean;
  onInvite: () => void;
  onRole: (memberId: number, role: Exclude<WorkspaceRole, "owner">) => void;
  onRemove: (member: TeamMember) => void;
  onLeave: () => void;
}) {
  const pending = invites.filter((invite) => invite.status === "pending");
  return (
    <section className={styles.panel}>
      <header className={styles.panelHeader}>
        <div><span className={styles.eyebrow}>Доступ и роли</span><h2>Участники</h2><p>Каждый видит только общие проекты этого пространства.</p></div>
        {canManage(workspace.role) && <button className={styles.primaryButton} type="button" onClick={onInvite}><MailPlus size={16} /> Пригласить</button>}
      </header>
      <div className={styles.memberList}>
        {members.map((member) => {
          const isSelf = member.userId === viewerId;
          const canRemoveMember =
            canManage(workspace.role) &&
            member.role !== "owner" &&
            !isSelf &&
            !(workspace.role === "admin" && member.role === "admin");
          return (
            <div className={styles.memberRow} key={member.id}>
              <div className={styles.avatar}>{initials(member.displayName)}</div>
              <div className={styles.memberCopy}>
                <strong>{member.displayName}{isSelf ? " · вы" : ""}</strong>
                <span>{member.email}</span>
              </div>
              {workspace.role === "owner" && member.role !== "owner" ? (
                <select
                  value={member.role}
                  disabled={busy}
                  aria-label={`Роль ${member.displayName}`}
                  onChange={(event) => onRole(member.id, event.target.value as Exclude<WorkspaceRole, "owner">)}
                >
                  <option value="admin">Администратор</option>
                  <option value="member">Участник</option>
                  <option value="viewer">Наблюдатель</option>
                </select>
              ) : (
                <span className={styles.roleBadge}>{ROLE_LABELS[member.role]}</span>
              )}
              {canRemoveMember && (
                <button className={styles.iconDanger} type="button" onClick={() => onRemove(member)} aria-label={`Удалить ${member.displayName}`}>
                  <UserMinus size={17} />
                </button>
              )}
            </div>
          );
        })}
      </div>
      {!!pending.length && (
        <div className={styles.pendingBlock}>
          <h3>Ожидают ответа</h3>
          {pending.map((invite) => (
            <div key={invite.id}>
              <span><MailPlus size={16} /><strong>{invite.email}</strong></span>
              <small>{ROLE_LABELS[invite.role]} · до {formatDate(invite.expiresAt)}</small>
            </div>
          ))}
        </div>
      )}
      {workspace.role !== "owner" && (
        <div className={styles.leaveRow}>
          <span><strong>Выйти из пространства</strong><small>Общие проекты исчезнут из вашего списка, личные данные не изменятся.</small></span>
          <button className={styles.dangerButton} type="button" onClick={onLeave}>Покинуть</button>
        </div>
      )}
    </section>
  );
}

function ActivityPanel({ activity }: { activity: TeamActivity[] }) {
  return (
    <section className={styles.panel}>
      <header className={styles.panelHeader}>
        <div><span className={styles.eyebrow}>Последние изменения</span><h2>Активность</h2><p>Журнал основных действий помогает понимать, что изменилось в команде.</p></div>
      </header>
      {activity.length ? (
        <div className={styles.timeline}>
          {activity.map((item) => (
            <div key={item.id}>
              <span className={styles.timelineDot}><Activity size={14} /></span>
              <div><strong>{item.summary}</strong><small>{item.actorName || "FlowTrack"} · {formatDate(item.createdAt, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</small></div>
            </div>
          ))}
        </div>
      ) : (
        <div className={styles.activityEmpty}><Clock3 size={25} /><strong>История пока пуста</strong><span>Новые проекты, задачи и приглашения появятся здесь.</span></div>
      )}
    </section>
  );
}

function TeamModal({
  state,
  selected,
  busy,
  onClose,
  onSubmit,
  onDeleteTask,
}: {
  state: ModalState;
  selected: TeamData["selected"];
  busy: boolean;
  onClose: () => void;
  onSubmit: (
    action: string,
    payload: Record<string, unknown>,
    success: string,
    options?: {
      reloadWorkspaceId?: number | null;
      reloadFromResult?: boolean;
      projectFromResult?: boolean;
      preferredProjectId?: number | null;
    },
  ) => Promise<void>;
  onDeleteTask: (task: TeamTask) => void;
}) {
  const workspace = selected?.workspace;
  const task = state.kind === "task" ? state.task : undefined;
  const titles: Record<ModalState["kind"], string> = {
    workspace: state.kind === "workspace" && state.workspace ? "Настройки пространства" : "Новое Team Workspace",
    project: "Новый общий проект",
    invite: "Пригласить участника",
    task: task ? "Редактировать задачу" : "Новая общая задача",
  };

  useEffect(() => {
    const handle = (event: KeyboardEvent) => event.key === "Escape" && !busy && onClose();
    document.addEventListener("keydown", handle);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handle);
      document.body.style.overflow = "";
    };
  }, [busy, onClose]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (key: string) => String(form.get(key) ?? "");

    if (state.kind === "workspace") {
      const existing = state.workspace;
      await onSubmit(
        existing ? "updateWorkspace" : "createWorkspace",
        {
          workspaceId: existing?.id,
          name: value("name"),
          description: value("description"),
          kind: value("kind"),
          color: value("color"),
        },
        existing ? "Настройки пространства обновлены" : "Team Workspace создан",
        existing ? { reloadWorkspaceId: existing.id } : { reloadFromResult: true, preferredProjectId: null },
      );
    }
    if (state.kind === "project" && workspace) {
      await onSubmit(
        "createProject",
        {
          workspaceId: workspace.id,
          title: value("title"),
          description: value("description"),
          color: value("color"),
        },
        "Общий проект создан",
        { projectFromResult: true },
      );
    }
    if (state.kind === "invite" && workspace) {
      await onSubmit(
        "inviteMember",
        { workspaceId: workspace.id, email: value("email"), role: value("role") },
        "Приглашение создано",
      );
    }
    if (state.kind === "task" && workspace) {
      await onSubmit(
        task ? "updateTask" : "createTask",
        {
          workspaceId: workspace.id,
          projectId: task?.projectId ?? selected?.projects.find((project) =>
            selected.columns.some((column) => column.id === state.columnId && column.projectId === project.id)
          )?.id,
          columnId: state.columnId,
          taskId: task?.id,
          title: value("title"),
          description: value("description"),
          priority: value("priority"),
          dueDate: value("dueDate"),
          assigneeUserId: value("assigneeUserId"),
          tags: value("tags"),
        },
        task ? "Общая задача обновлена" : "Общая задача создана",
        { preferredProjectId: task?.projectId ?? null },
      );
    }
  }

  return (
    <div className={styles.modalBackdrop} onMouseDown={onClose}>
      <section className={styles.modal} role="dialog" aria-modal="true" aria-label={titles[state.kind]} onMouseDown={(event) => event.stopPropagation()}>
        <header><div><span className={styles.eyebrow}>FlowTrack · Team Workspace</span><h2>{titles[state.kind]}</h2></div><button type="button" onClick={onClose} aria-label="Закрыть"><X size={18} /></button></header>
        <form onSubmit={submit}>
          {state.kind === "workspace" && (
            <>
              <Field label="Название"><input name="name" required autoFocus maxLength={90} defaultValue={state.workspace?.name ?? ""} placeholder="Например, Семья Ким или Команда проекта" /></Field>
              <Field label="Описание"><textarea name="description" rows={3} maxLength={500} defaultValue={state.workspace?.description ?? ""} placeholder="Для чего вы будете использовать пространство" /></Field>
              <div className={styles.formGrid}>
                <Field label="Сценарий"><select name="kind" defaultValue={state.workspace?.kind ?? "team"}><option value="family">Семья</option><option value="team">Команда</option><option value="work">Работа</option><option value="other">Другое</option></select></Field>
                <Field label="Цвет"><input className={styles.colorInput} name="color" type="color" defaultValue={state.workspace?.color ?? "#6366f1"} /></Field>
              </div>
              <div className={styles.modalPrivacy}><ShieldCheck size={18} /><span><strong>Приватность по умолчанию</strong><small>Участники получат доступ только к общим проектам этого пространства.</small></span></div>
            </>
          )}
          {state.kind === "project" && (
            <>
              <Field label="Название"><input name="title" required autoFocus maxLength={120} placeholder="Запуск продукта" /></Field>
              <Field label="Описание"><textarea name="description" rows={3} maxLength={1000} placeholder="Цель и краткий контекст проекта" /></Field>
              <Field label="Цвет"><input className={styles.colorInput} name="color" type="color" defaultValue="#8b5cf6" /></Field>
            </>
          )}
          {state.kind === "invite" && (
            <>
              <Field label="Email аккаунта"><input name="email" type="email" required autoFocus autoComplete="email" placeholder="name@example.com" /></Field>
              <Field label="Роль"><select name="role" defaultValue="member"><option value="admin">Администратор — участники и проекты</option><option value="member">Участник — проекты и задачи</option><option value="viewer">Наблюдатель — только просмотр</option></select></Field>
              <p className={styles.formHint}>Приглашение появится в FlowTrack после входа с указанным email и будет действительно 14 дней.</p>
            </>
          )}
          {state.kind === "task" && (
            <>
              <Field label="Название"><input name="title" required autoFocus maxLength={180} defaultValue={task?.title ?? ""} placeholder="Что нужно сделать?" /></Field>
              <Field label="Описание"><textarea name="description" rows={3} maxLength={2000} defaultValue={task?.description ?? ""} placeholder="Контекст, результат или важные детали" /></Field>
              <div className={styles.formGrid}>
                <Field label="Приоритет"><select name="priority" defaultValue={task?.priority ?? "medium"}><option value="low">Низкий</option><option value="medium">Средний</option><option value="high">Высокий</option></select></Field>
                <Field label="Срок"><input name="dueDate" type="date" defaultValue={task?.dueDate ?? ""} /></Field>
              </div>
              <Field label="Ответственный"><select name="assigneeUserId" defaultValue={task?.assigneeUserId ?? ""}><option value="">Пока не назначен</option>{selected?.members.map((member) => <option key={member.userId} value={member.userId}>{member.displayName}</option>)}</select></Field>
              <Field label="Теги через запятую"><input name="tags" defaultValue={task?.tags?.join(", ") ?? ""} placeholder="дизайн, срочно" /></Field>
              {task && <button className={styles.deleteTask} type="button" onClick={() => onDeleteTask(task)}><Trash2 size={16} /> Удалить задачу</button>}
            </>
          )}
          <footer><button className={styles.ghostButton} type="button" onClick={onClose}>Отмена</button><button className={styles.primaryButton} type="submit" disabled={busy}>{busy ? "Сохраняю…" : "Сохранить"}</button></footer>
        </form>
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className={styles.field}><span>{label}</span>{children}</label>;
}
