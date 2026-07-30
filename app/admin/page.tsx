import Link from "next/link";
import { count, desc, isNull } from "drizzle-orm";
import {
  ArrowLeft,
  CheckCircle2,
  ClipboardList,
  FolderKanban,
  LogOut,
  ShieldCheck,
  StickyNote,
  UsersRound,
} from "lucide-react";
import {
  chatGPTSignOutPath,
  requireChatGPTUser,
} from "@/app/chatgpt-auth";
import {
  ensureCurrentUser,
} from "@/app/api/data/current-user";
import { getDb } from "@/db";
import {
  goals,
  habits,
  notes,
  projects,
  tasks,
  users,
} from "@/db/schema";

export const dynamic = "force-dynamic";

type CountRow = {
  userId: number | null;
  value: number;
};

function countByUser(rows: CountRow[]) {
  return new Map(
    rows
      .filter(
        (row): row is CountRow & { userId: number } =>
          row.userId !== null,
      )
      .map((row) => [row.userId, Number(row.value)]),
  );
}

function total(rows: CountRow[]) {
  return rows.reduce((sum, row) => sum + Number(row.value), 0);
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Tashkent",
  }).format(value);
}

export default async function AdminPage() {
  await requireChatGPTUser("/admin");
  const db = await getDb();
  const currentUser = await ensureCurrentUser(db);
  const signOutHref = chatGPTSignOutPath("/");

  if (currentUser.role !== "owner") {
    return (
      <main className="admin-shell admin-denied">
        <section className="admin-denied-card">
          <div className="admin-denied-icon">
            <ShieldCheck size={28} />
          </div>
          <span className="eyebrow">Закрытый раздел</span>
          <h1>Администрирование доступно только владельцу</h1>
          <p>
            Ваш личный кабинет продолжает работать, но управление
            пользователями защищено серверной проверкой роли.
          </p>
          <Link className="admin-primary-link" href="/">
            <ArrowLeft size={17} />
            Вернуться в FlowTrack
          </Link>
        </section>
      </main>
    );
  }

  const [
    userRows,
    projectRows,
    taskRows,
    habitRows,
    noteRows,
    goalRows,
  ] = await Promise.all([
    db
      .select()
      .from(users)
      .orderBy(desc(users.role), desc(users.createdAt)),
    db
      .select({ userId: projects.userId, value: count() })
      .from(projects)
      .where(isNull(projects.deletedAt))
      .groupBy(projects.userId),
    db
      .select({ userId: tasks.userId, value: count() })
      .from(tasks)
      .where(isNull(tasks.deletedAt))
      .groupBy(tasks.userId),
    db
      .select({ userId: habits.userId, value: count() })
      .from(habits)
      .where(isNull(habits.deletedAt))
      .groupBy(habits.userId),
    db
      .select({ userId: notes.userId, value: count() })
      .from(notes)
      .where(isNull(notes.deletedAt))
      .groupBy(notes.userId),
    db
      .select({ userId: goals.userId, value: count() })
      .from(goals)
      .where(isNull(goals.deletedAt))
      .groupBy(goals.userId),
  ]);

  const projectsByUser = countByUser(projectRows);
  const tasksByUser = countByUser(taskRows);
  const habitsByUser = countByUser(habitRows);
  const notesByUser = countByUser(noteRows);
  const goalsByUser = countByUser(goalRows);
  const activeSince =
    currentUser.lastSeenAt.getTime() - 7 * 24 * 60 * 60 * 1000;
  const activeUsers = userRows.filter(
    (user) => user.lastSeenAt.getTime() >= activeSince,
  ).length;

  return (
    <main className="admin-shell">
      <div className="admin-layout">
        <header className="admin-header">
          <div className="admin-brand">
            <div className="admin-brand-mark">
              <ShieldCheck size={24} />
            </div>
            <div>
              <strong>FlowTrack Admin</strong>
              <span>Панель владельца</span>
            </div>
          </div>
          <nav className="admin-header-actions" aria-label="Действия владельца">
            <Link href="/">
              <ArrowLeft size={16} />
              В приложение
            </Link>
            <a href={signOutHref}>
              <LogOut size={16} />
              Выйти
            </a>
          </nav>
        </header>

        <section className="admin-intro">
          <div>
            <span className="eyebrow">Администрирование</span>
            <h1>Пользователи и состояние FlowTrack</h1>
            <p>
              Здесь видны аккаунты и количество записей. Содержимое личных
              задач, заметок и целей остаётся закрытым.
            </p>
          </div>
          <div className="admin-owner-badge">
            <CheckCircle2 size={18} />
            <span>
              <strong>{currentUser.displayName}</strong>
              Подтверждённый владелец
            </span>
          </div>
        </section>

        <section className="admin-stats" aria-label="Статистика сайта">
          <article>
            <div className="admin-stat-icon admin-stat-violet">
              <UsersRound size={21} />
            </div>
            <span>Пользователи</span>
            <strong>{userRows.length}</strong>
            <small>{activeUsers} активны за 7 дней</small>
          </article>
          <article>
            <div className="admin-stat-icon admin-stat-blue">
              <FolderKanban size={21} />
            </div>
            <span>Проекты</span>
            <strong>{total(projectRows)}</strong>
            <small>без удалённых записей</small>
          </article>
          <article>
            <div className="admin-stat-icon admin-stat-amber">
              <ClipboardList size={21} />
            </div>
            <span>Задачи</span>
            <strong>{total(taskRows)}</strong>
            <small>во всех кабинетах</small>
          </article>
          <article>
            <div className="admin-stat-icon admin-stat-emerald">
              <StickyNote size={21} />
            </div>
            <span>Заметки</span>
            <strong>{total(noteRows)}</strong>
            <small>содержимое скрыто</small>
          </article>
        </section>

        <section className="admin-users-panel">
          <header>
            <div>
              <span className="panel-kicker">Аккаунты</span>
              <h2>Зарегистрированные пользователи</h2>
            </div>
            <span className="admin-private-note">
              <ShieldCheck size={15} />
              Личные данные не раскрываются
            </span>
          </header>

          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Пользователь</th>
                  <th>Роль</th>
                  <th>Последняя активность</th>
                  <th>Проекты</th>
                  <th>Задачи</th>
                  <th>Привычки</th>
                  <th>Заметки</th>
                  <th>Цели</th>
                </tr>
              </thead>
              <tbody>
                {userRows.map((user) => (
                  <tr key={user.id}>
                    <td>
                      <strong>{user.displayName}</strong>
                      <span>{user.email}</span>
                      <small>Регистрация: {formatDate(user.createdAt)}</small>
                    </td>
                    <td>
                      <span
                        className={
                          user.role === "owner"
                            ? "admin-role admin-role-owner"
                            : "admin-role"
                        }
                      >
                        {user.role === "owner" ? "Владелец" : "Участник"}
                      </span>
                    </td>
                    <td>{formatDate(user.lastSeenAt)}</td>
                    <td>{projectsByUser.get(user.id) ?? 0}</td>
                    <td>{tasksByUser.get(user.id) ?? 0}</td>
                    <td>{habitsByUser.get(user.id) ?? 0}</td>
                    <td>{notesByUser.get(user.id) ?? 0}</td>
                    <td>{goalsByUser.get(user.id) ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
