"use client";

import {
  FormEvent,
  lazy,
  ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
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
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  BarChart3,
  Calendar,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clock3,
  CloudOff,
  Code2,
  Database,
  Download,
  Edit3,
  Flag,
  Flame,
  FolderKanban,
  GripVertical,
  Import,
  Inbox,
  LayoutDashboard,
  LogOut,
  Maximize2,
  Minimize2,
  Monitor,
  Moon,
  MoreHorizontal,
  Pause,
  Palette,
  PanelLeft,
  Pin,
  Play,
  Plus,
  Printer,
  Repeat2,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  Square,
  StickyNote,
  Target,
  Timer,
  Trash2,
  TrendingUp,
  Undo2,
  Upload,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { dashboardGreeting } from "./dashboard-greeting";
import { reorderCardsWithinColumn } from "./kanban-order.mjs";
import {
  shiftAnalyticsAnchor,
  type AnalyticsPeriod,
  type AnalyticsSnapshot,
} from "./analytics-model";
import type { RichTextStats } from "./rich-text-editor";
import {
  applyUiPreferencesToDocument,
  getClientUiPreferencesSnapshot,
  getServerUiPreferencesSnapshot,
  getStoredLastView,
  resetUiPreferences,
  storeLastView,
  storeUiPreferences,
  subscribeToUiPreferences,
  type AccentColor,
  type MotionPreference,
  type SidebarMode,
  type StartView,
  type ThemePreference,
  type UiScale,
} from "./ui-preferences";

const RichTextEditor = lazy(() => import("./rich-text-editor"));

type View =
  | "overview"
  | "analytics"
  | "habits"
  | "print"
  | "schedule"
  | "projects"
  | "timer"
  | "notes"
  | "goals";

type Habit = {
  id: number;
  title: string;
  description: string | null;
  color: string;
  icon: string;
  frequency: "daily" | "weekdays" | "weekly";
  targetPerDay: number;
  order: number;
};

type HabitLog = {
  id: number;
  habitId: number;
  date: string;
  completed: boolean;
  count: number;
};

type Project = {
  id: number;
  title: string;
  description: string | null;
  color: string;
  status: string;
};

type Task = {
  id: number;
  title: string;
  description: string | null;
  status: "todo" | "doing" | "done";
  priority: "low" | "medium" | "high";
  dueDate: string | null;
  dueTime: string | null;
  estimatedMinutes: number | null;
  projectId: number | null;
  kanbanColumnId: number | null;
  kanbanOrder: number;
  inbox: boolean;
  recurrence: "none" | "daily" | "weekdays" | "weekly" | "monthly";
  tags: string[];
};

type Column = {
  id: number;
  projectId: number;
  title: string;
  order: number;
  color: string;
};

type Card = {
  id: number;
  columnId: number;
  title: string;
  description: string | null;
  priority: "low" | "medium" | "high";
  tags: string[];
  order: number;
  dueDate: string | null;
};

type TimeEntry = {
  id: number;
  title: string;
  projectId: number | null;
  taskId: number | null;
  startTime: string;
  endTime: string | null;
  duration: number | null;
  description: string | null;
};

type Note = {
  id: number;
  title: string;
  content: string;
  color: string;
  pinned: boolean;
  tags: string[];
  createdAt: string;
  updatedAt: string;
};

type NoteDraftFields = {
  title: string;
  content: string;
  color: string;
  pinned: boolean;
  tags: string;
};

type NoteSaveState = "dirty" | "saving" | "saved" | "error";

type StoredNoteDraft = NoteDraftFields & {
  version: 1;
  noteId: number | null;
  updatedAt: string;
};

type Goal = {
  id: number;
  title: string;
  description: string | null;
  category: string;
  targetValue: number | null;
  currentValue: number;
  unit: string | null;
  deadline: string | null;
  status: "active" | "completed";
  color: string;
};

type TrashItem = {
  id: number;
  title: string;
  entity: "task" | "project" | "habit" | "note" | "goal";
  deletedAt: string;
};

type ImportBatch = {
  id: string;
  title: string;
  source: string;
  counts: Record<string, number>;
  createdAt: string;
};

type PomodoroPhase = "focus" | "short_break" | "long_break";

type PomodoroState = {
  id: number;
  phase: PomodoroPhase;
  active: boolean;
  running: boolean;
  cycle: number;
  focusMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  cyclesBeforeLong: number;
  autoStartBreak: boolean;
  autoStartFocus: boolean;
  title: string;
  projectId: number | null;
  taskId: number | null;
  startedAt: string | null;
  endsAt: string | null;
  remainingSeconds: number;
  updatedAt: string | null;
};

type AppData = {
  viewer: {
    id: number;
    role: "owner" | "member";
  } | null;
  habits: Habit[];
  habitLogs: HabitLog[];
  tasks: Task[];
  projects: Project[];
  columns: Column[];
  cards: Card[];
  timeEntries: TimeEntry[];
  notes: Note[];
  goals: Goal[];
  pomodoro: PomodoroState;
  trash: TrashItem[];
  imports: ImportBatch[];
};

export type FlowTrackViewer = {
  displayName: string;
  email: string;
  fullName: string | null;
};

type FlowTrackBackupData = Omit<AppData, "viewer">;

type EditorKind =
  | "habit"
  | "task"
  | "project"
  | "column"
  | "card"
  | "timer"
  | "note"
  | "goal";

type EditorState = {
  kind: EditorKind;
  item?: Habit | Task | Card | Note | Goal;
  contextId?: number;
  defaults?: {
    dueDate?: string;
  };
};

const EMPTY_DATA: AppData = {
  viewer: null,
  habits: [],
  habitLogs: [],
  tasks: [],
  projects: [],
  columns: [],
  cards: [],
  timeEntries: [],
  notes: [],
  goals: [],
  trash: [],
  imports: [],
  pomodoro: {
    id: 1,
    phase: "focus",
    active: false,
    running: false,
    cycle: 0,
    focusMinutes: 25,
    shortBreakMinutes: 5,
    longBreakMinutes: 15,
    cyclesBeforeLong: 4,
    autoStartBreak: false,
    autoStartFocus: false,
    title: "Фокус-сессия",
    projectId: null,
    taskId: null,
    startedAt: null,
    endsAt: null,
    remainingSeconds: 25 * 60,
    updatedAt: null,
  },
};

const NAV_ITEMS = [
  { id: "overview" as const, label: "Сегодня", icon: LayoutDashboard },
  { id: "analytics" as const, label: "Аналитика", icon: BarChart3 },
  { id: "habits" as const, label: "Привычки", icon: Target },
  { id: "print" as const, label: "Печать", icon: Printer },
  { id: "schedule" as const, label: "Расписание", icon: CalendarDays },
  { id: "projects" as const, label: "Проекты", icon: FolderKanban },
  { id: "timer" as const, label: "Таймер", icon: Timer },
  { id: "notes" as const, label: "Заметки", icon: StickyNote },
  { id: "goals" as const, label: "Цели", icon: Flag },
];

const MOBILE_PRIMARY_NAV_ITEMS = [
  { id: "overview" as const, label: "Сегодня", icon: LayoutDashboard },
  { id: "habits" as const, label: "Привычки", icon: Target },
  { id: "schedule" as const, label: "План", icon: CalendarDays },
  { id: "projects" as const, label: "Проекты", icon: FolderKanban },
];

const MOBILE_MORE_NAV_ITEMS = [
  { id: "analytics" as const, label: "Аналитика", icon: BarChart3 },
  { id: "print" as const, label: "Печать", icon: Printer },
  { id: "timer" as const, label: "Таймер", icon: Timer },
  { id: "notes" as const, label: "Заметки", icon: StickyNote },
  { id: "goals" as const, label: "Цели", icon: Flag },
];

const UI_SCALE_OPTIONS: Array<{
  id: UiScale;
  label: string;
  hint: string;
}> = [
  { id: "compact", label: "Компактный", hint: "Больше данных" },
  { id: "comfortable", label: "Комфортный", hint: "По умолчанию" },
  { id: "large", label: "Крупный", hint: "Легче читать" },
];
const THEME_OPTIONS: Array<{
  id: ThemePreference;
  label: string;
  hint: string;
  icon: typeof Sun;
}> = [
  { id: "system", label: "Системная", hint: "Как на устройстве", icon: Monitor },
  { id: "light", label: "Светлая", hint: "Всегда светлая", icon: Sun },
  { id: "dark", label: "Тёмная", hint: "Мягкий графит", icon: Moon },
];
const ACCENT_OPTIONS: Array<{
  id: AccentColor;
  label: string;
  color: string;
}> = [
  { id: "violet", label: "Фиолетовый", color: "#7c3aed" },
  { id: "blue", label: "Синий", color: "#2563eb" },
  { id: "emerald", label: "Зелёный", color: "#059669" },
  { id: "orange", label: "Оранжевый", color: "#ea580c" },
  { id: "graphite", label: "Графитовый", color: "#475569" },
];
const SIDEBAR_OPTIONS: Array<{
  id: SidebarMode;
  label: string;
  hint: string;
}> = [
  { id: "expanded", label: "Развёрнутая", hint: "Все подписи видны" },
  { id: "compact", label: "Компактная", hint: "Только значки" },
  { id: "auto", label: "Автоматически", hint: "По ширине экрана" },
];
const START_VIEW_OPTIONS: Array<{
  id: StartView;
  label: string;
  hint: string;
}> = [
  { id: "overview", label: "Сегодня", hint: "План текущего дня" },
  { id: "last", label: "Последний раздел", hint: "Продолжить с того же места" },
  { id: "schedule", label: "Расписание", hint: "Сразу открыть календарь" },
];
const MOTION_OPTIONS: Array<{
  id: MotionPreference;
  label: string;
  hint: string;
}> = [
  { id: "system", label: "Системные", hint: "Учитывать устройство" },
  { id: "full", label: "Полные", hint: "Все переходы" },
  { id: "reduced", label: "Минимальные", hint: "Меньше движения" },
];
const VIEW_IDS: readonly View[] = NAV_ITEMS.map((item) => item.id);
type SettingsTab = "appearance" | "launch" | "account";
const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const PRIORITY_LABELS = {
  low: "Низкий",
  medium: "Средний",
  high: "Высокий",
};
type PrintTemplate = "week" | "month" | "day";
const PRINT_TEMPLATE_OPTIONS = [
  {
    id: "week" as const,
    label: "Неделя",
    description: "Привычки, цель и место для итогов",
    icon: CalendarDays,
  },
  {
    id: "month" as const,
    label: "Месяц",
    description: "Один лист с отметками на каждый день",
    icon: Calendar,
  },
  {
    id: "day" as const,
    label: "День",
    description: "Задачи, фокус, привычки и заметки",
    icon: StickyNote,
  },
] as const;
const subscribeToNothing = () => () => undefined;
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;
const subscribeToLocalHour = (onStoreChange: () => void) => {
  const interval = window.setInterval(onStoreChange, 60_000);
  return () => window.clearInterval(interval);
};
const getClientHourSnapshot = () => new Date().getHours();
const getServerHourSnapshot = () => 12;
const SIGN_IN_PATH = "/signin-with-chatgpt?return_to=%2F";
const DATA_REQUEST_TIMEOUT_MS = 15_000;

function redirectIfUnauthorized(response: Response) {
  if (response.status !== 401) return false;
  window.location.assign(SIGN_IN_PATH);
  return true;
}

async function fetchDataRequest(
  input: string,
  init: RequestInit = {},
): Promise<Response> {
  const controller = new AbortController();
  const sourceSignal = init.signal;
  let timedOut = false;
  const abortFromSource = () => controller.abort();

  if (sourceSignal?.aborted) {
    controller.abort();
  } else {
    sourceSignal?.addEventListener("abort", abortFromSource, { once: true });
  }

  const timeout = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, DATA_REQUEST_TIMEOUT_MS);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut) {
      throw new Error(
        "Сервер отвечает слишком долго. Проверьте соединение и попробуйте ещё раз.",
      );
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
    sourceSignal?.removeEventListener("abort", abortFromSource);
  }
}

function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateFromKey(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

function startOfWeek(date: Date) {
  const start = new Date(date);
  start.setHours(12, 0, 0, 0);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return start;
}

function addCalendarDays(date: Date, amount: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function habitFrequencyLabel(habit: Habit) {
  if (habit.frequency === "daily") return "Каждый день";
  if (habit.frequency === "weekdays") return "По будням";
  return "Раз в неделю";
}

function habitEmoji(habit: Habit) {
  if (habit.icon === "water") return "💧";
  if (habit.icon === "book") return "📖";
  if (habit.icon === "sport") return "💪";
  if (habit.icon === "sleep") return "🌙";
  return "✨";
}

function formatDate(value: string | Date, options?: Intl.DateTimeFormatOptions) {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat("ru-RU", options ?? {
    day: "numeric",
    month: "short",
  }).format(date);
}

function formatDuration(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours) return `${hours} ч ${minutes} мин`;
  return `${minutes} мин`;
}

function formatClock(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return [hours, minutes, rest]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}

function formatCountdown(seconds: number) {
  const safe = Math.max(0, Math.ceil(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const rest = safe % 60;
  return hours
    ? [hours, minutes, rest]
        .map((value) => String(value).padStart(2, "0"))
        .join(":")
    : [minutes, rest]
        .map((value) => String(value).padStart(2, "0"))
        .join(":");
}

function notePlainText(content: string) {
  if (!content) return "";
  if (!/<[a-z][\s\S]*>/i.test(content)) return content;
  return content
    .replace(/<li[^>]*data-type="taskItem"[^>]*>/gi, "☐ ")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|blockquote|pre)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#039;", "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function canonicalNoteContent(content: string) {
  return notePlainText(content) ? content : "";
}

function noteDraftFieldsFrom(note?: Note): NoteDraftFields {
  return {
    title: note?.title ?? "",
    content: note?.content ?? "",
    color: note?.color ?? "#fef3c7",
    pinned: note?.pinned ?? false,
    tags: note?.tags.join(", ") ?? "",
  };
}

function noteDraftFingerprint(fields: NoteDraftFields) {
  return JSON.stringify({
    title: fields.title,
    content: canonicalNoteContent(fields.content),
    color: fields.color,
    pinned: fields.pinned,
    tags: fields.tags,
  });
}

function hasMeaningfulNoteContent(fields: NoteDraftFields) {
  return Boolean(
    fields.title.trim() ||
      notePlainText(fields.content) ||
      fields.tags.trim(),
  );
}

function noteDraftStorageKey(ownerKey: string, noteId: number | null) {
  return `flowtrack:note-draft:v1:${encodeURIComponent(ownerKey)}:${noteId ?? "new"}`;
}

function readStoredNoteDraft(
  ownerKey: string,
  noteId: number | null,
): StoredNoteDraft | null {
  try {
    const raw = window.localStorage.getItem(
      noteDraftStorageKey(ownerKey, noteId),
    );
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredNoteDraft>;
    if (
      parsed.version !== 1 ||
      parsed.noteId !== noteId ||
      typeof parsed.title !== "string" ||
      typeof parsed.content !== "string" ||
      typeof parsed.color !== "string" ||
      typeof parsed.pinned !== "boolean" ||
      typeof parsed.tags !== "string" ||
      typeof parsed.updatedAt !== "string"
    ) {
      return null;
    }
    return parsed as StoredNoteDraft;
  } catch {
    return null;
  }
}

function writeStoredNoteDraft(
  ownerKey: string,
  noteId: number | null,
  fields: NoteDraftFields,
) {
  try {
    const draft: StoredNoteDraft = {
      version: 1,
      noteId,
      updatedAt: new Date().toISOString(),
      ...fields,
    };
    window.localStorage.setItem(
      noteDraftStorageKey(ownerKey, noteId),
      JSON.stringify(draft),
    );
  } catch {
    // Server autosave remains available if browser storage is unavailable.
  }
}

function clearStoredNoteDraft(ownerKey: string, noteId: number | null) {
  try {
    window.localStorage.removeItem(noteDraftStorageKey(ownerKey, noteId));
  } catch {
    // Browser privacy settings may disable local storage.
  }
}

function pluralizeRussian(
  value: number,
  one: string,
  few: string,
  many: string,
) {
  const modulo100 = value % 100;
  const modulo10 = value % 10;
  if (modulo100 >= 11 && modulo100 <= 14) return many;
  if (modulo10 === 1) return one;
  if (modulo10 >= 2 && modulo10 <= 4) return few;
  return many;
}

function noteStatsLabel(stats: RichTextStats) {
  const words = `${stats.words} ${pluralizeRussian(
    stats.words,
    "слово",
    "слова",
    "слов",
  )}`;
  const characters = `${stats.characters} ${pluralizeRussian(
    stats.characters,
    "символ",
    "символа",
    "символов",
  )}`;
  return stats.words
    ? `${words} · ${characters} · ~${stats.readingMinutes} мин чтения`
    : `${words} · ${characters}`;
}

type FlowTrackBackup = {
  format: "flowtrack-backup";
  schemaVersion: 1 | 2;
  appVersion: string;
  exportedAt: string;
  data: FlowTrackBackupData;
};

type FlowTrackPlan = {
  format: "flowtrack-plan";
  schemaVersion?: 1;
  version?: 1;
  title?: string;
  data?: Record<string, unknown>;
  [key: string]: unknown;
};

type PlanPreview = {
  title: string;
  counts: {
    projects: number;
    columns: number;
    tasks: number;
    habits: number;
    notes: number;
    goals: number;
  };
  duplicates: {
    projects: number;
    tasks: number;
    habits: number;
    notes: number;
    goals: number;
  };
  sample: {
    projects: string[];
    tasks: string[];
    habits: string[];
  };
};

type ToastState = {
  message: string;
  undo?: {
    entity: string;
    id: number | string;
  };
};

function backupFromData(data: AppData): FlowTrackBackup {
  const backupData: FlowTrackBackupData = {
    habits: data.habits,
    habitLogs: data.habitLogs,
    tasks: data.tasks,
    projects: data.projects,
    columns: data.columns,
    cards: data.cards,
    timeEntries: data.timeEntries,
    notes: data.notes,
    goals: data.goals,
    pomodoro: data.pomodoro,
    trash: data.trash,
    imports: data.imports,
  };
  return {
    format: "flowtrack-backup",
    schemaVersion: 2,
    appVersion: "5",
    exportedAt: new Date().toISOString(),
    data: backupData,
  };
}

function downloadJson(value: unknown, fileName: string) {
  const blob = new Blob([JSON.stringify(value, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function downloadBackup(data: AppData, suffix = "backup") {
  const backup = backupFromData(data);
  const day = backup.exportedAt.slice(0, 10);
  downloadJson(backup, `flowtrack-${suffix}-${day}.json`);
}

function downloadContext(data: AppData) {
  const projectRefs = new Map(
    data.projects.map((project) => [project.id, `project-${project.id}`]),
  );
  const columnRefs = new Map(
    data.columns.map((column) => [column.id, `column-${column.id}`]),
  );
  const context = {
    format: "flowtrack-context",
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    privacy: {
      noteBodiesIncluded: false,
      timeHistoryIncluded: false,
    },
    data: {
      projects: data.projects.map((project) => ({
        ref: projectRefs.get(project.id),
        title: project.title,
        description: project.description,
        color: project.color,
      })),
      columns: data.columns.map((column) => ({
        ref: columnRefs.get(column.id),
        projectRef: projectRefs.get(column.projectId),
        title: column.title,
        order: column.order,
      })),
      tasks: data.tasks
        .filter((task) => task.status !== "done")
        .map((task) => ({
          title: task.title,
          description: task.description,
          status: task.status,
          priority: task.priority,
          dueDate: task.dueDate,
          dueTime: task.dueTime,
          estimatedMinutes: task.estimatedMinutes,
          projectRef: task.projectId
            ? projectRefs.get(task.projectId)
            : undefined,
          columnRef: task.kanbanColumnId
            ? columnRefs.get(task.kanbanColumnId)
            : undefined,
          inbox: task.inbox,
          recurrence: task.recurrence,
          tags: task.tags,
        })),
      habits: data.habits.map((habit) => ({
        title: habit.title,
        description: habit.description,
        frequency: habit.frequency,
        targetPerDay: habit.targetPerDay,
      })),
      goals: data.goals
        .filter((goal) => goal.status === "active")
        .map((goal) => ({
          title: goal.title,
          description: goal.description,
          category: goal.category,
          targetValue: goal.targetValue,
          currentValue: goal.currentValue,
          unit: goal.unit,
          deadline: goal.deadline,
        })),
      noteIndex: data.notes.map((note) => ({
        title: note.title,
        tags: note.tags,
      })),
    },
  };
  downloadJson(
    context,
    `flowtrack-context-${context.exportedAt.slice(0, 10)}.json`,
  );
}

function parseBackup(value: unknown): FlowTrackBackup {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Файл содержит некорректные данные");
  }
  const backup = value as Record<string, unknown>;
  if (
    backup.format !== "flowtrack-backup" ||
    (backup.schemaVersion !== 1 && backup.schemaVersion !== 2) ||
    !backup.data ||
    typeof backup.data !== "object" ||
    Array.isArray(backup.data)
  ) {
    throw new Error("Это не поддерживаемая резервная копия FlowTrack");
  }
  if (
    typeof backup.exportedAt !== "string" ||
    Number.isNaN(new Date(backup.exportedAt).getTime())
  ) {
    throw new Error("В резервной копии отсутствует корректная дата экспорта");
  }
  const data = backup.data as Record<string, unknown>;
  const required = [
    "habits",
    "habitLogs",
    "tasks",
    "projects",
    "columns",
    "cards",
    "timeEntries",
    "notes",
    "goals",
  ];
  if (required.some((key) => !Array.isArray(data[key]))) {
    throw new Error("В резервной копии отсутствуют обязательные разделы");
  }
  return value as FlowTrackBackup;
}

function parsePlan(value: unknown): FlowTrackPlan {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Файл содержит некорректные данные");
  }
  const plan = value as Record<string, unknown>;
  const version = Number(plan.schemaVersion ?? plan.version);
  if (plan.format !== "flowtrack-plan" || version !== 1) {
    throw new Error("Это не план FlowTrack версии 1");
  }
  return value as FlowTrackPlan;
}

function calculateStreak(habitId: number, logs: HabitLog[]) {
  const completed = new Set(
    logs
      .filter((log) => log.habitId === habitId && log.completed)
      .map((log) => log.date),
  );
  const cursor = new Date();
  if (!completed.has(dateKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (completed.has(dateKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function habitLogKey(habitId: number, date: string) {
  return `${habitId}:${date}`;
}

function replaceHabitLog(
  logs: HabitLog[],
  habitId: number,
  date: string,
  nextLog: HabitLog | null,
) {
  const index = logs.findIndex(
    (log) => log.habitId === habitId && log.date === date,
  );
  if (!nextLog) {
    return index < 0 ? logs : logs.filter((_, logIndex) => logIndex !== index);
  }
  if (index < 0) return [...logs, nextLog];
  const nextLogs = [...logs];
  nextLogs[index] = nextLog;
  return nextLogs;
}

function itemProject(projects: Project[], id: number | null) {
  return id ? projects.find((project) => project.id === id) : undefined;
}

function accountInitials(user: FlowTrackViewer) {
  const source = user.fullName || user.displayName || user.email;
  const words = source
    .split(/[\s@._-]+/)
    .map((word) => word.trim())
    .filter(Boolean);
  return (words.length > 1 ? `${words[0][0]}${words[1][0]}` : words[0]?.slice(0, 2))
    ?.toLocaleUpperCase("ru-RU") || "FT";
}

export default function FlowTrackPage({
  currentUser,
  signOutHref,
}: {
  currentUser: FlowTrackViewer;
  signOutHref: string;
}) {
  const [view, setView] = useState<View>("overview");
  const [data, setData] = useState<AppData>(EMPTY_DATA);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const habitSaves = useRef(new Set<string>());
  const [savingHabitKeys, setSavingHabitKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [dataCenterOpen, setDataCenterOpen] = useState(false);
  const [quickCaptureOpen, setQuickCaptureOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("appearance");
  const startViewApplied = useRef(false);
  const uiPreferences = useSyncExternalStore(
    subscribeToUiPreferences,
    getClientUiPreferencesSnapshot,
    getServerUiPreferencesSnapshot,
  );

  useEffect(() => {
    applyUiPreferencesToDocument(uiPreferences);
  }, [uiPreferences]);

  useEffect(() => {
    if (startViewApplied.current) return;
    startViewApplied.current = true;
    const nextView =
      uiPreferences.startView === "last"
        ? getStoredLastView(VIEW_IDS, "overview")
        : uiPreferences.startView;
    setView(nextView);
  }, [uiPreferences.startView]);

  useEffect(() => {
    if (!accountMenuOpen && !mobileMoreOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (accountMenuOpen) setAccountMenuOpen(false);
      else setMobileMoreOpen(false);
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [accountMenuOpen, mobileMoreOpen]);

  async function loadData() {
    try {
      const response = await fetchDataRequest("/api/data", {
        cache: "no-store",
      });
      if (redirectIfUnauthorized(response)) return;
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Не удалось загрузить данные");
      setData(payload);
      setError(null);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Не удалось загрузить данные",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    fetchDataRequest("/api/data", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (redirectIfUnauthorized(response)) {
          throw new Error("Сессия завершена");
        }
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || "Не удалось загрузить данные");
        }
        return payload as AppData;
      })
      .then((payload) => {
        setData(payload);
        setError(null);
      })
      .catch((loadError: unknown) => {
        if (loadError instanceof DOMException && loadError.name === "AbortError") {
          return;
        }
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Не удалось загрузить данные",
        );
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  async function retryData() {
    setError(null);
    setLoading(true);
    await loadData();
  }

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(
      () => setToast(null),
      toast.undo ? 6500 : 2800,
    );
    return () => window.clearTimeout(timeout);
  }, [toast]);

  async function mutate(
    action: string,
    payload: Record<string, unknown>,
    success = "Сохранено",
  ) {
    setBusy(true);
    try {
      const response = await fetchDataRequest("/api/data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, payload }),
      });
      if (redirectIfUnauthorized(response)) return false;
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Операция не выполнена");
      await loadData();
      setToast({
        message: success,
        undo:
          result.undo &&
          typeof result.undo === "object" &&
          typeof result.undo.entity === "string" &&
          (typeof result.undo.id === "string" ||
            typeof result.undo.id === "number")
            ? result.undo
            : undefined,
      });
      setError(null);
      return true;
    } catch (mutationError) {
      setError(
        mutationError instanceof Error
          ? mutationError.message
          : "Операция не выполнена",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function setHabitCompletion(
    habitId: number,
    date: string,
    completed: boolean,
  ) {
    const saveKey = habitLogKey(habitId, date);
    if (habitSaves.current.has(saveKey)) return false;

    const previousLog =
      data.habitLogs.find(
        (log) => log.habitId === habitId && log.date === date,
      ) ?? null;
    const optimisticLog: HabitLog = previousLog
      ? {
          ...previousLog,
          completed,
          count: completed ? Math.max(previousLog.count, 1) : 0,
        }
      : {
          id: -(Date.now() + habitId),
          habitId,
          date,
          completed,
          count: completed ? 1 : 0,
        };

    habitSaves.current.add(saveKey);
    setSavingHabitKeys((current) => new Set(current).add(saveKey));
    setData((current) => ({
      ...current,
      habitLogs: replaceHabitLog(
        current.habitLogs,
        habitId,
        date,
        optimisticLog,
      ),
    }));

    try {
      const response = await fetchDataRequest("/api/data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "toggleHabit",
          payload: { habitId, date, completed },
        }),
      });
      if (redirectIfUnauthorized(response)) {
        throw new Error("Сессия завершена. Войдите снова, чтобы сохранить отметку.");
      }
      const result = (await response.json()) as {
        error?: string;
        habitLog?: HabitLog;
      };
      if (!response.ok) {
        throw new Error(result.error || "Не удалось сохранить отметку");
      }

      setData((current) => ({
        ...current,
        habitLogs: replaceHabitLog(
          current.habitLogs,
          habitId,
          date,
          result.habitLog ?? optimisticLog,
        ),
      }));
      setToast({
        message: completed ? "Привычка выполнена" : "Отметка снята",
      });
      setError(null);
      return true;
    } catch (mutationError) {
      setData((current) => ({
        ...current,
        habitLogs: replaceHabitLog(
          current.habitLogs,
          habitId,
          date,
          previousLog,
        ),
      }));
      setError(
        mutationError instanceof Error
          ? mutationError.message
          : "Не удалось сохранить отметку",
      );
      return false;
    } finally {
      habitSaves.current.delete(saveKey);
      setSavingHabitKeys((current) => {
        const next = new Set(current);
        next.delete(saveKey);
        return next;
      });
    }
  }

  const saveNote = useCallback(
    async (noteId: number | null, fields: NoteDraftFields) => {
      const response = await fetchDataRequest("/api/data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: noteId ? "updateNote" : "createNote",
          payload: {
            id: noteId ?? undefined,
            ...fields,
          },
        }),
      });
      if (redirectIfUnauthorized(response)) {
        throw new Error("Сессия завершена. Войдите снова, чтобы сохранить заметку.");
      }
      const result = (await response.json()) as {
        error?: string;
        note?: Note;
      };
      if (!response.ok || !result.note) {
        throw new Error(result.error || "Не удалось сохранить заметку");
      }

      const savedNote = result.note;
      setData((current) => {
        const existingIndex = current.notes.findIndex(
          (item) => item.id === savedNote.id,
        );
        if (existingIndex >= 0) {
          const nextNotes = [...current.notes];
          nextNotes[existingIndex] = savedNote;
          return { ...current, notes: nextNotes };
        }
        const firstUnpinned = current.notes.findIndex((item) => !item.pinned);
        const insertionIndex = savedNote.pinned
          ? 0
          : firstUnpinned < 0
            ? current.notes.length
            : firstUnpinned;
        const nextNotes = [...current.notes];
        nextNotes.splice(insertionIndex, 0, savedNote);
        return { ...current, notes: nextNotes };
      });
      setError(null);
      return savedNote;
    },
    [],
  );

  function navigate(next: View) {
    setView(next);
    storeLastView(next);
    setMobileMoreOpen(false);
    setSearchOpen(false);
    setAccountMenuOpen(false);
  }

  function openSettings(tab: SettingsTab = "appearance") {
    setSettingsTab(tab);
    setMobileMoreOpen(false);
    setAccountMenuOpen(true);
  }

  useEffect(() => {
    function handleShortcuts(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        target?.isContentEditable;
      const command = event.metaKey || event.ctrlKey;
      if (command && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (event.shiftKey) setSearchOpen(true);
        else setQuickCaptureOpen(true);
      } else if (event.key === "/" && !isTyping) {
        event.preventDefault();
        setSearchOpen(true);
      }
    }
    document.addEventListener("keydown", handleShortcuts);
    return () => document.removeEventListener("keydown", handleShortcuts);
  }, []);

  async function undoToast() {
    const undo = toast?.undo;
    if (!undo) return;
    setToast(null);
    if (undo.entity === "import") {
      await mutate(
        "undoPlanImport",
        { batchId: undo.id },
        "Импорт отменён",
      );
      return;
    }
    await mutate(
      "restoreDeleted",
      { entity: undo.entity, id: undo.id },
      "Запись восстановлена",
    );
  }

  const completedTasks = data.tasks.filter((task) => task.status === "done").length;
  const today = dateKey(new Date());
  const todayTasks = data.tasks.filter((task) => task.dueDate === today);
  const activeTimer = data.timeEntries.find((entry) => !entry.endTime);
  const completedToday = new Set(
    data.habitLogs
      .filter((log) => log.date === today && log.completed)
      .map((log) => log.habitId),
  ).size;
  const productivity = Math.round(
    ((data.tasks.length ? completedTasks / data.tasks.length : 0) +
      (data.habits.length ? completedToday / data.habits.length : 0)) *
      50,
  );
  const isOwner = data.viewer?.role === "owner";
  const mobileMoreActive = MOBILE_MORE_NAV_ITEMS.some(
    (item) => item.id === view,
  );

  return (
    <div
      className="app-shell"
      data-ui-scale={uiPreferences.scale}
      data-sidebar-mode={uiPreferences.sidebar}
      data-ui-theme={uiPreferences.theme}
      data-ui-accent={uiPreferences.accent}
      data-ui-motion={uiPreferences.motion}
    >
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Target size={22} />
          </div>
          <div>
            <strong>FlowTrack</strong>
            <span>личное пространство</span>
          </div>
        </div>

        <nav
          className="sidebar-nav desktop-sidebar-nav"
          aria-label="Разделы приложения"
        >
          {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={view === id ? "nav-item nav-item-active" : "nav-item"}
              onClick={() => navigate(id)}
              title={label}
            >
              <Icon size={19} />
              <span>{label}</span>
              {view === id && <i />}
            </button>
          ))}
        </nav>

        <nav
          className="mobile-bottom-nav"
          aria-label="Основная навигация"
        >
          {MOBILE_PRIMARY_NAV_ITEMS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={view === id ? "nav-item nav-item-active" : "nav-item"}
              onClick={() => navigate(id)}
              aria-current={view === id ? "page" : undefined}
            >
              <Icon size={19} />
              <span>{label}</span>
            </button>
          ))}
          <button
            className={
              mobileMoreOpen || mobileMoreActive
                ? "nav-item nav-item-active mobile-more-trigger"
                : "nav-item mobile-more-trigger"
            }
            type="button"
            onClick={() => setMobileMoreOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={mobileMoreOpen}
          >
            <MoreHorizontal size={20} />
            <span>Ещё</span>
          </button>
        </nav>

        <div className="sidebar-tools">
          <button onClick={() => setQuickCaptureOpen(true)}>
            <Plus size={16} />
            <span>Быстро добавить</span>
            <kbd>⌘K</kbd>
          </button>
          <button onClick={() => setSearchOpen(true)}>
            <Search size={16} />
            <span>Найти</span>
            <kbd>/</kbd>
          </button>
        </div>

        <div className="sidebar-footer">
          <div className="productivity-card">
            <div>
              <span>Продуктивность сегодня</span>
              <strong>{productivity}%</strong>
            </div>
            <div className="progress-track">
              <span style={{ width: `${productivity}%` }} />
            </div>
            <small>
              {completedToday}/{data.habits.length} привычек · {todayTasks.filter((task) => task.status === "done").length}/{todayTasks.length} задач
            </small>
          </div>
          <button
            className="data-center-button"
            onClick={() => setDataCenterOpen(true)}
          >
            <Database size={17} />
            <span>Данные и резервные копии</span>
          </button>
          <a className="team-workspace-shortcut" href="/team">
            <Users size={17} />
            <span>Team Workspace</span>
          </a>
          {isOwner && (
            <a className="admin-shortcut" href="/admin">
              <ShieldCheck size={17} />
              <span>Администрирование</span>
            </a>
          )}
          <button
            className="account-card"
            type="button"
            onClick={() => openSettings()}
            aria-label="Открыть профиль и настройки интерфейса"
          >
            <div className="account-avatar" aria-hidden="true">
              {accountInitials(currentUser)}
            </div>
            <div className="account-copy">
              <strong>{currentUser.displayName}</strong>
              <span>{currentUser.email}</span>
            </div>
            <span className="account-open" aria-hidden="true">
              <Settings2 size={16} />
            </span>
          </button>
        </div>
      </aside>

      <main className="main-content">
        <div className="mobile-header">
          <div className="mobile-brand" aria-label="FlowTrack">
            <span aria-hidden="true">
              <Target size={18} />
            </span>
            <strong>FlowTrack</strong>
          </div>
          <div className="mobile-header-actions">
            <button
              className="icon-button mobile-search-button"
              type="button"
              onClick={() => setSearchOpen(true)}
              aria-label="Открыть поиск"
            >
              <Search size={19} />
            </button>
            <button
              className="mobile-account"
              type="button"
              onClick={() => openSettings()}
              title={`${currentUser.displayName} · настройки`}
              aria-label="Открыть профиль и настройки"
            >
              <span aria-hidden="true">{accountInitials(currentUser)}</span>
            </button>
          </div>
        </div>

        {error && (
          <div className="error-banner">
            <span>{error}</span>
            <div className="error-banner-actions">
              <button
                className="error-retry"
                type="button"
                onClick={() => void retryData()}
              >
                <RotateCcw size={14} />
                Повторить
              </button>
              <button
                className="error-close"
                type="button"
                onClick={() => setError(null)}
                aria-label="Закрыть ошибку"
              >
                <X size={16} />
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <LoadingState />
        ) : (
          <>
            {view === "overview" && (
              <Overview
                currentUser={currentUser}
                data={data}
                todayTasks={todayTasks}
                activeTimer={activeTimer}
                onNavigate={navigate}
                onCreate={setEditor}
                onMutate={mutate}
              />
            )}
            {view === "analytics" && <AnalyticsView data={data} />}
            {view === "habits" && (
              <Habits
                data={data}
                onCreate={setEditor}
                onMutate={mutate}
                onToggleHabit={setHabitCompletion}
                savingHabitKeys={savingHabitKeys}
              />
            )}
            {view === "print" && (
              <PrintTemplates
                data={data}
                onToggleHabit={setHabitCompletion}
                savingHabitKeys={savingHabitKeys}
              />
            )}
            {view === "schedule" && (
              <Schedule
                data={data}
                onCreate={setEditor}
                onMutate={mutate}
              />
            )}
            {view === "projects" && (
              <Projects
                data={data}
                onCreate={setEditor}
                onMutate={mutate}
              />
            )}
            {view === "timer" && (
              <TimerView
                data={data}
                activeTimer={activeTimer}
                onCreate={setEditor}
                onMutate={mutate}
              />
            )}
            {view === "notes" && (
              <Notes
                data={data}
                onCreate={setEditor}
                onMutate={mutate}
              />
            )}
            {view === "goals" && (
              <Goals
                data={data}
                onCreate={setEditor}
                onMutate={mutate}
              />
            )}
          </>
        )}
      </main>

      {editor?.kind === "note" && (
        <NoteEditorModal
          key={`note-${editor.item?.id ?? "new"}`}
          note={editor.item as Note | undefined}
          ownerKey={String(data.viewer?.id ?? currentUser.email)}
          onClose={() => setEditor(null)}
          onSave={saveNote}
        />
      )}

      {editor && editor.kind !== "note" && (
        <EditorModal
          key={`${editor.kind}-${editor.item?.id ?? "new"}`}
          editor={editor}
          data={data}
          busy={busy}
          onClose={() => setEditor(null)}
          onMutate={async (action, payload, success) => {
            const saved = await mutate(action, payload, success);
            if (saved) setEditor(null);
          }}
        />
      )}

      {dataCenterOpen && (
        <DataCenterModal
          data={data}
          busy={busy}
          onClose={() => setDataCenterOpen(false)}
          onMutate={mutate}
          onRestore={(backup) =>
            mutate(
              "restoreBackup",
              { backup },
              "Данные восстановлены из резервной копии",
            )
          }
        />
      )}

      {quickCaptureOpen && (
        <QuickCaptureModal
          busy={busy}
          onClose={() => setQuickCaptureOpen(false)}
          onMutate={mutate}
        />
      )}

      {searchOpen && (
        <GlobalSearchModal
          data={data}
          onClose={() => setSearchOpen(false)}
          onNavigate={navigate}
          onOpenEditor={(next) => {
            setSearchOpen(false);
            setEditor(next);
          }}
        />
      )}

      {mobileMoreOpen && (
        <div
          className="mobile-more-backdrop"
          onMouseDown={() => setMobileMoreOpen(false)}
        >
          <section
            className="mobile-more-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="mobile-more-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="mobile-more-header">
              <div className="mobile-more-profile">
                <div className="account-avatar" aria-hidden="true">
                  {accountInitials(currentUser)}
                </div>
                <span>
                  <strong id="mobile-more-title">Ещё</strong>
                  <small>{currentUser.displayName}</small>
                </span>
              </div>
              <button
                className="icon-button"
                type="button"
                onClick={() => setMobileMoreOpen(false)}
                aria-label="Закрыть дополнительное меню"
              >
                <X size={18} />
              </button>
            </header>

            <div className="mobile-more-content">
              <section>
                <span className="mobile-more-label">Разделы</span>
                <div className="mobile-more-grid">
                  {MOBILE_MORE_NAV_ITEMS.map(
                    ({ id, label, icon: Icon }) => (
                      <button
                        key={id}
                        className={
                          view === id
                            ? "mobile-more-view mobile-more-view-active"
                            : "mobile-more-view"
                        }
                        type="button"
                        onClick={() => navigate(id)}
                      >
                        <Icon size={21} />
                        <span>{label}</span>
                      </button>
                    ),
                  )}
                </div>
              </section>

              <section>
                <span className="mobile-more-label">Управление</span>
                <div className="mobile-more-actions">
                  <button
                    className="mobile-more-quick-action"
                    type="button"
                    onClick={() => {
                      setMobileMoreOpen(false);
                      setQuickCaptureOpen(true);
                    }}
                  >
                    <Plus size={20} />
                    <span>
                      <strong>Быстро добавить</strong>
                      <small>Создать задачу, заметку или привычку</small>
                    </span>
                    <ChevronRight size={18} />
                  </button>
                  <button type="button" onClick={() => openSettings()}>
                    <Settings2 size={20} />
                    <span>
                      <strong>Настройки</strong>
                      <small>Тема, масштаб и поведение</small>
                    </span>
                    <ChevronRight size={18} />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMobileMoreOpen(false);
                      setDataCenterOpen(true);
                    }}
                  >
                    <Database size={20} />
                    <span>
                      <strong>Данные и резервные копии</strong>
                      <small>Импорт, экспорт и восстановление</small>
                    </span>
                    <ChevronRight size={18} />
                  </button>
                  <a href="/team">
                    <Users size={20} />
                    <span>
                      <strong>Team Workspace</strong>
                      <small>Общие проекты семьи или команды</small>
                    </span>
                    <ChevronRight size={18} />
                  </a>
                  {isOwner && (
                    <a href="/admin">
                      <ShieldCheck size={20} />
                      <span>
                        <strong>Администрирование</strong>
                        <small>Пользователи и статистика</small>
                      </span>
                      <ChevronRight size={18} />
                    </a>
                  )}
                </div>
              </section>
            </div>
          </section>
        </div>
      )}

      {accountMenuOpen && (
        <div
          className="settings-backdrop"
          onMouseDown={() => setAccountMenuOpen(false)}
        >
          <section
            className="settings-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Настройки FlowTrack"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="settings-header">
              <div className="settings-header-title">
                <span className="settings-header-icon" aria-hidden="true">
                  <SlidersHorizontal size={19} />
                </span>
                <span>
                  <strong>Настройки</strong>
                  <small>Применяются сразу на этом устройстве</small>
                </span>
              </div>
              <button
                className="icon-button"
                type="button"
                onClick={() => setAccountMenuOpen(false)}
                aria-label="Закрыть настройки"
              >
                <X size={18} />
              </button>
            </header>

            <div className="settings-layout">
              <nav
                className="settings-tabs"
                role="tablist"
                aria-label="Разделы настроек"
              >
                <button
                  className={
                    settingsTab === "appearance"
                      ? "settings-tab settings-tab-active"
                      : "settings-tab"
                  }
                  type="button"
                  role="tab"
                  aria-selected={settingsTab === "appearance"}
                  aria-controls="settings-panel-appearance"
                  onClick={() => setSettingsTab("appearance")}
                >
                  <Palette size={18} />
                  <span>Внешний вид</span>
                </button>
                <button
                  className={
                    settingsTab === "launch"
                      ? "settings-tab settings-tab-active"
                      : "settings-tab"
                  }
                  type="button"
                  role="tab"
                  aria-selected={settingsTab === "launch"}
                  aria-controls="settings-panel-launch"
                  onClick={() => setSettingsTab("launch")}
                >
                  <LayoutDashboard size={18} />
                  <span>Запуск</span>
                </button>
                <button
                  className={
                    settingsTab === "account"
                      ? "settings-tab settings-tab-active"
                      : "settings-tab"
                  }
                  type="button"
                  role="tab"
                  aria-selected={settingsTab === "account"}
                  aria-controls="settings-panel-account"
                  onClick={() => setSettingsTab("account")}
                >
                  <UserRound size={18} />
                  <span>Аккаунт</span>
                </button>
                <p>
                  Оформление хранится локально, поэтому на телефоне можно выбрать
                  другие параметры.
                </p>
              </nav>

              <div className="settings-content">
                {settingsTab === "appearance" && (
                  <div
                    className="settings-panel"
                    id="settings-panel-appearance"
                    role="tabpanel"
                  >
                    <div className="settings-panel-heading">
                      <span>
                        <strong>Внешний вид</strong>
                        <small>Настройте интерфейс под свой экран и освещение</small>
                      </span>
                    </div>

                    <section className="preference-section">
                      <div className="preference-heading">
                        <strong>Тема</strong>
                        <small>Системная меняется вместе с Windows или телефоном</small>
                      </div>
                      <div
                        className="theme-options"
                        role="radiogroup"
                        aria-label="Тема интерфейса"
                      >
                        {THEME_OPTIONS.map((option) => {
                          const Icon = option.icon;
                          return (
                            <button
                              key={option.id}
                              className={
                                uiPreferences.theme === option.id
                                  ? "theme-option preference-option-active"
                                  : "theme-option"
                              }
                              type="button"
                              role="radio"
                              aria-checked={uiPreferences.theme === option.id}
                              onClick={() =>
                                storeUiPreferences({ theme: option.id })
                              }
                            >
                              <span
                                className={`theme-preview theme-preview-${option.id}`}
                                aria-hidden="true"
                              >
                                <Icon size={18} />
                              </span>
                              <strong>{option.label}</strong>
                              <small>{option.hint}</small>
                            </button>
                          );
                        })}
                      </div>
                    </section>

                    <section className="preference-section preference-section-inline">
                      <div className="preference-heading">
                        <strong>Акцентный цвет</strong>
                        <small>Кнопки, выделения и активные элементы</small>
                      </div>
                      <div
                        className="accent-options"
                        role="radiogroup"
                        aria-label="Акцентный цвет"
                      >
                        {ACCENT_OPTIONS.map((option) => (
                          <button
                            key={option.id}
                            className={
                              uiPreferences.accent === option.id
                                ? "accent-option accent-option-active"
                                : "accent-option"
                            }
                            type="button"
                            role="radio"
                            aria-label={option.label}
                            aria-checked={uiPreferences.accent === option.id}
                            title={option.label}
                            onClick={() =>
                              storeUiPreferences({ accent: option.id })
                            }
                          >
                            <span
                              style={{ backgroundColor: option.color }}
                              aria-hidden="true"
                            />
                            <Check size={13} aria-hidden="true" />
                          </button>
                        ))}
                      </div>
                    </section>

                    <section className="preference-section">
                      <div className="preference-heading">
                        <strong>Масштаб интерфейса</strong>
                        <small>Безопасное увеличение без браузерного зума</small>
                      </div>
                      <div
                        className="ui-scale-options"
                        role="radiogroup"
                        aria-label="Масштаб интерфейса"
                      >
                        {UI_SCALE_OPTIONS.map((option) => (
                          <button
                            key={option.id}
                            className={
                              uiPreferences.scale === option.id
                                ? "ui-scale-option ui-scale-option-active"
                                : "ui-scale-option"
                            }
                            type="button"
                            role="radio"
                            aria-checked={uiPreferences.scale === option.id}
                            onClick={() =>
                              storeUiPreferences({ scale: option.id })
                            }
                          >
                            <span
                              className={`ui-scale-sample ui-scale-sample-${option.id}`}
                              aria-hidden="true"
                            >
                              Aa
                            </span>
                            <strong>{option.label}</strong>
                            <small>{option.hint}</small>
                          </button>
                        ))}
                      </div>
                    </section>

                    <section className="preference-section">
                      <div className="preference-heading">
                        <strong>Боковая панель</strong>
                        <small>На телефоне нижнее меню останется без изменений</small>
                      </div>
                      <div
                        className="preference-card-options"
                        role="radiogroup"
                        aria-label="Режим боковой панели"
                      >
                        {SIDEBAR_OPTIONS.map((option) => (
                          <button
                            key={option.id}
                            className={
                              uiPreferences.sidebar === option.id
                                ? "preference-card preference-option-active"
                                : "preference-card"
                            }
                            type="button"
                            role="radio"
                            aria-checked={uiPreferences.sidebar === option.id}
                            onClick={() =>
                              storeUiPreferences({ sidebar: option.id })
                            }
                          >
                            <PanelLeft size={18} aria-hidden="true" />
                            <span>
                              <strong>{option.label}</strong>
                              <small>{option.hint}</small>
                            </span>
                          </button>
                        ))}
                      </div>
                    </section>

                    <section className="preference-section">
                      <div className="preference-heading">
                        <strong>Анимации</strong>
                        <small>Минимальный режим снижает визуальное движение</small>
                      </div>
                      <div
                        className="preference-card-options"
                        role="radiogroup"
                        aria-label="Анимации интерфейса"
                      >
                        {MOTION_OPTIONS.map((option) => (
                          <button
                            key={option.id}
                            className={
                              uiPreferences.motion === option.id
                                ? "preference-card preference-option-active"
                                : "preference-card"
                            }
                            type="button"
                            role="radio"
                            aria-checked={uiPreferences.motion === option.id}
                            onClick={() =>
                              storeUiPreferences({ motion: option.id })
                            }
                          >
                            <Settings2 size={18} aria-hidden="true" />
                            <span>
                              <strong>{option.label}</strong>
                              <small>{option.hint}</small>
                            </span>
                          </button>
                        ))}
                      </div>
                    </section>
                  </div>
                )}

                {settingsTab === "launch" && (
                  <div
                    className="settings-panel"
                    id="settings-panel-launch"
                    role="tabpanel"
                  >
                    <div className="settings-panel-heading">
                      <span>
                        <strong>Запуск FlowTrack</strong>
                        <small>Выберите, что показывать после открытия приложения</small>
                      </span>
                    </div>
                    <section className="preference-section">
                      <div className="preference-heading">
                        <strong>Стартовый раздел</strong>
                        <small>Настройка начнёт действовать при следующем запуске</small>
                      </div>
                      <div
                        className="start-view-options"
                        role="radiogroup"
                        aria-label="Стартовый раздел"
                      >
                        {START_VIEW_OPTIONS.map((option) => (
                          <button
                            key={option.id}
                            className={
                              uiPreferences.startView === option.id
                                ? "start-view-option preference-option-active"
                                : "start-view-option"
                            }
                            type="button"
                            role="radio"
                            aria-checked={uiPreferences.startView === option.id}
                            onClick={() =>
                              storeUiPreferences({ startView: option.id })
                            }
                          >
                            <span>
                              <strong>{option.label}</strong>
                              <small>{option.hint}</small>
                            </span>
                            <Check size={17} aria-hidden="true" />
                          </button>
                        ))}
                      </div>
                    </section>
                    <div className="settings-info-card">
                      <LayoutDashboard size={20} />
                      <span>
                        <strong>Рекомендация FlowTrack</strong>
                        <small>
                          «Сегодня» лучше подходит для ежедневного планирования,
                          а «Последний раздел» — для длинной работы с проектами и
                          заметками.
                        </small>
                      </span>
                    </div>
                  </div>
                )}

                {settingsTab === "account" && (
                  <div
                    className="settings-panel"
                    id="settings-panel-account"
                    role="tabpanel"
                  >
                    <div className="settings-profile-card">
                      <div className="account-avatar settings-profile-avatar">
                        {accountInitials(currentUser)}
                      </div>
                      <span>
                        <strong>{currentUser.displayName}</strong>
                        <small>{currentUser.email}</small>
                        <em>
                          {isOwner ? "Владелец FlowTrack" : "Личный кабинет"}
                        </em>
                      </span>
                    </div>

                    <div className="settings-action-list">
                      <button
                        type="button"
                        onClick={() => {
                          setAccountMenuOpen(false);
                          setDataCenterOpen(true);
                        }}
                      >
                        <Database size={19} />
                        <span>
                          <strong>Данные и резервные копии</strong>
                          <small>Экспорт, импорт и управление данными</small>
                        </span>
                        <ChevronRight size={17} />
                      </button>
                      {isOwner && (
                        <a href="/admin">
                          <ShieldCheck size={19} />
                          <span>
                            <strong>Администрирование</strong>
                            <small>Пользователи и статистика</small>
                          </span>
                          <ChevronRight size={17} />
                        </a>
                      )}
                      <button
                        className="settings-reset-action"
                        type="button"
                        onClick={() => {
                          if (
                            !window.confirm(
                              "Вернуть стандартную тему, масштаб и поведение интерфейса?",
                            )
                          ) {
                            return;
                          }
                          resetUiPreferences();
                          setToast({ message: "Настройки интерфейса сброшены" });
                        }}
                      >
                        <RotateCcw size={19} />
                        <span>
                          <strong>Сбросить настройки интерфейса</strong>
                          <small>Вернуть рекомендуемые значения</small>
                        </span>
                        <ChevronRight size={17} />
                      </button>
                      <a className="settings-signout-action" href={signOutHref}>
                        <LogOut size={19} />
                        <span>
                          <strong>Выйти из аккаунта</strong>
                          <small>Завершить текущую сессию</small>
                        </span>
                        <ChevronRight size={17} />
                      </a>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>
      )}

      {toast && (
        <div className="toast">
          <CheckCircle2 size={17} />
          <span>{toast.message}</span>
          {toast.undo && (
            <button onClick={undoToast}>
              <Undo2 size={14} />
              Отменить
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function PageHeader({
  eyebrow,
  title,
  subtitle,
  action,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  action?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {action}
    </header>
  );
}

function PrimaryButton({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button className="primary-button" onClick={onClick}>
      <Plus size={17} />
      {children}
    </button>
  );
}

function EmptyState({
  icon,
  title,
  text,
  action,
}: {
  icon: ReactNode;
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}

function LoadingState() {
  return (
    <div className="loading-state">
      <div className="loader" />
      <strong>Загружаю твоё пространство</strong>
      <span>Синхронизирую задачи, привычки и проекты</span>
    </div>
  );
}

function Overview({
  currentUser,
  data,
  todayTasks,
  activeTimer,
  onNavigate,
  onCreate,
  onMutate,
}: {
  currentUser: FlowTrackViewer;
  data: AppData;
  todayTasks: Task[];
  activeTimer?: TimeEntry;
  onNavigate: (view: View) => void;
  onCreate: (editor: EditorState) => void;
  onMutate: (
    action: string,
    payload: Record<string, unknown>,
    success?: string,
  ) => Promise<boolean>;
}) {
  const today = new Date();
  const localHour = useSyncExternalStore(
    subscribeToLocalHour,
    getClientHourSnapshot,
    getServerHourSnapshot,
  );
  const completed = data.tasks.filter((task) => task.status === "done").length;
  const completionRate = data.tasks.length
    ? Math.round((completed / data.tasks.length) * 100)
    : 0;
  const week = Array.from({ length: 7 }, (_, index) => {
    const day = new Date();
    day.setDate(day.getDate() - (6 - index));
    const key = dateKey(day);
    return {
      key,
      label: new Intl.DateTimeFormat("ru-RU", { weekday: "short" })
        .format(day)
        .replace(".", ""),
      count: data.habitLogs.filter((log) => log.date === key && log.completed)
        .length,
    };
  });
  const max = Math.max(1, ...week.map((day) => day.count));
  const recentNotes = data.notes.slice(0, 4);
  const priorityRank = { high: 0, medium: 1, low: 2 };
  const prioritizedToday = [...todayTasks].sort(
    (left, right) =>
      Number(left.status === "done") - Number(right.status === "done") ||
      priorityRank[left.priority] - priorityRank[right.priority] ||
      (left.dueTime ?? "99:99").localeCompare(right.dueTime ?? "99:99"),
  );
  const inboxTasks = data.tasks
    .filter((task) => task.inbox && task.status !== "done")
    .slice(0, 4);

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Сегодня"
        title={dashboardGreeting(currentUser, localHour)}
        subtitle={new Intl.DateTimeFormat("ru-RU", {
          weekday: "long",
          day: "numeric",
          month: "long",
        }).format(today)}
        action={
          <button className="quiet-button" onClick={() => onCreate({ kind: "task" })}>
            <Plus size={16} />
            Быстрая задача
          </button>
        }
      />

      <section className="stats-grid">
        <StatCard
          icon={<Target size={21} />}
          label="Активных привычек"
          value={data.habits.length}
          color="indigo"
          onClick={() => onNavigate("habits")}
        />
        <StatCard
          icon={<CheckCircle2 size={21} />}
          label="Задач выполнено"
          value={`${completionRate}%`}
          note={`${completed} из ${data.tasks.length}`}
          color="emerald"
          onClick={() => onNavigate("schedule")}
        />
        <StatCard
          icon={<FolderKanban size={21} />}
          label="Активных проектов"
          value={data.projects.length}
          color="violet"
          onClick={() => onNavigate("projects")}
        />
        <StatCard
          icon={<Flag size={21} />}
          label="Целей в работе"
          value={data.goals.filter((goal) => goal.status === "active").length}
          color="amber"
          onClick={() => onNavigate("goals")}
        />
      </section>

      <section className="overview-grid">
        <div className="panel panel-wide">
          <div className="panel-heading">
            <div>
              <span className="panel-kicker">Динамика</span>
              <h2>
                <TrendingUp size={19} />
                Привычки за 7 дней
              </h2>
            </div>
            <span className="soft-badge">
              {data.habitLogs.filter((log) => log.completed).length} отметок
            </span>
          </div>
          <div className="habit-chart" aria-label="Выполненные привычки за неделю">
            {week.map((day) => (
              <div className="chart-column" key={day.key}>
                <span>{day.count}</span>
                <div>
                  <i style={{ height: `${Math.max(8, (day.count / max) * 100)}%` }} />
                </div>
                <small>{day.label}</small>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panel-heading">
            <div>
              <span className="panel-kicker">Фокус дня</span>
              <h2>
                <Clock3 size={19} />
                Сегодня и входящие
              </h2>
            </div>
            <button className="icon-button" onClick={() => onNavigate("schedule")}>
              <ChevronRight size={18} />
            </button>
          </div>
          <div className="compact-list">
            {prioritizedToday.length ? (
              prioritizedToday.slice(0, 3).map((task) => (
                <button
                  className="compact-row"
                  key={task.id}
                  onClick={() =>
                    onMutate(
                      "toggleTask",
                      { id: task.id, done: task.status !== "done" },
                      task.status === "done" ? "Задача возвращена" : "Задача выполнена",
                    )
                  }
                >
                  {task.status === "done" ? (
                    <CheckCircle2 size={17} className="success" />
                  ) : (
                    <Circle size={17} />
                  )}
                  <span>{task.title}</span>
                  {task.dueTime && <small>{task.dueTime}</small>}
                </button>
              ))
            ) : (
              <div className="small-empty">
                <CheckCircle2 size={28} />
                <span>На сегодня всё свободно</span>
              </div>
            )}
            <div className="inbox-divider">
              <span>
                <Inbox size={14} />
                Входящие
              </span>
              <small>{inboxTasks.length}</small>
            </div>
            {inboxTasks.length ? (
              inboxTasks.map((task) => (
                <button
                  className="compact-row"
                  key={`inbox-${task.id}`}
                  onClick={() => onCreate({ kind: "task", item: task })}
                >
                  <Circle size={17} />
                  <span>{task.title}</span>
                  <ChevronRight size={14} />
                </button>
              ))
            ) : (
              <div className="small-empty small-empty-inline">
                <Inbox size={20} />
                <span>Входящие разобраны</span>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="overview-grid overview-grid-even">
        <div className="panel">
          <div className="panel-heading">
            <div>
              <span className="panel-kicker">Мысли</span>
              <h2>
                <StickyNote size={19} />
                Последние заметки
              </h2>
            </div>
            <button className="text-link" onClick={() => onNavigate("notes")}>
              Все заметки
            </button>
          </div>
          {recentNotes.length ? (
            <div className="mini-notes">
              {recentNotes.map((note) => (
                <button
                  key={note.id}
                  style={{ "--note-color": note.color } as React.CSSProperties}
                  onClick={() => onCreate({ kind: "note", item: note })}
                >
                  <span>{note.title}</span>
                  <small>{notePlainText(note.content) || "Пустая заметка"}</small>
                </button>
              ))}
            </div>
          ) : (
            <div className="small-empty">
              <StickyNote size={28} />
              <span>Здесь появятся последние заметки</span>
            </div>
          )}
        </div>

        <div className="panel focus-panel">
          <div className="panel-heading">
            <div>
              <span className="panel-kicker">Учёт времени</span>
              <h2>
                <Timer size={19} />
                Текущий фокус
              </h2>
            </div>
          </div>
          {activeTimer ? (
            <ActiveTimer
              entry={activeTimer}
              onStop={() =>
                onMutate("stopTimer", { id: activeTimer.id }, "Таймер остановлен")
              }
              compact
            />
          ) : (
            <div className="focus-empty">
              <div>
                <Play size={22} />
              </div>
              <span>Таймер не запущен</span>
              <button onClick={() => onCreate({ kind: "timer" })}>
                Начать фокус
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  note,
  color,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  value: number | string;
  note?: string;
  color: string;
  onClick: () => void;
}) {
  return (
    <button className={`stat-card stat-${color}`} onClick={onClick}>
      <span className="stat-icon">{icon}</span>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
      {note && <small>{note}</small>}
      <ChevronRight className="stat-arrow" size={16} />
    </button>
  );
}

type AnalyticsActivityMode = "all" | "tasks" | "focus" | "habits";
type AnalyticsDailyPoint = AnalyticsSnapshot["daily"][number];

const ANALYTICS_PERIODS: Array<{
  id: AnalyticsPeriod;
  label: string;
}> = [
  { id: "week", label: "Неделя" },
  { id: "month", label: "Месяц" },
  { id: "quarter", label: "Квартал" },
  { id: "year", label: "Год" },
];

function formatAnalyticsDate(value: string, withYear = false) {
  return formatDate(`${value}T12:00:00Z`, {
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  }).replace(/\./g, "");
}

function analyticsTaskCount(value: number) {
  return `${value} ${pluralizeRussian(value, "задача", "задачи", "задач")}`;
}

function analyticsTaskGenitiveCount(value: number) {
  return `${value} ${pluralizeRussian(value, "задачи", "задач", "задач")}`;
}

function analyticsActivityUnit(
  value: number,
  mode: AnalyticsActivityMode,
) {
  if (mode === "focus") return `${value} мин`;
  if (mode === "tasks") return analyticsTaskCount(value);
  if (mode === "habits") {
    return `${value} ${pluralizeRussian(value, "отметка", "отметки", "отметок")}`;
  }
  return `${value} ${pluralizeRussian(
    value,
    "балл активности",
    "балла активности",
    "баллов активности",
  )}`;
}

function analyticsCompletionLabel(value: number) {
  if (value % 100 !== 11 && value % 10 === 1) {
    return `${value} задача завершена`;
  }
  if (
    !(value % 100 >= 12 && value % 100 <= 14) &&
    value % 10 >= 2 &&
    value % 10 <= 4
  ) {
    return `${value} задачи завершены`;
  }
  return `${value} задач завершено`;
}

function formatAnalyticsRange(range: AnalyticsSnapshot["range"]) {
  const sameYear = range.start.slice(0, 4) === range.effectiveEnd.slice(0, 4);
  return `${formatAnalyticsDate(range.start, !sameYear)} — ${formatAnalyticsDate(
    range.effectiveEnd,
    true,
  )}`;
}

function analyticsDeltaLabel(
  delta: number | null,
  suffix = "%",
) {
  if (delta === null) return "нет базы сравнения";
  if (delta === 0) return "без изменений";
  return `${delta > 0 ? "↑" : "↓"} ${Math.abs(delta)}${suffix}`;
}

function aggregateAnalyticsDaily(
  daily: AnalyticsDailyPoint[],
  period: AnalyticsPeriod,
) {
  if (period === "week" || period === "month") {
    return daily.map((point) => ({
      ...point,
      label:
        period === "week"
          ? formatDate(`${point.date}T12:00:00Z`, {
              weekday: "short",
              timeZone: "UTC",
            }).replace(".", "")
          : String(Number(point.date.slice(-2))),
    }));
  }

  const grouped = new Map<
    string,
    AnalyticsDailyPoint & { label: string }
  >();
  daily.forEach((point, index) => {
    const key =
      period === "year"
        ? point.date.slice(0, 7)
        : `week-${Math.floor(index / 7)}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.planned += point.planned;
      existing.completed += point.completed;
      existing.focusMinutes += point.focusMinutes;
      existing.habits += point.habits;
      return;
    }
    grouped.set(key, {
      ...point,
      label:
        period === "year"
          ? formatDate(`${point.date.slice(0, 7)}-01T12:00:00Z`, {
              month: "short",
              timeZone: "UTC",
            }).replace(".", "")
          : `${Math.floor(index / 7) + 1}`,
    });
  });
  return [...grouped.values()];
}

function AnalyticsMetricCard({
  icon,
  label,
  value,
  note,
  delta,
  deltaSuffix = " п.п.",
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  note: string;
  delta: number | null;
  deltaSuffix?: string;
  tone: "violet" | "blue" | "emerald" | "amber";
}) {
  return (
    <article className={`analytics-metric analytics-metric-${tone}`}>
      <header>
        <span>{icon}</span>
        <small
          className={
            delta === null || delta === 0
              ? "analytics-delta"
              : delta > 0
                ? "analytics-delta analytics-delta-up"
                : "analytics-delta analytics-delta-down"
          }
        >
          {analyticsDeltaLabel(delta, deltaSuffix)}
        </small>
      </header>
      <strong>{value}</strong>
      <span>{label}</span>
      <p>{note}</p>
    </article>
  );
}

function AnalyticsPlanChart({
  daily,
  period,
}: {
  daily: AnalyticsDailyPoint[];
  period: AnalyticsPeriod;
}) {
  const points = aggregateAnalyticsDaily(daily, period);
  const maximum = Math.max(
    1,
    ...points.flatMap((point) => [point.planned, point.completed]),
  );

  return (
    <div className="analytics-plan-chart">
      <div className="analytics-chart-legend" aria-hidden="true">
        <span><i className="analytics-legend-plan" />Запланировано</span>
        <span><i className="analytics-legend-done" />Выполнено</span>
      </div>
      <div
        className="analytics-bars"
        role="img"
        aria-label="Запланированные и выполненные задачи за выбранный период"
      >
        {points.map((point) => (
          <div
            className="analytics-bar-column"
            key={point.date}
            title={`${formatAnalyticsDate(point.date)}: ${point.planned} запланировано, ${point.completed} выполнено`}
          >
            <div className="analytics-bar-pair">
              <i
                className="analytics-bar-planned"
                style={{ height: `${(point.planned / maximum) * 100}%` }}
              />
              <i
                className="analytics-bar-completed"
                style={{ height: `${(point.completed / maximum) * 100}%` }}
              />
            </div>
            <small>{point.label}</small>
          </div>
        ))}
      </div>
    </div>
  );
}

function activityValue(
  point: AnalyticsDailyPoint,
  mode: AnalyticsActivityMode,
) {
  if (mode === "tasks") return point.completed;
  if (mode === "focus") return point.focusMinutes;
  if (mode === "habits") return point.habits;
  return point.completed * 2 + point.habits + Math.round(point.focusMinutes / 25);
}

function AnalyticsHeatmap({
  daily,
  mode,
  onModeChange,
}: {
  daily: AnalyticsDailyPoint[];
  mode: AnalyticsActivityMode;
  onModeChange: (mode: AnalyticsActivityMode) => void;
}) {
  const values = daily.map((point) => activityValue(point, mode));
  const maximum = Math.max(1, ...values);
  const firstOffset = daily.length
    ? (new Date(`${daily[0].date}T12:00:00Z`).getUTCDay() + 6) % 7
    : 0;
  const modeLabel = {
    all: "общая активность",
    tasks: "выполненные задачи",
    focus: "минуты фокуса",
    habits: "отметки привычек",
  }[mode];

  return (
    <>
      <div className="analytics-heatmap-toolbar">
        <div className="segmented analytics-activity-switch">
          {(
            [
              ["all", "Всё"],
              ["tasks", "Задачи"],
              ["focus", "Фокус"],
              ["habits", "Привычки"],
            ] as const
          ).map(([id, label]) => (
            <button
              className={mode === id ? "active" : ""}
              key={id}
              type="button"
              onClick={() => onModeChange(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="analytics-heatmap-scale" aria-hidden="true">
          <span>Меньше</span>
          {[0, 1, 2, 3, 4].map((level) => (
            <i data-level={level} key={level} />
          ))}
          <span>Больше</span>
        </div>
      </div>
      <div className="analytics-heatmap-scroll">
        <div
          className={
            daily.length <= 31
              ? "analytics-heatmap-grid analytics-heatmap-grid-short"
              : "analytics-heatmap-grid"
          }
          role="img"
          aria-label={`Календарь активности: ${modeLabel}`}
        >
          {Array.from({ length: firstOffset }, (_, index) => (
            <i className="analytics-heatmap-empty" key={`empty-${index}`} />
          ))}
          {daily.map((point) => {
            const value = activityValue(point, mode);
            const level = value ? Math.max(1, Math.ceil((value / maximum) * 4)) : 0;
            const unit = analyticsActivityUnit(value, mode);
            return (
              <i
                data-level={level}
                key={point.date}
                title={`${formatAnalyticsDate(point.date)} · ${unit}`}
              />
            );
          })}
        </div>
      </div>
    </>
  );
}

function AnalyticsProjectBreakdown({
  projects,
}: {
  projects: AnalyticsSnapshot["projects"];
}) {
  const maximum = Math.max(
    1,
    ...projects.map((project) =>
      project.focusSeconds
        ? project.focusSeconds
        : project.completed * 60,
    ),
  );

  if (!projects.length) {
    return (
      <div className="small-empty analytics-small-empty">
        <FolderKanban size={28} />
        <span>За этот период активности по проектам пока нет</span>
      </div>
    );
  }

  return (
    <div className="analytics-project-list">
      {projects.map((project) => {
        const weight = project.focusSeconds || project.completed * 60;
        return (
          <div className="analytics-project-row" key={project.id ?? "none"}>
            <div className="analytics-project-heading">
              <span>
                <i style={{ background: project.color }} />
                <strong>{project.title}</strong>
              </span>
              <small>
                {formatDuration(project.focusSeconds)} ·{" "}
                {analyticsTaskCount(project.completed)}
              </small>
            </div>
            <div className="analytics-project-track">
              <i
                style={{
                  width: `${Math.max(4, (weight / maximum) * 100)}%`,
                  background: project.color,
                }}
              />
            </div>
            <div className="analytics-project-meta">
              <span>{project.planned} в плане</span>
              {project.overdue > 0 && <span>{project.overdue} не завершено</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AnalyticsNarrative({
  snapshot,
}: {
  snapshot: AnalyticsSnapshot;
}) {
  const plan = snapshot.metrics.planCompletion;
  const focus = snapshot.metrics.focus;
  const planText = plan.denominator
    ? `Выполнено ${plan.numerator} из ${plan.denominator} запланированных задач — ${plan.value}%.`
    : "В выбранном периоде нет задач с установленным сроком.";
  const focusText =
    focus.delta === null
      ? `Фокус-время — ${formatDuration(focus.value)}; сравнение появится после следующего периода.`
      : `Фокус-время — ${formatDuration(focus.value)}, ${focus.delta === 0 ? "без изменений" : `${focus.delta > 0 ? "выше" : "ниже"} прошлого периода на ${Math.abs(focus.delta)}%`}.`;
  const bestDayText = snapshot.bestDay
    ? `Самый насыщенный день — ${formatAnalyticsDate(snapshot.bestDay)}.`
    : "Данных для определения самого активного дня пока недостаточно.";
  const attention: string[] = [];
  if (snapshot.metrics.overdueTasks) {
    const value = snapshot.metrics.overdueTasks;
    attention.push(
      value % 100 !== 11 && value % 10 === 1
        ? `${value} задача из плана не завершена`
        : `${analyticsTaskCount(value)} из плана не завершены`,
    );
  }
  if (snapshot.metrics.rescheduledTasks) {
    const value = snapshot.metrics.rescheduledTasks;
    attention.push(
      `${value} ${pluralizeRussian(
        value,
        "перенос срока",
        "переноса сроков",
        "переносов сроков",
      )}`,
    );
  }
  const nextFocus = attention.length
    ? `${attention.join("; ")}. Начните с незавершённых задач высокого приоритета.`
    : "Критичных сигналов за период нет. Сохраняйте текущий ритм и не перегружайте следующий план.";

  return (
    <div className="analytics-narrative-grid">
      <article>
        <span><CheckCircle2 size={17} />Результат</span>
        <p>{planText} {focusText}</p>
      </article>
      <article>
        <span><TrendingUp size={17} />Ритм</span>
        <p>{bestDayText} Регулярность привычек — {snapshot.metrics.habits.denominator ? `${snapshot.metrics.habits.value}%` : "пока без базы"}.</p>
      </article>
      <article>
        <span><Target size={17} />Следующий фокус</span>
        <p>{nextFocus}</p>
      </article>
    </div>
  );
}

function AnalyticsLoading() {
  return (
    <div className="analytics-loading" aria-label="Загрузка аналитики">
      {Array.from({ length: 4 }, (_, index) => (
        <i key={index} />
      ))}
    </div>
  );
}

function AnalyticsView({ data }: { data: AppData }) {
  const today = dateKey(new Date());
  const [period, setPeriod] = useState<AnalyticsPeriod>("week");
  const [anchor, setAnchor] = useState(today);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [activityMode, setActivityMode] =
    useState<AnalyticsActivityMode>("all");
  const [snapshot, setSnapshot] = useState<AnalyticsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const sourceRevision = useMemo(
    () =>
      JSON.stringify({
        habits: data.habits,
        habitLogs: data.habitLogs,
        tasks: data.tasks,
        projects: data.projects,
        timeEntries: data.timeEntries,
        trash: data.trash,
      }),
    [
      data.habitLogs,
      data.habits,
      data.projects,
      data.tasks,
      data.timeEntries,
      data.trash,
    ],
  );

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({
      period,
      anchor,
      today,
      timezoneOffset: String(new Date().getTimezoneOffset()),
    });
    if (projectId !== null) params.set("projectId", String(projectId));
    fetchDataRequest(`/api/analytics?${params}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (redirectIfUnauthorized(response)) {
          throw new Error("Сессия завершена");
        }
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || "Не удалось загрузить аналитику");
        }
        return payload as AnalyticsSnapshot;
      })
      .then((payload) => setSnapshot(payload))
      .catch((loadError: unknown) => {
        if (loadError instanceof DOMException && loadError.name === "AbortError") {
          return;
        }
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Не удалось загрузить аналитику",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [anchor, period, projectId, retryToken, sourceRevision, today]);

  const canMoveForward = Boolean(
    snapshot && snapshot.range.end < today,
  );
  const refreshAnalytics = () => {
    setLoading(true);
    setError(null);
    setRetryToken((value) => value + 1);
  };

  return (
    <div className="page-stack analytics-page">
      <PageHeader
        eyebrow="Результаты"
        title="Аналитика"
        subtitle="Не абстрактный балл продуктивности, а план, сроки, фокус и регулярность."
        action={
          <div className="analytics-header-actions">
            <span className="analytics-live-badge">
              <i />
              Данные обновляются автоматически
            </span>
            <button
              className="secondary-button analytics-refresh-button"
              type="button"
              onClick={refreshAnalytics}
              disabled={loading}
              aria-label="Обновить данные аналитики"
            >
              <RotateCcw size={16} aria-hidden="true" />
              {loading ? "Обновляю…" : "Обновить данные"}
            </button>
          </div>
        }
      />

      <section className="analytics-toolbar">
        <div className="segmented analytics-period-switch">
          {ANALYTICS_PERIODS.map((option) => (
            <button
              className={period === option.id ? "active" : ""}
              key={option.id}
              type="button"
              onClick={() => {
                setLoading(true);
                setError(null);
                setPeriod(option.id);
                setAnchor(today);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="analytics-range-control">
          <button
            className="icon-button"
            type="button"
            onClick={() => {
              setLoading(true);
              setError(null);
              setAnchor((current) =>
                shiftAnalyticsAnchor(period, current, -1),
              );
            }}
            aria-label="Предыдущий период"
          >
            <ChevronLeft size={18} />
          </button>
          <strong>
            {snapshot ? formatAnalyticsRange(snapshot.range) : "Загружаю период"}
          </strong>
          <button
            className="icon-button"
            type="button"
            disabled={!canMoveForward}
            onClick={() => {
              setLoading(true);
              setError(null);
              setAnchor((current) =>
                shiftAnalyticsAnchor(period, current, 1),
              );
            }}
            aria-label="Следующий период"
          >
            <ChevronRight size={18} />
          </button>
        </div>
        <label className="analytics-project-filter">
          <span>Проект</span>
          <select
            value={projectId ?? ""}
            onChange={(event) => {
              setLoading(true);
              setError(null);
              setProjectId(
                event.target.value ? Number(event.target.value) : null,
              );
            }}
          >
            <option value="">Все проекты</option>
            {data.projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.title}
              </option>
            ))}
          </select>
        </label>
      </section>

      {loading && !snapshot ? (
        <AnalyticsLoading />
      ) : error && !snapshot ? (
        <div className="analytics-error panel">
          <CloudOff size={31} />
          <strong>Аналитика временно недоступна</strong>
          <span>{error}</span>
          <button type="button" onClick={refreshAnalytics}>
            Повторить
          </button>
        </div>
      ) : snapshot ? (
        <>
          {error && (
            <div className="analytics-stale-note">
              Показаны последние загруженные данные. {error}
              <button type="button" onClick={refreshAnalytics}>
                Обновить
              </button>
            </div>
          )}

          <section className="analytics-metrics-grid" aria-label="Ключевые показатели">
            <AnalyticsMetricCard
              icon={<CheckCircle2 size={20} />}
              label="Выполнение плана"
              value={
                snapshot.metrics.planCompletion.denominator
                  ? `${snapshot.metrics.planCompletion.value}%`
                  : "—"
              }
              note={
                snapshot.metrics.planCompletion.denominator
                  ? `${snapshot.metrics.planCompletion.numerator} из ${analyticsTaskGenitiveCount(snapshot.metrics.planCompletion.denominator)}`
                  : "Добавьте задачам сроки"
              }
              delta={snapshot.metrics.planCompletion.delta}
              tone="violet"
            />
            <AnalyticsMetricCard
              icon={<CalendarDays size={20} />}
              label="Выполнено в срок"
              value={
                snapshot.metrics.onTime.denominator
                  ? `${snapshot.metrics.onTime.value}%`
                  : "—"
              }
              note={
                snapshot.metrics.onTime.denominator
                  ? `${snapshot.metrics.onTime.numerator} из ${analyticsTaskGenitiveCount(snapshot.metrics.onTime.denominator)} со сроком`
                  : "Нет завершённых задач со сроком"
              }
              delta={snapshot.metrics.onTime.delta}
              tone="blue"
            />
            <AnalyticsMetricCard
              icon={<Clock3 size={20} />}
              label="Фокус-время"
              value={formatDuration(snapshot.metrics.focus.value)}
              note={analyticsCompletionLabel(snapshot.metrics.completedTasks)}
              delta={snapshot.metrics.focus.delta}
              deltaSuffix="%"
              tone="emerald"
            />
            <AnalyticsMetricCard
              icon={<Target size={20} />}
              label="Регулярность привычек"
              value={
                snapshot.metrics.habits.denominator
                  ? `${snapshot.metrics.habits.value}%`
                  : "—"
              }
              note={
                snapshot.metrics.habits.denominator
                  ? `${snapshot.metrics.habits.numerator} из ${snapshot.metrics.habits.denominator} ${pluralizeRussian(
                      snapshot.metrics.habits.denominator,
                      "выполнения",
                      "выполнений",
                      "выполнений",
                    )}`
                  : "Пока нет ожидаемых выполнений"
              }
              delta={snapshot.metrics.habits.delta}
              tone="amber"
            />
          </section>

          <section className="analytics-summary-strip">
            <div>
              <span>Завершено</span>
              <strong>{snapshot.metrics.completedTasks}</strong>
            </div>
            <div>
              <span>Не завершено из плана</span>
              <strong>{snapshot.metrics.overdueTasks}</strong>
            </div>
            <div>
              <span>Переносы сроков</span>
              <strong>{snapshot.metrics.rescheduledTasks}</strong>
            </div>
            <div>
              <span>Лучший день</span>
              <strong>
                {snapshot.bestDay
                  ? formatAnalyticsDate(snapshot.bestDay)
                  : "Пока нет"}
              </strong>
            </div>
          </section>

          <section className="analytics-primary-grid">
            <div className="panel analytics-plan-panel">
              <div className="panel-heading">
                <div>
                  <span className="panel-kicker">План и факт</span>
                  <h2><BarChart3 size={19} />Задачи по периоду</h2>
                </div>
                <span className="soft-badge">
                  {snapshot.metrics.planCompletion.numerator}/{snapshot.metrics.planCompletion.denominator}
                </span>
              </div>
              <AnalyticsPlanChart daily={snapshot.daily} period={period} />
            </div>

            <div className="panel analytics-projects-panel">
              <div className="panel-heading">
                <div>
                  <span className="panel-kicker">Распределение</span>
                  <h2><FolderKanban size={19} />Результаты по проектам</h2>
                </div>
              </div>
              <AnalyticsProjectBreakdown projects={snapshot.projects} />
            </div>
          </section>

          <section className="panel analytics-heatmap-panel">
            <div className="panel-heading">
              <div>
                <span className="panel-kicker">Календарь активности</span>
                <h2><Calendar size={19} />Ритм без пропусков</h2>
              </div>
              {snapshot.habitsAreGlobal && (
                <span className="soft-badge">Привычки — по всем проектам</span>
              )}
            </div>
            <AnalyticsHeatmap
              daily={snapshot.daily}
              mode={activityMode}
              onModeChange={setActivityMode}
            />
          </section>

          <section className="panel analytics-report-panel">
            <div className="panel-heading">
              <div>
                <span className="panel-kicker">Автоматический итог</span>
                <h2><TrendingUp size={19} />Что говорит период</h2>
              </div>
              <span className="soft-badge">По точным правилам</span>
            </div>
            <AnalyticsNarrative snapshot={snapshot} />
            {snapshot.trackingStartedAt && (
              <p className="analytics-coverage-note">
                <Database size={15} />
                Завершения, привычки и фокус восстановлены из имеющейся истории.
                Переносы и возвраты задач точно фиксируются с{" "}
                {formatDate(new Date(snapshot.trackingStartedAt), {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                }).replace(/\.$/, "")}.
              </p>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}

function Habits({
  data,
  onCreate,
  onMutate,
  onToggleHabit,
  savingHabitKeys,
}: {
  data: AppData;
  onCreate: (editor: EditorState) => void;
  onMutate: (
    action: string,
    payload: Record<string, unknown>,
    success?: string,
  ) => Promise<boolean>;
  onToggleHabit: (
    habitId: number,
    date: string,
    completed: boolean,
  ) => Promise<boolean>;
  savingHabitKeys: Set<string>;
}) {
  const [month, setMonth] = useState(() => {
    const value = new Date();
    value.setDate(1);
    return value;
  });
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const dayCount = new Date(year, monthIndex + 1, 0).getDate();
  const offset = (new Date(year, monthIndex, 1).getDay() + 6) % 7;
  const days = Array.from({ length: dayCount }, (_, index) => index + 1);

  function shiftMonth(delta: number) {
    setMonth(new Date(year, monthIndex + delta, 1));
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Ритм"
        title="Привычки"
        subtitle="Отмечай регулярные действия и следи за сериями без разрывов."
        action={
          <PrimaryButton onClick={() => onCreate({ kind: "habit" })}>
            Новая привычка
          </PrimaryButton>
        }
      />

      <div className="month-toolbar">
        <button className="icon-button" onClick={() => shiftMonth(-1)}>
          <ChevronLeft size={19} />
        </button>
        <strong>
          {new Intl.DateTimeFormat("ru-RU", {
            month: "long",
            year: "numeric",
          }).format(month)}
        </strong>
        <button className="icon-button" onClick={() => shiftMonth(1)}>
          <ChevronRight size={19} />
        </button>
      </div>

      {data.habits.length ? (
        <div className="habit-list">
          {data.habits.map((habit, habitIndex) => {
            const monthPrefix = `${year}-${String(monthIndex + 1).padStart(2, "0")}-`;
            const completed = data.habitLogs.filter(
              (log) =>
                log.habitId === habit.id &&
                log.completed &&
                log.date.startsWith(monthPrefix),
            ).length;
            const streak = calculateStreak(habit.id, data.habitLogs);
            return (
              <article
                className="habit-card"
                key={habit.id}
                style={
                  {
                    "--habit-color": habit.color,
                    "--habit-index": habitIndex,
                  } as React.CSSProperties
                }
              >
                <div className="habit-info">
                  <div className="habit-symbol">
                    {habit.icon === "water"
                      ? "💧"
                      : habit.icon === "book"
                        ? "📖"
                        : habit.icon === "sport"
                          ? "💪"
                          : habit.icon === "sleep"
                            ? "🌙"
                            : "✨"}
                  </div>
                  <div>
                    <h2>{habit.title}</h2>
                    <p>{habit.description || "Без описания"}</p>
                    <div className="habit-meta">
                      <span>
                        {habit.frequency === "daily"
                          ? "Каждый день"
                          : habit.frequency === "weekdays"
                            ? "По будням"
                            : "Раз в неделю"}
                      </span>
                      {streak > 0 && (
                        <span className="streak">
                          <Flame size={13} /> {streak} дней
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="habit-calendar">
                  <div className="calendar-heading">
                    <span>{completed} выполнено</span>
                    <div>
                      <button
                        className="icon-button"
                        onClick={() => onCreate({ kind: "habit", item: habit })}
                        aria-label="Редактировать привычку"
                      >
                        <Edit3 size={15} />
                      </button>
                      <button
                        className="icon-button danger"
                        onClick={() => {
                          if (window.confirm(`Удалить привычку «${habit.title}»?`)) {
                            onMutate(
                              "deleteHabit",
                              { id: habit.id },
                              "Привычка перемещена в корзину",
                            );
                          }
                        }}
                        aria-label="Удалить привычку"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                  <div
                    className="calendar-grid"
                    key={`${habit.id}-${monthPrefix}`}
                  >
                    {WEEKDAYS.map((day) => (
                      <span className="weekday" key={day}>
                        {day}
                      </span>
                    ))}
                    {Array.from({ length: offset }, (_, index) => (
                      <i key={`blank-${index}`} />
                    ))}
                    {days.map((day) => {
                      const key = `${monthPrefix}${String(day).padStart(2, "0")}`;
                      const done = data.habitLogs.some(
                        (log) =>
                          log.habitId === habit.id &&
                          log.date === key &&
                          log.completed,
                      );
                      const isToday = key === dateKey(new Date());
                      const saving = savingHabitKeys.has(
                        habitLogKey(habit.id, key),
                      );
                      return (
                        <button
                          key={key}
                          className={`${done ? "day-done" : ""} ${isToday ? "day-today" : ""} ${saving ? "day-pending" : ""}`}
                          disabled={saving}
                          aria-busy={saving}
                          aria-pressed={done}
                          onClick={() =>
                            onToggleHabit(habit.id, key, !done)
                          }
                          aria-label={`${day} число — ${done ? "выполнено" : "не выполнено"}`}
                        >
                          <span>{day}</span>
                          {done && (
                            <Check
                              className="day-check"
                              size={10}
                              strokeWidth={3}
                              aria-hidden="true"
                            />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={<Target size={30} />}
          title="Начни с одной привычки"
          text="Например: корейский язык, чтение или тренировка."
          action={
            <PrimaryButton onClick={() => onCreate({ kind: "habit" })}>
              Создать привычку
            </PrimaryButton>
          }
        />
      )}
    </div>
  );
}

function PrintTemplates({
  data,
  onToggleHabit,
  savingHabitKeys,
}: {
  data: AppData;
  onToggleHabit: (
    habitId: number,
    date: string,
    completed: boolean,
  ) => Promise<boolean>;
  savingHabitKeys: Set<string>;
}) {
  const [template, setTemplate] = useState<PrintTemplate>("week");
  const [anchor, setAnchor] = useState(() => dateKey(new Date()));
  const selectedDate = dateFromKey(anchor);
  const weekStart = startOfWeek(selectedDate);
  const weekDates = Array.from({ length: 7 }, (_, index) =>
    addCalendarDays(weekStart, index),
  );
  const monthStart = new Date(
    selectedDate.getFullYear(),
    selectedDate.getMonth(),
    1,
    12,
  );
  const monthDates = Array.from(
    {
      length: new Date(
        monthStart.getFullYear(),
        monthStart.getMonth() + 1,
        0,
      ).getDate(),
    },
    (_, index) => addCalendarDays(monthStart, index),
  );
  const printableHabits: Array<Habit | null> = data.habits.length
    ? data.habits
    : Array.from({ length: 5 }, () => null);
  const dailyTasks = data.tasks
    .filter((task) => task.dueDate === anchor && task.status !== "done")
    .slice(0, 5);
  const dailyTaskLines: Array<Task | null> = [
    ...dailyTasks,
    ...Array.from({ length: Math.max(0, 5 - dailyTasks.length) }, () => null),
  ];
  const weekLabel = `${formatDate(weekStart, {
    day: "numeric",
    month: "long",
  })} — ${formatDate(addCalendarDays(weekStart, 6), {
    day: "numeric",
    month: "long",
    year: "numeric",
  })}`;
  const monthLabel = new Intl.DateTimeFormat("ru-RU", {
    month: "long",
    year: "numeric",
  }).format(monthStart);
  const dayLabel = new Intl.DateTimeFormat("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(selectedDate);
  const printedTitle =
    template === "week"
      ? `Неделя · ${weekLabel}`
      : template === "month"
        ? `Месяц · ${monthLabel}`
        : `День · ${dayLabel}`;

  function selectAnchor(value: string) {
    if (!value) return;
    if (template === "month") {
      setAnchor(`${value}-01`);
      return;
    }
    const next = dateFromKey(value);
    setAnchor(dateKey(template === "week" ? startOfWeek(next) : next));
  }

  function printTemplate() {
    const previousTitle = document.title;
    const orientation = template === "day" ? "portrait" : "landscape";
    document.getElementById("flowtrack-print-page")?.remove();

    const pageStyle = document.createElement("style");
    pageStyle.id = "flowtrack-print-page";
    pageStyle.textContent = `@page { size: A4 ${orientation}; margin: 8mm; }`;
    document.head.appendChild(pageStyle);

    const restorePrintDocument = () => {
      document.title = previousTitle;
      pageStyle.remove();
    };
    document.title = `FlowTrack — ${printedTitle}`;
    window.addEventListener("afterprint", restorePrintDocument, { once: true });

    try {
      window.print();
    } catch (error) {
      restorePrintDocument();
      throw error;
    }
  }

  function isCompleted(habitId: number, date: string) {
    return data.habitLogs.some(
      (log) => log.habitId === habitId && log.date === date && log.completed,
    );
  }

  return (
    <div className="page-stack print-page">
      <PageHeader
        eyebrow="Бумажный режим"
        title="Печать"
        subtitle="Формируй чистые листы для ручных отметок — они не меняют статистику, пока ты не внесёшь факты в приложение."
        action={
          <button
            className="primary-button print-action"
            type="button"
            onClick={printTemplate}
          >
            <Printer size={17} />
            Печать / PDF
          </button>
        }
      />

      <section className="print-template-selector" aria-label="Выбор шаблона">
        {PRINT_TEMPLATE_OPTIONS.map(({ id, label, description, icon: Icon }) => (
          <button
            className={
              template === id
                ? "print-template-option print-template-option-active"
                : "print-template-option"
            }
            type="button"
            key={id}
            onClick={() => setTemplate(id)}
            aria-pressed={template === id}
          >
            <span className="print-template-icon" aria-hidden="true">
              <Icon size={19} />
            </span>
            <span>
              <strong>{label}</strong>
              <small>{description}</small>
            </span>
          </button>
        ))}
      </section>

      <section className="print-controls panel">
        <label>
          <span>
            {template === "week"
              ? "Неделя начинается"
              : template === "month"
                ? "Месяц"
                : "Дата"}
          </span>
          <input
            type={template === "month" ? "month" : "date"}
            value={template === "month" ? anchor.slice(0, 7) : dateKey(
              template === "week" ? weekStart : selectedDate,
            )}
            onChange={(event) => selectAnchor(event.target.value)}
          />
        </label>
        <div className="print-control-copy">
          <strong>{printedTitle}</strong>
          <span>
            На лист попадут названия привычек и пустые поля для ручных отметок.
          </span>
        </div>
      </section>

      <section
        className={`print-sheet print-sheet-${template} print-export`}
        aria-label={`Шаблон на печать: ${printedTitle}`}
      >
        <header className="print-sheet-header">
          <div>
            <span className="print-sheet-kicker">FlowTrack · шаблон на печать</span>
            <h2>
              {template === "week"
                ? "Трекер привычек на неделю"
                : template === "month"
                  ? "Трекер привычек на месяц"
                  : "Ежедневный лист фокуса"}
            </h2>
            <p>{printedTitle}</p>
          </div>
          <div className="print-sheet-owner">
            <span>Цель периода</span>
            <strong />
          </div>
        </header>

        {template === "week" && (
          <>
            <table className="paper-habit-table" aria-label="Недельный трекер привычек">
              <thead>
                <tr>
                  <th scope="col">Привычка</th>
                  {weekDates.map((day) => (
                    <th scope="col" key={dateKey(day)}>
                      <span>
                        {new Intl.DateTimeFormat("ru-RU", {
                          weekday: "short",
                        })
                          .format(day)
                          .replace(".", "")}
                      </span>
                      <small>{day.getDate()}</small>
                    </th>
                  ))}
                  <th scope="col">Итог</th>
                </tr>
              </thead>
              <tbody>
                {printableHabits.map((habit, index) => (
                  <tr key={habit?.id ?? `blank-${index}`}>
                    <th scope="row">
                      {habit ? (
                        <span className="paper-habit-title">
                          <i style={{ backgroundColor: habit.color }} />
                          <span>
                            {habitEmoji(habit)} {habit.title}
                          </span>
                        </span>
                      ) : (
                        <span className="paper-empty-label">Новая привычка</span>
                      )}
                    </th>
                    {weekDates.map((day) => (
                      <td key={dateKey(day)}>
                        <span className="paper-check" aria-hidden="true" />
                      </td>
                    ))}
                    <td className="paper-total-cell">
                      <span className="paper-total-line" aria-hidden="true" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="paper-week-footer">
              <section>
                <h3>Что помогло держать ритм?</h3>
                <div className="paper-writing-space" />
              </section>
              <section>
                <h3>Что улучшить на следующей неделе?</h3>
                <div className="paper-writing-space" />
              </section>
            </div>
          </>
        )}

        {template === "month" && (
          <>
            <table className="paper-month-table" aria-label="Месячный трекер привычек">
              <thead>
                <tr>
                  <th scope="col">Привычка</th>
                  {monthDates.map((day) => (
                    <th scope="col" key={dateKey(day)}>
                      <span>{day.getDate()}</span>
                      <small>
                        {new Intl.DateTimeFormat("ru-RU", {
                          weekday: "narrow",
                        }).format(day)}
                      </small>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {printableHabits.map((habit, index) => (
                  <tr key={habit?.id ?? `blank-month-${index}`}>
                    <th scope="row">
                      {habit ? (
                        <span className="paper-habit-title">
                          <i style={{ backgroundColor: habit.color }} />
                          <span>{habit.title}</span>
                        </span>
                      ) : (
                        <span className="paper-empty-label">Новая привычка</span>
                      )}
                    </th>
                    {monthDates.map((day) => (
                      <td key={dateKey(day)}>
                        <span className="paper-check" aria-hidden="true" />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="paper-month-summary">
              <span>Главный результат месяца</span>
              <strong />
              <span>Фокус следующего месяца</span>
              <strong />
            </div>
          </>
        )}

        {template === "day" && (
          <div className="paper-day-layout">
            <section className="paper-day-section paper-day-tasks">
              <div className="paper-section-heading">
                <span>01</span>
                <h3>Главные задачи</h3>
              </div>
              <ol className="paper-task-list">
                {dailyTaskLines.map((task, index) => (
                  <li key={task?.id ?? `task-line-${index}`}>
                    <span className="paper-check" aria-hidden="true" />
                    <span>{task?.title ?? ""}</span>
                  </li>
                ))}
              </ol>
            </section>

            <section className="paper-day-section paper-day-focus">
              <div className="paper-section-heading">
                <span>02</span>
                <h3>Фокус / Pomodoro</h3>
              </div>
              <div className="paper-pomodoro-grid">
                {Array.from({ length: 8 }, (_, index) => (
                  <span key={index}>{index + 1}</span>
                ))}
              </div>
              <p>Отмечай каждый завершённый фокус-блок.</p>
            </section>

            <section className="paper-day-section paper-day-habits">
              <div className="paper-section-heading">
                <span>03</span>
                <h3>Привычки</h3>
              </div>
              <ul className="paper-day-habit-list">
                {printableHabits.slice(0, 6).map((habit, index) => (
                  <li key={habit?.id ?? `day-habit-${index}`}>
                    <span className="paper-check" aria-hidden="true" />
                    <span>{habit?.title ?? "Новая привычка"}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="paper-day-section paper-day-notes">
              <div className="paper-section-heading">
                <span>04</span>
                <h3>Заметки и вечерний итог</h3>
              </div>
              <div className="paper-notes-space" />
            </section>
          </div>
        )}

        <footer className="print-sheet-footer">
          <span>Распечатанный лист — это план и ручные заметки.</span>
          <span>Для статистики внеси фактические отметки в FlowTrack.</span>
        </footer>
      </section>

      {template === "week" && (
        <section className="paper-import-panel">
          <div>
            <span className="eyebrow">После бумаги</span>
            <h2>Внести отметки с бумаги</h2>
            <p>
              Перенеси только реальные выполнения. Эти галочки сразу сохраняются в
              привычках и учитываются в аналитике.
            </p>
          </div>
          {data.habits.length ? (
            <div className="paper-entry-table-wrap">
              <table className="paper-entry-table" aria-label="Внесение недельных отметок">
                <thead>
                  <tr>
                    <th scope="col">Привычка</th>
                    {weekDates.map((day) => (
                      <th scope="col" key={dateKey(day)}>
                        <span>
                          {new Intl.DateTimeFormat("ru-RU", {
                            weekday: "short",
                          })
                            .format(day)
                            .replace(".", "")}
                        </span>
                        <small>{day.getDate()}</small>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.habits.map((habit) => (
                    <tr key={habit.id}>
                      <th scope="row">
                        <span className="paper-entry-habit">
                          <i style={{ backgroundColor: habit.color }} />
                          <span>
                            <strong>{habit.title}</strong>
                            <small>{habitFrequencyLabel(habit)}</small>
                          </span>
                        </span>
                      </th>
                      {weekDates.map((day) => {
                        const key = dateKey(day);
                        const completed = isCompleted(habit.id, key);
                        const saving = savingHabitKeys.has(habitLogKey(habit.id, key));
                        return (
                          <td key={key}>
                            <button
                              className={
                                completed
                                  ? "paper-entry-toggle paper-entry-toggle-active"
                                  : "paper-entry-toggle"
                              }
                              type="button"
                              disabled={saving}
                              aria-busy={saving}
                              aria-pressed={completed}
                              aria-label={`${habit.title}: ${formatDate(day, {
                                weekday: "long",
                                day: "numeric",
                                month: "long",
                              })} — ${completed ? "выполнено" : "не выполнено"}`}
                              onClick={() =>
                                void onToggleHabit(habit.id, key, !completed)
                              }
                            >
                              {completed && <Check size={15} strokeWidth={3} />}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              icon={<Target size={26} />}
              title="Пока нет привычек"
              text="Создай привычки в соответствующем разделе — они появятся и в печатных листах."
            />
          )}
        </section>
      )}
    </div>
  );
}

function Schedule({
  data,
  onCreate,
  onMutate,
}: {
  data: AppData;
  onCreate: (editor: EditorState) => void;
  onMutate: (
    action: string,
    payload: Record<string, unknown>,
    success?: string,
  ) => Promise<boolean>;
}) {
  const [filter, setFilter] = useState<"all" | "todo" | "done" | "high">("all");
  const [weekOffset, setWeekOffset] = useState(0);
  const monday = useMemo(() => {
    const value = new Date();
    const weekday = value.getDay() || 7;
    value.setDate(value.getDate() - weekday + 1 + weekOffset * 7);
    value.setHours(0, 0, 0, 0);
    return value;
  }, [weekOffset]);
  const week = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(monday);
    day.setDate(monday.getDate() + index);
    return day;
  });
  const visibleTasks = data.tasks.filter((task) => {
    if (filter === "todo") return task.status !== "done";
    if (filter === "done") return task.status === "done";
    if (filter === "high") return task.priority === "high";
    return true;
  });

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="План"
        title="Расписание"
        subtitle="Неделя, задачи и дедлайны без лишнего шума."
        action={
          <PrimaryButton onClick={() => onCreate({ kind: "task" })}>
            Новая задача
          </PrimaryButton>
        }
      />

      <div className="schedule-toolbar">
        <div className="week-switcher">
          <button className="icon-button" onClick={() => setWeekOffset((value) => value - 1)}>
            <ChevronLeft size={18} />
          </button>
          <strong>
            {formatDate(week[0])} —{" "}
            {formatDate(week[6], {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </strong>
          <button className="icon-button" onClick={() => setWeekOffset((value) => value + 1)}>
            <ChevronRight size={18} />
          </button>
        </div>
        <div className="segmented">
          {[
            ["all", "Все"],
            ["todo", "Активные"],
            ["done", "Готовые"],
            ["high", "Важные"],
          ].map(([id, label]) => (
            <button
              key={id}
              className={filter === id ? "active" : ""}
              onClick={() => setFilter(id as typeof filter)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="week-board">
        {week.map((day) => {
          const key = dateKey(day);
          const tasksForDay = visibleTasks.filter((task) => task.dueDate === key);
          return (
            <section className={key === dateKey(new Date()) ? "week-day today" : "week-day"} key={key}>
              <header>
                <span>
                  {new Intl.DateTimeFormat("ru-RU", { weekday: "short" })
                    .format(day)
                    .replace(".", "")}
                </span>
                <strong>{day.getDate()}</strong>
              </header>
              <div>
                {tasksForDay.map((task) => (
                  <button
                    className={`week-task priority-${task.priority} ${task.status === "done" ? "task-done" : ""}`}
                    key={task.id}
                    onClick={() => onCreate({ kind: "task", item: task })}
                  >
                    <span>{task.title}</span>
                    {task.dueTime && <small>{task.dueTime}</small>}
                  </button>
                ))}
                {!tasksForDay.length && <span className="day-empty">Пока свободно</span>}
                <button
                  className="day-add-task"
                  onClick={() =>
                    onCreate({ kind: "task", defaults: { dueDate: key } })
                  }
                >
                  <Plus size={13} />
                  Задача
                </button>
              </div>
            </section>
          );
        })}
      </div>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="panel-kicker">Полный список</span>
            <h2>
              <CalendarDays size={19} />
              Все задачи
            </h2>
          </div>
          <span className="soft-badge">{visibleTasks.length}</span>
        </div>
        {visibleTasks.length ? (
          <div className="task-list">
            {visibleTasks.map((task) => {
              const project = itemProject(data.projects, task.projectId);
              return (
                <article className="task-row" key={task.id}>
                  <button
                    className="task-check"
                    onClick={() =>
                      onMutate(
                        "toggleTask",
                        { id: task.id, done: task.status !== "done" },
                        task.status === "done" ? "Задача возвращена" : "Задача выполнена",
                      )
                    }
                    aria-label="Изменить статус задачи"
                  >
                    {task.status === "done" ? (
                      <CheckCircle2 size={20} />
                    ) : (
                      <Circle size={20} />
                    )}
                  </button>
                  <div className={task.status === "done" ? "task-copy task-copy-done" : "task-copy"}>
                    <strong>{task.title}</strong>
                    <div>
                      {task.dueDate && (
                        <span>
                          <Calendar size={12} />
                          {formatDate(`${task.dueDate}T00:00:00`)}
                          {task.dueTime ? `, ${task.dueTime}` : ""}
                        </span>
                      )}
                      {project && (
                        <span style={{ "--project-color": project.color } as React.CSSProperties}>
                          <i className="project-dot" />
                          {project.title}
                        </span>
                      )}
                      <span className={`priority-chip priority-${task.priority}`}>
                        {PRIORITY_LABELS[task.priority]}
                      </span>
                      {task.recurrence !== "none" && (
                        <span>
                          <Repeat2 size={12} />
                          {task.recurrence === "daily"
                            ? "Ежедневно"
                            : task.recurrence === "weekdays"
                              ? "По будням"
                              : task.recurrence === "weekly"
                                ? "Еженедельно"
                                : "Ежемесячно"}
                        </span>
                      )}
                      {task.inbox && (
                        <span>
                          <Inbox size={12} />
                          Входящие
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="row-actions">
                    <button
                      className="icon-button"
                      onClick={() => onCreate({ kind: "task", item: task })}
                      aria-label="Редактировать задачу"
                    >
                      <Edit3 size={15} />
                    </button>
                    <button
                      className="icon-button danger"
                      onClick={() => {
                        if (window.confirm(`Удалить задачу «${task.title}»?`)) {
                          onMutate(
                            "deleteTask",
                            { id: task.id },
                            "Задача перемещена в корзину",
                          );
                        }
                      }}
                      aria-label="Удалить задачу"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <EmptyState
            icon={<CheckCircle2 size={30} />}
            title="Задач нет"
            text="Добавь первую задачу или измени выбранный фильтр."
          />
        )}
      </section>
    </div>
  );
}

function Projects({
  data,
  onCreate,
  onMutate,
}: {
  data: AppData;
  onCreate: (editor: EditorState) => void;
  onMutate: (
    action: string,
    payload: Record<string, unknown>,
    success?: string,
  ) => Promise<boolean>;
}) {
  const [selectedId, setSelectedId] = useState<number | null>(
    data.projects[0]?.id ?? null,
  );
  const effectiveSelectedId = data.projects.some(
    (project) => project.id === selectedId,
  )
    ? selectedId
    : (data.projects[0]?.id ?? null);
  const selected = data.projects.find(
    (project) => project.id === effectiveSelectedId,
  );
  const sourceColumns = useMemo(
    () =>
      selected
        ? data.columns
            .filter((column) => column.projectId === selected.id)
            .sort((left, right) => left.order - right.order)
        : [],
    [data.columns, selected],
  );
  const sourceCards = useMemo(() => {
    const columnIds = new Set(sourceColumns.map((column) => column.id));
    return data.cards.filter((card) => columnIds.has(card.columnId));
  }, [data.cards, sourceColumns]);
  const boardKey = useMemo(
    () =>
      JSON.stringify({
        projectId: selected?.id ?? null,
        columns: sourceColumns,
        cards: sourceCards,
      }),
    [selected?.id, sourceColumns, sourceCards],
  );
  const [boardOverride, setBoardOverride] = useState<
    { key: string; columns: Column[]; cards: Card[] } | undefined
  >();
  const usingOverride = boardOverride?.key === boardKey;
  const columns = usingOverride ? boardOverride.columns : sourceColumns;
  const cards = usingOverride ? boardOverride.cards : sourceCards;
  const [activeDrag, setActiveDrag] = useState<
    { type: "column" | "card"; id: number } | undefined
  >();
  const [savingBoard, setSavingBoard] = useState(false);
  const canUsePortal = useSyncExternalStore(
    subscribeToNothing,
    getClientSnapshot,
    getServerSnapshot,
  );

  function setBoard(columns: Column[], cards: Card[]) {
    setBoardOverride({ key: boardKey, columns, cards });
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 7 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const cardsByColumn = useMemo(() => {
    const grouped = new Map<number, Card[]>();
    columns.forEach((column) => grouped.set(column.id, []));
    cards.forEach((card) => {
      const group = grouped.get(card.columnId);
      if (group) group.push(card);
    });
    grouped.forEach((group) => group.sort((left, right) => left.order - right.order));
    return grouped;
  }, [cards, columns]);
  const activeCard =
    activeDrag?.type === "card"
      ? cards.find((card) => card.id === activeDrag.id)
      : undefined;
  const activeColumn =
    activeDrag?.type === "column"
      ? columns.find((column) => column.id === activeDrag.id)
      : undefined;

  function columnIdForTarget(id: string) {
    const direct =
      parseKanbanId(id, KANBAN_COLUMN_PREFIX) ??
      parseKanbanId(id, KANBAN_DROP_PREFIX);
    if (direct !== null) return direct;

    const cardId = parseKanbanId(id, KANBAN_CARD_PREFIX);
    return cardId === null
      ? null
      : (cards.find((card) => card.id === cardId)?.columnId ?? null);
  }

  async function persistColumns(next: Column[], previous: Column[]) {
    setSavingBoard(true);
    const saved = await onMutate(
      "reorderKanbanColumns",
      { items: next.map((column) => ({ id: column.id, order: column.order })) },
      "Порядок колонок сохранён",
    );
    setSavingBoard(false);
    if (!saved) setBoard(previous, cards);
  }

  async function persistCards(next: Card[], previous: Card[], destinationId: number) {
    setSavingBoard(true);
    const destination = columns.find((column) => column.id === destinationId);
    const saved = await onMutate(
      "reorderKanbanCards",
      {
        items: next.map((card) => ({
          id: card.id,
          columnId: card.columnId,
          order: card.order,
        })),
      },
      destination ? `Карточка перенесена в «${destination.title}»` : "Порядок карточек сохранён",
    );
    setSavingBoard(false);
    if (!saved) setBoard(columns, previous);
  }

  async function renameColumn(column: Column, title: string) {
    const nextTitle = title.trim();
    if (!nextTitle || nextTitle === column.title) return;
    const previous = columns;
    const next = columns.map((item) =>
      item.id === column.id ? { ...item, title: nextTitle } : item,
    );
    setBoard(next, cards);
    setSavingBoard(true);
    const saved = await onMutate(
      "updateColumn",
      { id: column.id, title: nextTitle, color: column.color },
      "Название колонки обновлено",
    );
    setSavingBoard(false);
    if (!saved) setBoard(previous, cards);
  }

  function onDragStart(event: DragStartEvent) {
    if (savingBoard) return;
    const type = event.active.data.current?.type;
    const itemId = Number(event.active.data.current?.itemId);
    if (
      (type === "card" || type === "column") &&
      Number.isInteger(itemId) &&
      itemId > 0
    ) {
      setActiveDrag({ type, id: itemId });
    }
  }

  function onDragEnd(event: DragEndEvent) {
    setActiveDrag(undefined);
    if (savingBoard || !event.over) return;

    const activeType = event.active.data.current?.type;
    const activeId = Number(event.active.data.current?.itemId);
    if (!Number.isInteger(activeId) || activeId <= 0) return;

    const overId = String(event.over.id);
    if (activeType === "column") {
      const targetId = columnIdForTarget(overId);
      if (!targetId || targetId === activeId) return;

      const fromIndex = columns.findIndex((column) => column.id === activeId);
      const toIndex = columns.findIndex((column) => column.id === targetId);
      if (fromIndex < 0 || toIndex < 0) return;

      const previous = columns;
      const next = [...columns];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      const ordered = next.map((column, order) => ({ ...column, order }));
      setBoard(ordered, cards);
      void persistColumns(ordered, previous);
      return;
    }

    if (activeType !== "card") return;
    const activeCard = cards.find((card) => card.id === activeId);
    const targetColumnId = columnIdForTarget(overId);
    if (!activeCard || !targetColumnId) return;
    if (parseKanbanId(overId, KANBAN_CARD_PREFIX) === activeId) return;

    const previous = cards;
    const sourceId = activeCard.columnId;
    const overCardId = parseKanbanId(overId, KANBAN_CARD_PREFIX);
    const replacements = new Map<number, Card>();

    if (sourceId === targetColumnId) {
      const currentColumnCards = cards
        .filter((card) => card.columnId === sourceId)
        .sort((left, right) => left.order - right.order);
      const reorderedCards = reorderCardsWithinColumn(
        currentColumnCards,
        activeId,
        overCardId,
      );
      if (reorderedCards === currentColumnCards) return;

      reorderedCards.forEach((card) => replacements.set(card.id, card));
    } else {
      const withoutActive = cards.filter((card) => card.id !== activeId);
      const sourceCards = withoutActive
        .filter((card) => card.columnId === sourceId)
        .sort((left, right) => left.order - right.order);
      const targetCards = withoutActive
        .filter((card) => card.columnId === targetColumnId)
        .sort((left, right) => left.order - right.order);
      const overIndex = overCardId
        ? targetCards.findIndex((card) => card.id === overCardId)
        : -1;
      const insertAt = overIndex >= 0 ? overIndex : targetCards.length;
      targetCards.splice(insertAt, 0, {
        ...activeCard,
        columnId: targetColumnId,
      });

      sourceCards.forEach((card, order) =>
        replacements.set(card.id, { ...card, order }),
      );
      targetCards.forEach((card, order) =>
        replacements.set(card.id, { ...card, order }),
      );
    }

    const next = cards.map((card) => replacements.get(card.id) ?? card);
    const changed = next.some((card, index) => {
      const before = previous[index];
      return before.columnId !== card.columnId || before.order !== card.order;
    });
    if (!changed) return;

    setBoard(columns, next);
    void persistCards(next, previous, targetColumnId);
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Работа"
        title="Проекты"
        subtitle="Разбивай большие дела на понятные этапы и карточки."
        action={
          <PrimaryButton onClick={() => onCreate({ kind: "project" })}>
            Новый проект
          </PrimaryButton>
        }
      />

      {data.projects.length ? (
        <>
          <div className="project-tabs">
            {data.projects.map((project) => (
              <button
                key={project.id}
                className={project.id === effectiveSelectedId ? "active" : ""}
                onClick={() => setSelectedId(project.id)}
              >
                <i style={{ backgroundColor: project.color }} />
                <span>{project.title}</span>
              </button>
            ))}
          </div>

          {selected && (
            <>
              <div className="project-heading">
                <div>
                  <h2>{selected.title}</h2>
                  <p>{selected.description || "Без описания проекта"}</p>
                  <span className="kanban-guidance">
                    Перетаскивай карточки между колонками — их статус и порядок сохраняются автоматически.
                  </span>
                </div>
                <div className="row-actions visible">
                  <button
                    className="quiet-button"
                    onClick={() =>
                      onCreate({ kind: "column", contextId: selected.id })
                    }
                  >
                    <Plus size={15} />
                    Колонка
                  </button>
                  <button
                    className="icon-button danger"
                    onClick={() => {
                      if (
                        window.confirm(
                          `Удалить проект «${selected.title}» вместе с карточками?`,
                        )
                      ) {
                        onMutate(
                          "deleteProject",
                          { id: selected.id },
                          "Проект перемещён в корзину",
                        );
                      }
                    }}
                    aria-label="Удалить проект"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>

              <DndContext
                sensors={sensors}
                collisionDetection={closestCorners}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
                onDragCancel={() => setActiveDrag(undefined)}
              >
                <SortableContext
                  items={columns.map((column) => kanbanColumnId(column.id))}
                  strategy={horizontalListSortingStrategy}
                >
                  <div className="kanban-board" aria-label="Канбан-доска проекта">
                    {columns.map((column) => (
                      <SortableKanbanColumn
                        key={column.id}
                        column={column}
                        cards={cardsByColumn.get(column.id) ?? []}
                        disabled={savingBoard}
                        onRename={renameColumn}
                        onCreateCard={(columnId) =>
                          onCreate({ kind: "card", contextId: columnId })
                        }
                        onEditCard={(card) =>
                          onCreate({
                            kind: "card",
                            item: card,
                            contextId: selected.id,
                          })
                        }
                        onDelete={() => {
                          if (
                            window.confirm(
                              `Удалить колонку «${column.title}» и её карточки?`,
                            )
                          ) {
                            onMutate(
                              "deleteColumn",
                              { id: column.id },
                              "Колонка удалена",
                            );
                          }
                        }}
                      />
                    ))}
                    <button
                      className="add-column-tile"
                      onClick={() =>
                        onCreate({ kind: "column", contextId: selected.id })
                      }
                    >
                      <Plus size={18} />
                      <span>Добавить колонку</span>
                    </button>
                  </div>
                </SortableContext>

                {canUsePortal
                  ? createPortal(
                      <DragOverlay
                        dropAnimation={null}
                      >
                        {activeCard ? (
                          <article className="kanban-card kanban-card-overlay">
                            <KanbanCardBody card={activeCard} />
                          </article>
                        ) : activeColumn ? (
                          <div className="kanban-column-overlay">
                            <GripVertical size={17} />
                            <strong>{activeColumn.title}</strong>
                          </div>
                        ) : null}
                      </DragOverlay>,
                      document.body,
                    )
                  : null}
              </DndContext>
            </>
          )}
        </>
      ) : (
        <EmptyState
          icon={<FolderKanban size={30} />}
          title="Создай первый проект"
          text="Проект автоматически получит три рабочие колонки."
          action={
            <PrimaryButton onClick={() => onCreate({ kind: "project" })}>
              Создать проект
            </PrimaryButton>
          }
        />
      )}
    </div>
  );
}

const KANBAN_COLUMN_PREFIX = "kanban-column:";
const KANBAN_CARD_PREFIX = "kanban-card:";
const KANBAN_DROP_PREFIX = "kanban-drop:";

function kanbanColumnId(id: number) {
  return `${KANBAN_COLUMN_PREFIX}${id}`;
}

function kanbanCardId(id: number) {
  return `${KANBAN_CARD_PREFIX}${id}`;
}

function kanbanDropId(id: number) {
  return `${KANBAN_DROP_PREFIX}${id}`;
}

function parseKanbanId(value: string, prefix: string) {
  if (!value.startsWith(prefix)) return null;
  const id = Number(value.slice(prefix.length));
  return Number.isInteger(id) && id > 0 ? id : null;
}

function SortableKanbanColumn({
  column,
  cards,
  disabled,
  onRename,
  onCreateCard,
  onEditCard,
  onDelete,
}: {
  column: Column;
  cards: Card[];
  disabled: boolean;
  onRename: (column: Column, title: string) => void;
  onCreateCard: (columnId: number) => void;
  onEditCard: (card: Card) => void;
  onDelete: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: kanbanColumnId(column.id),
    data: { type: "column", itemId: column.id },
    disabled,
  });
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: kanbanDropId(column.id),
    data: { type: "column-drop", columnId: column.id },
    disabled,
  });
  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
  };

  return (
    <section
      ref={setNodeRef}
      style={style}
      className={`kanban-column-sortable${isDragging ? " is-dragging" : ""}`}
    >
      <div
        ref={setDropRef}
        className={`kanban-column${isOver ? " is-drop-target" : ""}`}
      >
        <header>
          <div className="kanban-column-heading">
            <button
              type="button"
              className="kanban-drag-handle"
              aria-label={`Переместить колонку «${column.title}»`}
              title="Перетащить колонку"
              {...attributes}
              {...listeners}
            >
              <GripVertical size={16} />
            </button>
            <i style={{ backgroundColor: column.color }} />
            <input
              className="kanban-column-name"
              aria-label="Название колонки"
              defaultValue={column.title}
              onBlur={(event) => {
                const title = event.currentTarget.value.trim();
                if (title) onRename(column, title);
                else event.currentTarget.value = column.title;
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
                if (event.key === "Escape") {
                  event.currentTarget.value = column.title;
                  event.currentTarget.blur();
                }
              }}
              disabled={disabled}
            />
            <span title={`${cards.length} карточек`}>{cards.length}</span>
          </div>
          <button
            className="icon-button danger kanban-delete-column"
            onClick={onDelete}
            aria-label="Удалить колонку"
            disabled={disabled}
          >
            <Trash2 size={14} />
          </button>
        </header>

        <SortableContext
          items={cards.map((card) => kanbanCardId(card.id))}
          strategy={verticalListSortingStrategy}
        >
          <div className="kanban-cards">
            {cards.map((card) => (
              <SortableKanbanCard
                key={card.id}
                card={card}
                disabled={disabled}
                onClick={() => onEditCard(card)}
              />
            ))}
            {!cards.length && (
              <div className="column-empty">Перетащи сюда карточку</div>
            )}
          </div>
        </SortableContext>

        <button
          className="add-card-button"
          onClick={() => onCreateCard(column.id)}
          disabled={disabled}
        >
          <Plus size={15} />
          Добавить карточку
        </button>
      </div>
    </section>
  );
}

function SortableKanbanCard({
  card,
  disabled,
  onClick,
}: {
  card: Card;
  disabled: boolean;
  onClick: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: kanbanCardId(card.id),
    data: { type: "card", itemId: card.id },
    disabled,
  });
  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`kanban-card-sortable${isDragging ? " is-dragging" : ""}`}
    >
      <article className="kanban-card">
        <button className="kanban-card-open" onClick={onClick} type="button">
          <KanbanCardBody card={card} />
        </button>
        <button
          type="button"
          className="kanban-card-grip"
          aria-label={`Переместить карточку «${card.title}»`}
          title="Перетащить карточку"
          {...attributes}
          {...listeners}
          disabled={disabled}
        >
          <GripVertical size={15} />
        </button>
      </article>
    </div>
  );
}

function KanbanCardBody({ card }: { card: Card }) {
  return (
    <>
      <div className="kanban-card-title">
        <strong>{card.title}</strong>
      </div>
      {card.description && <p>{card.description}</p>}
      <footer>
        <span className={`priority-chip priority-${card.priority}`}>
          {PRIORITY_LABELS[card.priority]}
        </span>
        {card.dueDate && (
          <span>
            <Calendar size={11} />
            {formatDate(`${card.dueDate}T00:00:00`)}
          </span>
        )}
      </footer>
    </>
  );
}

function ActiveTimer({
  entry,
  onStop,
  compact = false,
}: {
  entry: TimeEntry;
  onStop: () => void;
  compact?: boolean;
}) {
  const [elapsed, setElapsed] = useState(() =>
    Math.max(0, Math.floor((Date.now() - new Date(entry.startTime).getTime()) / 1000)),
  );
  useEffect(() => {
    const update = () =>
      setElapsed(
        Math.max(
          0,
          Math.floor((Date.now() - new Date(entry.startTime).getTime()) / 1000),
        ),
      );
    update();
    const interval = window.setInterval(update, 1000);
    return () => window.clearInterval(interval);
  }, [entry.startTime]);

  return (
    <div className={compact ? "active-timer active-timer-compact" : "active-timer"}>
      <div className="timer-live">
        <span />
        Сейчас в фокусе
      </div>
      <h3>{entry.title}</h3>
      <strong>{formatClock(elapsed)}</strong>
      <button className="stop-button" onClick={onStop}>
        <Square size={16} />
        Остановить
      </button>
    </div>
  );
}

function TimerView({
  data,
  activeTimer,
  onCreate,
  onMutate,
}: {
  data: AppData;
  activeTimer?: TimeEntry;
  onCreate: (editor: EditorState) => void;
  onMutate: (
    action: string,
    payload: Record<string, unknown>,
    success?: string,
  ) => Promise<boolean>;
}) {
  const [mode, setMode] = useState<"free" | "pomodoro">(
    data.pomodoro.active ? "pomodoro" : "free",
  );
  const completedEntries = data.timeEntries.filter((entry) => entry.endTime);
  const today = dateKey(new Date());
  const todaySeconds = completedEntries
    .filter((entry) => dateKey(new Date(entry.startTime)) === today)
    .reduce((sum, entry) => sum + (entry.duration ?? 0), 0);
  const totalSeconds = completedEntries.reduce(
    (sum, entry) => sum + (entry.duration ?? 0),
    0,
  );

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Фокус"
        title="Таймер"
        subtitle="Выбери свободный отсчёт или структурированный ритм Помодоро."
      />

      <div className="segmented timer-mode-switch" aria-label="Режим таймера">
        <button
          className={mode === "free" ? "active" : ""}
          onClick={() => setMode("free")}
        >
          <Timer size={16} />
          Свободный таймер
        </button>
        <button
          className={mode === "pomodoro" ? "active" : ""}
          onClick={() => setMode("pomodoro")}
        >
          <Flame size={16} />
          Помодоро
          {data.pomodoro.active && <i className="mode-live-dot" />}
        </button>
      </div>

      {mode === "free" ? (
        <section className="timer-hero panel">
          {activeTimer ? (
            <ActiveTimer
              entry={activeTimer}
              onStop={() =>
                onMutate("stopTimer", { id: activeTimer.id }, "Таймер остановлен")
              }
            />
          ) : data.pomodoro.active ? (
            <div className="timer-start">
              <div>
                <Flame size={30} />
              </div>
              <h2>Сейчас идёт цикл Помодоро</h2>
              <p>Останови его или вернись в режим Помодоро, чтобы продолжить.</p>
              <button
                className="primary-button"
                onClick={() => setMode("pomodoro")}
              >
                Открыть Помодоро
              </button>
            </div>
          ) : (
            <div className="timer-start">
              <div>
                <Play size={30} />
              </div>
              <h2>Готов начать?</h2>
              <p>Назови занятие — отсчёт продолжится даже после перезагрузки.</p>
              <button
                className="primary-button"
                onClick={() => onCreate({ kind: "timer" })}
              >
                <Play size={17} />
                Запустить таймер
              </button>
            </div>
          )}
        </section>
      ) : (
        <PomodoroPanel
          pomodoro={data.pomodoro}
          projects={data.projects}
          tasks={data.tasks}
          freeTimerActive={Boolean(activeTimer)}
          onMutate={onMutate}
        />
      )}

      <div className="timer-stats">
        <div>
          <Clock3 size={19} />
          <span>Сегодня</span>
          <strong>{formatDuration(todaySeconds)}</strong>
        </div>
        <div>
          <BarChart3 size={19} />
          <span>Всего сессий</span>
          <strong>{completedEntries.length}</strong>
        </div>
        <div>
          <TrendingUp size={19} />
          <span>Общее время</span>
          <strong>{formatDuration(totalSeconds)}</strong>
        </div>
      </div>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="panel-kicker">История</span>
            <h2>
              <Clock3 size={19} />
              Последние сессии
            </h2>
          </div>
        </div>
        {completedEntries.length ? (
          <div className="time-list">
            {completedEntries.map((entry) => {
              const project = itemProject(data.projects, entry.projectId);
              return (
                <article key={entry.id}>
                  <i
                    style={{
                      backgroundColor: project?.color || "#64748b",
                    }}
                  />
                  <div>
                    <strong>{entry.title}</strong>
                    <span>
                      {formatDate(entry.startTime, {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      {project ? ` · ${project.title}` : ""}
                    </span>
                  </div>
                  <b>{formatDuration(entry.duration ?? 0)}</b>
                  <button
                    className="icon-button danger"
                    onClick={() => {
                      if (window.confirm("Удалить запись времени?")) {
                        onMutate(
                          "deleteTimeEntry",
                          { id: entry.id },
                          "Запись удалена",
                        );
                      }
                    }}
                    aria-label="Удалить запись времени"
                  >
                    <Trash2 size={15} />
                  </button>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="small-empty">
            <Clock3 size={28} />
            <span>Завершённые сессии появятся здесь</span>
          </div>
        )}
      </section>
    </div>
  );
}

function PomodoroPanel({
  pomodoro,
  projects,
  tasks,
  freeTimerActive,
  onMutate,
}: {
  pomodoro: PomodoroState;
  projects: Project[];
  tasks: Task[];
  freeTimerActive: boolean;
  onMutate: (
    action: string,
    payload: Record<string, unknown>,
    success?: string,
  ) => Promise<boolean>;
}) {
  const [now, setNow] = useState<number | null>(null);
  const advancingRef = useRef(false);

  useEffect(() => {
    if (!pomodoro.active || !pomodoro.running) return;
    const update = () => setNow(Date.now());
    update();
    const interval = window.setInterval(update, 1000);
    return () => window.clearInterval(interval);
  }, [pomodoro.active, pomodoro.running, pomodoro.endsAt]);

  const totalSeconds =
    pomodoro.phase === "focus"
      ? pomodoro.focusMinutes * 60
      : pomodoro.phase === "short_break"
        ? pomodoro.shortBreakMinutes * 60
        : pomodoro.longBreakMinutes * 60;
  const remaining =
    pomodoro.running && pomodoro.endsAt && now !== null
      ? Math.max(0, Math.ceil((new Date(pomodoro.endsAt).getTime() - now) / 1000))
      : pomodoro.remainingSeconds;
  const progress = Math.min(
    100,
    Math.max(0, ((totalSeconds - remaining) / Math.max(1, totalSeconds)) * 100),
  );
  const phaseLabel =
    pomodoro.phase === "focus"
      ? "Фокус"
      : pomodoro.phase === "short_break"
        ? "Короткий перерыв"
        : "Длинный перерыв";
  const nextLabel =
    pomodoro.phase === "focus"
      ? pomodoro.cycle + 1 >= pomodoro.cyclesBeforeLong &&
        (pomodoro.cycle + 1) % pomodoro.cyclesBeforeLong === 0
        ? "К длинному перерыву"
        : "К короткому перерыву"
      : "К следующему фокусу";

  useEffect(() => {
    if (
      !pomodoro.active ||
      !pomodoro.running ||
      !pomodoro.endsAt ||
      remaining > 0 ||
      advancingRef.current
    ) {
      return;
    }
    advancingRef.current = true;
    void onMutate(
      "advancePomodoro",
      { completed: true, expectedEndsAt: pomodoro.endsAt },
      pomodoro.phase === "focus"
        ? "Фокус завершён — время передохнуть"
        : "Перерыв завершён — возвращаемся к фокусу",
    ).finally(() => {
      advancingRef.current = false;
    });
  }, [
    onMutate,
    pomodoro.active,
    pomodoro.endsAt,
    pomodoro.phase,
    pomodoro.running,
    remaining,
  ]);

  async function submitSetup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const submitter = (event.nativeEvent as SubmitEvent)
      .submitter as HTMLButtonElement | null;
    const payload = {
      title: String(form.get("title") ?? ""),
      projectId: String(form.get("projectId") ?? ""),
      taskId: String(form.get("taskId") ?? ""),
      focusMinutes: String(form.get("focusMinutes") ?? ""),
      shortBreakMinutes: String(form.get("shortBreakMinutes") ?? ""),
      longBreakMinutes: String(form.get("longBreakMinutes") ?? ""),
      cyclesBeforeLong: String(form.get("cyclesBeforeLong") ?? ""),
      autoStartBreak: form.get("autoStartBreak") === "on",
      autoStartFocus: form.get("autoStartFocus") === "on",
    };
    const shouldStart = submitter?.value === "start";
    await onMutate(
      shouldStart ? "startPomodoro" : "updatePomodoroSettings",
      payload,
      shouldStart ? "Цикл Помодоро запущен" : "Настройки Помодоро сохранены",
    );
  }

  if (!pomodoro.active) {
    return (
      <section className="panel pomodoro-setup">
        <div className="pomodoro-setup-heading">
          <div className="pomodoro-mark">
            <Flame size={23} />
          </div>
          <div>
            <span className="panel-kicker">Персональный ритм</span>
            <h2>Настрой цикл Помодоро</h2>
            <p>
              Фокус и перерывы сохраняются в облаке и продолжаются после
              перезагрузки.
            </p>
          </div>
        </div>

        <form onSubmit={submitSetup}>
          <div className="pomodoro-setup-grid">
            <Field label="Над чем работаешь">
              <input
                name="title"
                required
                defaultValue={pomodoro.title}
                placeholder="Например, подготовить презентацию"
              />
            </Field>
            <Field label="Проект">
              <select name="projectId" defaultValue={pomodoro.projectId ?? ""}>
                <option value="">Без проекта</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.title}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Задача">
              <select name="taskId" defaultValue={pomodoro.taskId ?? ""}>
                <option value="">Без задачи</option>
                {tasks
                  .filter((task) => task.status !== "done")
                  .map((task) => (
                    <option key={task.id} value={task.id}>
                      {task.title}
                    </option>
                  ))}
              </select>
            </Field>
          </div>

          <div className="pomodoro-duration-grid">
            <Field label="Фокус, мин">
              <input
                name="focusMinutes"
                type="number"
                min="1"
                max="180"
                defaultValue={pomodoro.focusMinutes}
              />
            </Field>
            <Field label="Короткий перерыв">
              <input
                name="shortBreakMinutes"
                type="number"
                min="1"
                max="60"
                defaultValue={pomodoro.shortBreakMinutes}
              />
            </Field>
            <Field label="Длинный перерыв">
              <input
                name="longBreakMinutes"
                type="number"
                min="1"
                max="120"
                defaultValue={pomodoro.longBreakMinutes}
              />
            </Field>
            <Field label="Циклов до длинного">
              <input
                name="cyclesBeforeLong"
                type="number"
                min="2"
                max="12"
                defaultValue={pomodoro.cyclesBeforeLong}
              />
            </Field>
          </div>

          <div className="pomodoro-options">
            <label className="check-field">
              <input
                name="autoStartBreak"
                type="checkbox"
                defaultChecked={pomodoro.autoStartBreak}
              />
              <span>Автоматически запускать перерывы</span>
            </label>
            <label className="check-field">
              <input
                name="autoStartFocus"
                type="checkbox"
                defaultChecked={pomodoro.autoStartFocus}
              />
              <span>Автоматически запускать следующий фокус</span>
            </label>
          </div>

          {freeTimerActive && (
            <div className="pomodoro-warning">
              <Clock3 size={16} />
              Сначала останови свободный таймер.
            </div>
          )}

          <div className="pomodoro-setup-actions">
            <button
              className="secondary-button"
              type="submit"
              name="intent"
              value="save"
            >
              <Settings2 size={16} />
              Сохранить настройки
            </button>
            <button
              className="primary-button"
              type="submit"
              name="intent"
              value="start"
              disabled={freeTimerActive}
            >
              <Play size={17} />
              Начать цикл
            </button>
          </div>
        </form>
      </section>
    );
  }

  return (
    <section className={`panel pomodoro-active phase-${pomodoro.phase}`}>
      <div className="pomodoro-session-meta">
        <div>
          <span className="pomodoro-phase">
            <i />
            {phaseLabel}
          </span>
          <h2>{pomodoro.title}</h2>
        </div>
        <span>
          Завершено фокус-сессий: <strong>{pomodoro.cycle}</strong>
        </span>
      </div>

      <div
        className="pomodoro-ring"
        style={{ "--progress": `${progress * 3.6}deg` } as React.CSSProperties}
      >
        <div>
          <span>{phaseLabel}</span>
          <strong>{formatCountdown(remaining)}</strong>
          <small>{pomodoro.running ? "идёт отсчёт" : "на паузе"}</small>
        </div>
      </div>

      <div className="pomodoro-controls">
        {pomodoro.running ? (
          <button
            className="primary-button"
            onClick={() =>
              onMutate("pausePomodoro", {}, "Помодоро поставлен на паузу")
            }
          >
            <Pause size={17} />
            Пауза
          </button>
        ) : (
          <button
            className="primary-button"
            onClick={() =>
              onMutate(
                "resumePomodoro",
                {},
                pomodoro.phase === "focus"
                  ? "Фокус продолжен"
                  : "Перерыв запущен",
              )
            }
          >
            <Play size={17} />
            {pomodoro.phase === "focus" ? "Продолжить" : "Начать перерыв"}
          </button>
        )}
        <button
          className="secondary-button"
          onClick={() =>
            onMutate(
              "advancePomodoro",
              {
                completed: false,
                expectedEndsAt: pomodoro.endsAt ?? undefined,
              },
              "Переходим к следующему интервалу",
            )
          }
        >
          {nextLabel}
          <ChevronRight size={17} />
        </button>
        <button
          className="icon-button pomodoro-reset"
          onClick={() => {
            if (window.confirm("Завершить текущий цикл Помодоро?")) {
              onMutate("resetPomodoro", {}, "Цикл Помодоро завершён");
            }
          }}
          aria-label="Завершить цикл Помодоро"
          title="Завершить цикл"
        >
          <RotateCcw size={17} />
        </button>
      </div>
    </section>
  );
}

function Notes({
  data,
  onCreate,
  onMutate,
}: {
  data: AppData;
  onCreate: (editor: EditorState) => void;
  onMutate: (
    action: string,
    payload: Record<string, unknown>,
    success?: string,
  ) => Promise<boolean>;
}) {
  const [query, setQuery] = useState("");
  const filtered = data.notes.filter((note) => {
    const haystack =
      `${note.title} ${notePlainText(note.content)} ${note.tags.join(" ")}`.toLowerCase();
    return haystack.includes(query.toLowerCase());
  });

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Память"
        title="Заметки"
        subtitle="Сохраняй идеи, решения и всё, что не стоит держать в голове."
        action={
          <PrimaryButton onClick={() => onCreate({ kind: "note" })}>
            Новая заметка
          </PrimaryButton>
        }
      />

      <label className="search-box">
        <Search size={17} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Поиск по заметкам и тегам"
        />
      </label>

      {filtered.length ? (
        <div className="notes-grid">
          {filtered.map((note) => (
            <article
              className="note-card"
              key={note.id}
              style={{ "--note-color": note.color } as React.CSSProperties}
              onClick={() => onCreate({ kind: "note", item: note })}
            >
              <header>
                <h2>{note.title}</h2>
                <div>
                  <button
                    className={note.pinned ? "icon-button pinned" : "icon-button"}
                    onClick={(event) => {
                      event.stopPropagation();
                      onMutate(
                        "toggleNotePin",
                        { id: note.id, pinned: !note.pinned },
                        note.pinned ? "Заметка откреплена" : "Заметка закреплена",
                      );
                    }}
                    aria-label="Закрепить заметку"
                  >
                    <Pin size={15} />
                  </button>
                  <button
                    className="icon-button danger"
                    onClick={(event) => {
                      event.stopPropagation();
                      if (window.confirm(`Удалить заметку «${note.title}»?`)) {
                        onMutate(
                          "deleteNote",
                          { id: note.id },
                          "Заметка перемещена в корзину",
                        );
                      }
                    }}
                    aria-label="Удалить заметку"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </header>
              <p>{notePlainText(note.content) || "Пустая заметка"}</p>
              {note.tags.length > 0 && (
                <footer>
                  {note.tags.map((tag) => (
                    <span key={tag}>#{tag}</span>
                  ))}
                </footer>
              )}
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<StickyNote size={30} />}
          title={query ? "Ничего не найдено" : "Заметок пока нет"}
          text={
            query
              ? "Попробуй изменить поисковый запрос."
              : "Создай первую заметку — она сохранится автоматически."
          }
        />
      )}
    </div>
  );
}

function Goals({
  data,
  onCreate,
  onMutate,
}: {
  data: AppData;
  onCreate: (editor: EditorState) => void;
  onMutate: (
    action: string,
    payload: Record<string, unknown>,
    success?: string,
  ) => Promise<boolean>;
}) {
  const [filter, setFilter] = useState<"all" | "active" | "completed">("all");
  const filtered = data.goals.filter((goal) =>
    filter === "all" ? true : goal.status === filter,
  );

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Направление"
        title="Цели"
        subtitle="Формулируй результат, измеряй движение и отмечай завершение."
        action={
          <PrimaryButton onClick={() => onCreate({ kind: "goal" })}>
            Новая цель
          </PrimaryButton>
        }
      />

      <div className="segmented goal-filter">
        {[
          ["all", "Все"],
          ["active", "В работе"],
          ["completed", "Завершённые"],
        ].map(([id, label]) => (
          <button
            key={id}
            className={filter === id ? "active" : ""}
            onClick={() => setFilter(id as typeof filter)}
          >
            {label}
          </button>
        ))}
      </div>

      {filtered.length ? (
        <div className="goals-grid">
          {filtered.map((goal) => {
            const progress = goal.targetValue
              ? Math.min(100, Math.round((goal.currentValue / goal.targetValue) * 100))
              : goal.status === "completed"
                ? 100
                : 0;
            return (
              <article
                className={goal.status === "completed" ? "goal-card goal-complete" : "goal-card"}
                key={goal.id}
                style={{ "--goal-color": goal.color } as React.CSSProperties}
              >
                <header>
                  <div className="goal-icon">
                    {goal.status === "completed" ? <Check size={18} /> : <Flag size={18} />}
                  </div>
                  <div>
                    <span>{goal.category}</span>
                    <h2>{goal.title}</h2>
                  </div>
                  <button
                    className="icon-button"
                    onClick={() => onCreate({ kind: "goal", item: goal })}
                    aria-label="Редактировать цель"
                  >
                    <Edit3 size={15} />
                  </button>
                </header>
                {goal.description && <p>{goal.description}</p>}
                {goal.targetValue !== null && (
                  <>
                    <div className="goal-values">
                      <span>
                        {goal.currentValue} / {goal.targetValue} {goal.unit}
                      </span>
                      <strong>{progress}%</strong>
                    </div>
                    <div className="goal-progress">
                      <span style={{ width: `${progress}%` }} />
                    </div>
                    <div className="goal-controls">
                      <button
                        onClick={() =>
                          onMutate(
                            "changeGoalProgress",
                            { id: goal.id, delta: -1 },
                            "Прогресс обновлён",
                          )
                        }
                      >
                        −
                      </button>
                      <button
                        onClick={() =>
                          onMutate(
                            "changeGoalProgress",
                            { id: goal.id, delta: 1 },
                            "Прогресс обновлён",
                          )
                        }
                      >
                        +
                      </button>
                    </div>
                  </>
                )}
                <footer>
                  {goal.deadline ? (
                    <span>
                      <Calendar size={13} />
                      до {formatDate(`${goal.deadline}T00:00:00`, {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      })}
                    </span>
                  ) : (
                    <span>Без дедлайна</span>
                  )}
                  <button
                    className="icon-button danger"
                    onClick={() => {
                      if (window.confirm(`Удалить цель «${goal.title}»?`)) {
                        onMutate(
                          "deleteGoal",
                          { id: goal.id },
                          "Цель перемещена в корзину",
                        );
                      }
                    }}
                    aria-label="Удалить цель"
                  >
                    <Trash2 size={15} />
                  </button>
                </footer>
              </article>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={<Flag size={30} />}
          title="Целей в этом разделе нет"
          text="Создай цель с измеримым результатом и сроком."
        />
      )}
    </div>
  );
}

function QuickCaptureModal({
  busy,
  onClose,
  onMutate,
}: {
  busy: boolean;
  onClose: () => void;
  onMutate: (
    action: string,
    payload: Record<string, unknown>,
    success?: string,
  ) => Promise<boolean>;
}) {
  const [kind, setKind] = useState<"task" | "note" | "project" | "habit">(
    "task",
  );
  const [title, setTitle] = useState("");

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [busy, onClose]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    const configurations = {
      task: {
        action: "createTask",
        success: "Задача добавлена во входящие",
        payload: {
          title: trimmed,
          status: "todo",
          priority: "medium",
          inbox: true,
          recurrence: "none",
          tags: [],
        },
      },
      note: {
        action: "createNote",
        success: "Заметка создана",
        payload: {
          title: trimmed,
          content: "",
          color: "#fef3c7",
          tags: [],
          pinned: false,
        },
      },
      project: {
        action: "createProject",
        success: "Проект создан",
        payload: {
          title: trimmed,
          color: "#7c3aed",
        },
      },
      habit: {
        action: "createHabit",
        success: "Привычка создана",
        payload: {
          title: trimmed,
          color: "#6366f1",
          icon: "star",
          frequency: "daily",
          targetPerDay: 1,
          order: 0,
        },
      },
    } as const;
    const configuration = configurations[kind];
    const saved = await onMutate(
      configuration.action,
      configuration.payload,
      configuration.success,
    );
    if (saved) onClose();
  }

  return (
    <div className="modal-backdrop quick-backdrop" onMouseDown={onClose}>
      <div
        className="modal modal-quick"
        role="dialog"
        aria-modal="true"
        aria-label="Быстро добавить"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span className="eyebrow">Быстрый ввод</span>
            <h2>Добавить без лишних полей</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Закрыть">
            <X size={18} />
          </button>
        </header>
        <form onSubmit={submit} className="quick-capture-form">
          <div className="quick-kind-switch">
            {[
              ["task", "Задача"],
              ["note", "Заметка"],
              ["project", "Проект"],
              ["habit", "Привычка"],
            ].map(([id, label]) => (
              <button
                type="button"
                key={id}
                className={kind === id ? "active" : ""}
                onClick={() => setKind(id as typeof kind)}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="quick-title-field">
            {kind === "task" ? <Inbox size={19} /> : <Plus size={19} />}
            <input
              autoFocus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={
                kind === "task"
                  ? "Что нужно не забыть?"
                  : `Название: ${kind === "note" ? "идеи" : kind === "project" ? "проекта" : "привычки"}`
              }
            />
          </label>
          <div className="quick-capture-hint">
            <span>
              {kind === "task"
                ? "Задача попадёт во «Входящие» — детали можно добавить позже."
                : "После создания запись можно открыть и дополнить."}
            </span>
            <button
              type="submit"
              className="primary-button"
              disabled={busy || !title.trim()}
            >
              <Plus size={16} />
              {busy ? "Добавляю…" : "Добавить"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function GlobalSearchModal({
  data,
  onClose,
  onNavigate,
  onOpenEditor,
}: {
  data: AppData;
  onClose: () => void;
  onNavigate: (view: View) => void;
  onOpenEditor: (editor: EditorState) => void;
}) {
  const [query, setQuery] = useState("");
  const normalized = query.trim().toLocaleLowerCase("ru-RU");
  const results = useMemo(() => {
    if (!normalized) return [];
    const includes = (...values: Array<string | null | undefined>) =>
      values.join(" ").toLocaleLowerCase("ru-RU").includes(normalized);
    return [
      ...data.tasks
        .filter((item) =>
          includes(item.title, item.description, item.tags.join(" ")),
        )
        .map((item) => ({
          key: `task-${item.id}`,
          kind: "task" as const,
          title: item.title,
          detail: item.dueDate
            ? `Задача · ${formatDate(`${item.dueDate}T00:00:00`)}`
            : "Задача",
          item,
        })),
      ...data.notes
        .filter((item) =>
          includes(item.title, notePlainText(item.content), item.tags.join(" ")),
        )
        .map((item) => ({
          key: `note-${item.id}`,
          kind: "note" as const,
          title: item.title,
          detail: "Заметка",
          item,
        })),
      ...data.projects
        .filter((item) => includes(item.title, item.description))
        .map((item) => ({
          key: `project-${item.id}`,
          kind: "project" as const,
          title: item.title,
          detail: "Проект",
          item,
        })),
      ...data.habits
        .filter((item) => includes(item.title, item.description))
        .map((item) => ({
          key: `habit-${item.id}`,
          kind: "habit" as const,
          title: item.title,
          detail: "Привычка",
          item,
        })),
      ...data.goals
        .filter((item) => includes(item.title, item.description, item.category))
        .map((item) => ({
          key: `goal-${item.id}`,
          kind: "goal" as const,
          title: item.title,
          detail: "Цель",
          item,
        })),
    ].slice(0, 16);
  }, [data, normalized]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  function openResult(result: (typeof results)[number]) {
    if (result.kind === "task") {
      onOpenEditor({ kind: "task", item: result.item as Task });
    } else if (result.kind === "note") {
      onOpenEditor({ kind: "note", item: result.item as Note });
    } else if (result.kind === "goal") {
      onOpenEditor({ kind: "goal", item: result.item as Goal });
    } else if (result.kind === "project") {
      onNavigate("projects");
    } else {
      onNavigate("habits");
    }
  }

  return (
    <div className="modal-backdrop search-backdrop" onMouseDown={onClose}>
      <div
        className="global-search"
        role="dialog"
        aria-modal="true"
        aria-label="Поиск по FlowTrack"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <label>
          <Search size={21} />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Найти задачу, заметку, проект, привычку или цель…"
          />
          <kbd>Esc</kbd>
        </label>
        <div className="global-search-results">
          {!normalized ? (
            <div className="search-empty">
              <Search size={24} />
              <span>Начни вводить название или текст</span>
            </div>
          ) : results.length ? (
            results.map((result) => (
              <button key={result.key} onClick={() => openResult(result)}>
                <span className={`search-result-icon result-${result.kind}`}>
                  {result.kind === "task" ? (
                    <CheckCircle2 size={17} />
                  ) : result.kind === "note" ? (
                    <StickyNote size={17} />
                  ) : result.kind === "project" ? (
                    <FolderKanban size={17} />
                  ) : result.kind === "habit" ? (
                    <Target size={17} />
                  ) : (
                    <Flag size={17} />
                  )}
                </span>
                <span>
                  <strong>{result.title}</strong>
                  <small>{result.detail}</small>
                </span>
                <ChevronRight size={16} />
              </button>
            ))
          ) : (
            <div className="search-empty">
              <Search size={24} />
              <span>Ничего не найдено</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DataCenterModal({
  data,
  busy,
  onClose,
  onRestore,
  onMutate,
}: {
  data: AppData;
  busy: boolean;
  onClose: () => void;
  onRestore: (backup: FlowTrackBackup) => Promise<boolean>;
  onMutate: (
    action: string,
    payload: Record<string, unknown>,
    success?: string,
  ) => Promise<boolean>;
}) {
  const [selectedBackup, setSelectedBackup] =
    useState<FlowTrackBackup | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<FlowTrackPlan | null>(null);
  const [planPreview, setPlanPreview] = useState<PlanPreview | null>(null);
  const [fileName, setFileName] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy && !exporting && !checking) onClose();
    }

    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [busy, checking, exporting, onClose]);

  async function fetchFullData() {
    const response = await fetchDataRequest("/api/data?backup=1", {
      cache: "no-store",
    });
    if (redirectIfUnauthorized(response)) {
      throw new Error("Сессия завершена");
    }
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Не удалось подготовить резервную копию");
    }
    return payload as AppData;
  }

  async function handleExport() {
    setExporting(true);
    setLocalError(null);
    try {
      downloadBackup(await fetchFullData());
    } catch (exportError) {
      setLocalError(
        exportError instanceof Error
          ? exportError.message
          : "Не удалось экспортировать данные",
      );
    } finally {
      setExporting(false);
    }
  }

  function handleContextExport() {
    downloadContext(data);
  }

  function handleTemplateExport() {
    downloadJson(
      {
        format: "flowtrack-plan",
        schemaVersion: 1,
        title: "Мой новый план",
        data: {
          projects: [
            {
              ref: "main-project",
              title: "Название проекта",
              description: "Желаемый результат",
              color: "#7c3aed",
            },
          ],
          tasks: [
            {
              ref: "first-task",
              title: "Первый конкретный шаг",
              projectRef: "main-project",
              status: "todo",
              priority: "high",
              dueDate: null,
              estimatedMinutes: 30,
              recurrence: "none",
              tags: ["старт"],
            },
          ],
          habits: [],
          notes: [],
          goals: [],
        },
      },
      "flowtrack-plan-template.json",
    );
  }

  async function handleFile(file?: File) {
    setSelectedBackup(null);
    setSelectedPlan(null);
    setPlanPreview(null);
    setFileName("");
    setLocalError(null);
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) {
      setLocalError("Файл слишком большой. Максимальный размер — 15 МБ");
      return;
    }
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      if (
        parsed &&
        typeof parsed === "object" &&
        !Array.isArray(parsed) &&
        (parsed as Record<string, unknown>).format === "flowtrack-plan"
      ) {
        const plan = parsePlan(parsed);
        setChecking(true);
        const response = await fetchDataRequest("/api/data", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "previewPlan",
            payload: { plan },
          }),
        });
        if (redirectIfUnauthorized(response)) {
          throw new Error("Сессия завершена");
        }
        const result = await response.json();
        if (!response.ok) {
          throw new Error(result.error || "Не удалось проверить план");
        }
        setSelectedPlan(plan);
        setPlanPreview(result.preview as PlanPreview);
      } else {
        setSelectedBackup(parseBackup(parsed));
      }
      setFileName(file.name);
    } catch (fileError) {
      setLocalError(
        fileError instanceof Error
          ? fileError.message
          : "Не удалось прочитать файл",
      );
    } finally {
      setChecking(false);
    }
  }

  async function handleRestore() {
    if (!selectedBackup) return;
    const confirmed = window.confirm(
      "Импорт полностью заменит текущие данные. Перед заменой FlowTrack автоматически скачает резервную копию. Продолжить?",
    );
    if (!confirmed) return;

    setExporting(true);
    setLocalError(null);
    try {
      const current = await fetchFullData();
      downloadBackup(current, "before-import");
      const restored = await onRestore(selectedBackup);
      if (restored) onClose();
    } catch (restoreError) {
      setLocalError(
        restoreError instanceof Error
          ? restoreError.message
          : "Не удалось восстановить данные",
      );
    } finally {
      setExporting(false);
    }
  }

  async function handlePlanImport() {
    if (!selectedPlan) return;
    const confirmed = window.confirm(
      "План будет добавлен к текущим данным. Совпадающие записи FlowTrack пропустит. Перед импортом будет скачана резервная копия. Продолжить?",
    );
    if (!confirmed) return;
    setExporting(true);
    setLocalError(null);
    try {
      downloadBackup(await fetchFullData(), "before-plan-import");
      const imported = await onMutate(
        "importPlan",
        { plan: selectedPlan },
        "План добавлен — импорт можно отменить",
      );
      if (imported) onClose();
    } catch (importError) {
      setLocalError(
        importError instanceof Error
          ? importError.message
          : "Не удалось импортировать план",
      );
    } finally {
      setExporting(false);
    }
  }

  const backupPreview = selectedBackup?.data;
  const totalItems = backupPreview
    ? backupPreview.habits.length +
      backupPreview.tasks.length +
      backupPreview.projects.length +
      (selectedBackup.schemaVersion === 1
        ? backupPreview.cards.length
        : 0) +
      backupPreview.notes.length +
      backupPreview.goals.length +
      backupPreview.timeEntries.length
    : 0;
  const duplicateCount = planPreview
    ? Object.values(planPreview.duplicates).reduce(
        (total, count) => total + count,
        0,
      )
    : 0;
  const entityLabels: Record<TrashItem["entity"], string> = {
    task: "Задача",
    project: "Проект",
    habit: "Привычка",
    note: "Заметка",
    goal: "Цель",
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal modal-data"
        role="dialog"
        aria-modal="true"
        aria-label="Данные и резервные копии"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span className="eyebrow">Безопасность данных</span>
            <h2>Данные и резервные копии</h2>
          </div>
          <button
            className="icon-button"
            onClick={onClose}
            disabled={busy || exporting || checking}
            aria-label="Закрыть"
          >
            <X size={18} />
          </button>
        </header>

        <div className="data-center-body">
          <section className="data-action-card data-context-card">
            <div className="data-action-icon data-context-icon">
              <Target size={21} />
            </div>
            <div>
              <h3>Контекст для ChatGPT</h3>
              <p>
                Экспортирует активные проекты, задачи, привычки и цели. Тексты
                заметок и история времени не включаются.
              </p>
            </div>
            <button
              className="secondary-button"
              onClick={handleContextExport}
              disabled={busy || exporting}
            >
              <Download size={16} />
              Скачать контекст
            </button>
          </section>

          <section className="data-action-card data-export-card">
            <div className="data-action-icon">
              <Download size={21} />
            </div>
            <div>
              <h3>Экспорт JSON</h3>
              <p>
                Полная резервная копия со всеми данными, включая корзину и
                историю времени.
              </p>
            </div>
            <button
              className="primary-button"
              onClick={handleExport}
              disabled={busy || exporting}
            >
              <Download size={16} />
              {exporting ? "Готовлю…" : "Скачать копию"}
            </button>
          </section>

          <section className="data-action-card">
            <div className="data-action-icon data-import-icon">
              <Import size={21} />
            </div>
            <div>
              <h3>Импорт копии или плана</h3>
              <p>
                Резервная копия заменяет данные, а flowtrack-plan безопасно
                добавляет новые записи и поддерживает отмену.
              </p>
            </div>
            <label className="secondary-button data-file-button">
              <Upload size={16} />
              {checking ? "Проверяю…" : "Выбрать JSON"}
              <input
                type="file"
                accept=".json,application/json"
                onChange={(event) => handleFile(event.target.files?.[0])}
              />
            </label>
          </section>

          <button
            className="plan-template-link"
            onClick={handleTemplateExport}
            disabled={busy || exporting}
          >
            <Code2 size={15} />
            Скачать шаблон flowtrack-plan для планирования с ChatGPT
          </button>

          {localError && (
            <div className="data-local-error">
              <X size={16} />
              {localError}
            </div>
          )}

          {backupPreview && selectedBackup && (
            <section className="backup-preview">
              <div className="backup-preview-heading">
                <div>
                  <span>Файл проверен</span>
                  <strong>{fileName}</strong>
                </div>
                <CheckCircle2 size={22} />
              </div>
              <div className="backup-preview-grid">
                <span>
                  <strong>{backupPreview.projects.length}</strong> проектов
                </span>
                <span>
                  <strong>{backupPreview.tasks.length}</strong> задач
                </span>
                <span>
                  <strong>{backupPreview.notes.length}</strong> заметок
                </span>
                <span>
                  <strong>{backupPreview.habits.length}</strong> привычек
                </span>
                <span>
                  <strong>{backupPreview.goals.length}</strong> целей
                </span>
                <span>
                  <strong>{backupPreview.timeEntries.length}</strong> записей времени
                </span>
              </div>
              <p>
                Экспортирован{" "}
                {formatDate(selectedBackup.exportedAt, {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                {" · "}
                {totalItems} основных записей
              </p>
              <button
                className="primary-button restore-button"
                onClick={handleRestore}
                disabled={busy || exporting}
              >
                <RotateCcw size={16} />
                {busy || exporting ? "Восстанавливаю…" : "Восстановить данные"}
              </button>
            </section>
          )}

          {planPreview && selectedPlan && (
            <section className="backup-preview plan-preview">
              <div className="backup-preview-heading">
                <div>
                  <span>План проверен</span>
                  <strong>{planPreview.title || fileName}</strong>
                </div>
                <CheckCircle2 size={22} />
              </div>
              <div className="backup-preview-grid">
                <span>
                  <strong>{planPreview.counts.projects}</strong> проектов
                </span>
                <span>
                  <strong>{planPreview.counts.tasks}</strong> задач
                </span>
                <span>
                  <strong>{planPreview.counts.habits}</strong> привычек
                </span>
                <span>
                  <strong>{planPreview.counts.notes}</strong> заметок
                </span>
                <span>
                  <strong>{planPreview.counts.goals}</strong> целей
                </span>
                <span>
                  <strong>{duplicateCount}</strong> совпадений
                </span>
              </div>
              {(planPreview.sample.tasks.length > 0 ||
                planPreview.sample.projects.length > 0) && (
                <div className="plan-sample">
                  {[
                    ...planPreview.sample.projects,
                    ...planPreview.sample.tasks,
                  ]
                    .slice(0, 6)
                    .map((title) => (
                      <span key={title}>{title}</span>
                    ))}
                </div>
              )}
              <p>
                Совпадения будут пропущены. Текущие записи не изменятся, а весь
                импорт можно отменить одной кнопкой.
              </p>
              <button
                className="primary-button restore-button"
                onClick={handlePlanImport}
                disabled={busy || exporting}
              >
                <Import size={16} />
                {busy || exporting ? "Добавляю…" : "Добавить план"}
              </button>
            </section>
          )}

          <section className="data-management-section">
            <div className="data-section-heading">
              <div>
                <span className="panel-kicker">Восстановление</span>
                <h3>Корзина</h3>
              </div>
              {data.trash.length > 0 && (
                <button
                  className="text-link data-danger-link"
                  disabled={busy}
                  onClick={() => {
                    if (
                      window.confirm(
                        "Очистить корзину без возможности восстановления?",
                      )
                    ) {
                      onMutate(
                        "emptyTrash",
                        {},
                        "Корзина очищена",
                      );
                    }
                  }}
                >
                  Очистить
                </button>
              )}
            </div>
            {data.trash.length ? (
              <div className="data-record-list">
                {data.trash.slice(0, 8).map((item) => (
                  <div key={`${item.entity}-${item.id}`}>
                    <span>
                      <small>{entityLabels[item.entity]}</small>
                      <strong>{item.title}</strong>
                    </span>
                    <button
                      className="secondary-button"
                      disabled={busy}
                      onClick={() =>
                        onMutate(
                          "restoreDeleted",
                          { entity: item.entity, id: item.id },
                          "Запись восстановлена",
                        )
                      }
                    >
                      <RotateCcw size={14} />
                      Вернуть
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="data-section-empty">Корзина пуста.</p>
            )}
          </section>

          {data.imports.length > 0 && (
            <section className="data-management-section">
              <div className="data-section-heading">
                <div>
                  <span className="panel-kicker">История</span>
                  <h3>Последние импорты</h3>
                </div>
              </div>
              <div className="data-record-list">
                {data.imports.slice(0, 5).map((item) => (
                  <div key={item.id}>
                    <span>
                      <small>
                        {formatDate(item.createdAt, {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </small>
                      <strong>{item.title}</strong>
                    </span>
                    <button
                      className="secondary-button"
                      disabled={busy}
                      onClick={() => {
                        if (
                          window.confirm(
                            `Отменить импорт «${item.title}»? Будут удалены только созданные им записи.`,
                          )
                        ) {
                          onMutate(
                            "undoPlanImport",
                            { batchId: item.id },
                            "Импорт отменён",
                          );
                        }
                      }}
                    >
                      <Undo2 size={14} />
                      Отменить
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function NoteEditorModal({
  note,
  ownerKey,
  onClose,
  onSave,
}: {
  note?: Note;
  ownerKey: string;
  onClose: () => void;
  onSave: (
    noteId: number | null,
    fields: NoteDraftFields,
  ) => Promise<Note>;
}) {
  const initialFields = useMemo(() => noteDraftFieldsFrom(note), [note]);
  const [noteId, setNoteId] = useState<number | null>(note?.id ?? null);
  const [title, setTitle] = useState(initialFields.title);
  const [content, setContent] = useState(initialFields.content);
  const [color, setColor] = useState(initialFields.color);
  const [pinned, setPinned] = useState(initialFields.pinned);
  const [tags, setTags] = useState(initialFields.tags);
  const [saveState, setSaveState] = useState<NoteSaveState>("saved");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [draftRestored, setDraftRestored] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [savedFingerprint, setSavedFingerprint] = useState(
    noteDraftFingerprint(initialFields),
  );
  const [fullscreen, setFullscreen] = useState(false);
  const [stats, setStats] = useState<RichTextStats>({
    words: 0,
    characters: 0,
    readingMinutes: 0,
  });
  const titleInputRef = useRef<HTMLInputElement>(null);
  const noteIdRef = useRef(note?.id ?? null);
  const fieldsRef = useRef(initialFields);
  const savedFingerprintRef = useRef(savedFingerprint);
  const failedFingerprintRef = useRef<string | null>(null);
  const dirtyRef = useRef(false);
  const closingRef = useRef(false);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());

  const currentFields = useMemo<NoteDraftFields>(
    () => ({ title, content, color, pinned, tags }),
    [color, content, pinned, tags, title],
  );
  const currentFingerprint = noteDraftFingerprint(currentFields);
  const isDirty = currentFingerprint !== savedFingerprint;

  useEffect(() => {
    fieldsRef.current = currentFields;
    noteIdRef.current = noteId;
    savedFingerprintRef.current = savedFingerprint;
  }, [currentFields, noteId, savedFingerprint]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      const stored = readStoredNoteDraft(ownerKey, note?.id ?? null);
      const serverUpdatedAt = note?.updatedAt
        ? Date.parse(note.updatedAt)
        : Number.NEGATIVE_INFINITY;
      const draftUpdatedAt = stored?.updatedAt
        ? Date.parse(stored.updatedAt)
        : Number.NEGATIVE_INFINITY;
      const shouldRestore =
        stored &&
        noteDraftFingerprint(stored) !== savedFingerprintRef.current &&
        (!note || draftUpdatedAt > serverUpdatedAt);

      if (stored && shouldRestore) {
        setTitle(stored.title);
        setContent(stored.content);
        setColor(stored.color);
        setPinned(stored.pinned);
        setTags(stored.tags);
        setDraftRestored(true);
        setSaveState("dirty");
      } else if (stored) {
        clearStoredNoteDraft(ownerKey, note?.id ?? null);
      }
      setHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, [note, ownerKey]);

  useEffect(() => {
    if (!hydrated) return;
    const isEmptyNewNote =
      noteId === null && !hasMeaningfulNoteContent(currentFields);

    dirtyRef.current = isDirty && !isEmptyNewNote;
    if (!isDirty || isEmptyNewNote) {
      clearStoredNoteDraft(ownerKey, noteId);
      return;
    }

    writeStoredNoteDraft(ownerKey, noteId, currentFields);
  }, [
    currentFields,
    hydrated,
    isDirty,
    noteId,
    ownerKey,
  ]);

  const saveNow = useCallback(() => {
    const operation = saveQueueRef.current.then(async () => {
      const fields = fieldsRef.current;
      const fingerprint = noteDraftFingerprint(fields);
      if (fingerprint === savedFingerprintRef.current) {
        dirtyRef.current = false;
        setSaveState("saved");
        return true;
      }
      if (
        noteIdRef.current === null &&
        !hasMeaningfulNoteContent(fields)
      ) {
        dirtyRef.current = false;
        clearStoredNoteDraft(ownerKey, null);
        setSaveState("saved");
        return true;
      }
      if (!fields.title.trim()) {
        setSaveState("dirty");
        setSaveError("Добавьте название, чтобы сохранить заметку в FlowTrack.");
        titleInputRef.current?.focus();
        return false;
      }
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        failedFingerprintRef.current = fingerprint;
        setSaveState("error");
        setSaveError(
          "Нет соединения. Черновик сохранён на устройстве и будет отправлен после восстановления сети.",
        );
        writeStoredNoteDraft(ownerKey, noteIdRef.current, fields);
        return false;
      }

      setDraftRestored(false);
      setSaveState("saving");
      setSaveError(null);
      failedFingerprintRef.current = null;
      const previousNoteId = noteIdRef.current;

      try {
        const savedNote = await onSave(previousNoteId, fields);
        noteIdRef.current = savedNote.id;
        setNoteId(savedNote.id);
        savedFingerprintRef.current = fingerprint;
        setSavedFingerprint(fingerprint);
        clearStoredNoteDraft(ownerKey, previousNoteId);
        clearStoredNoteDraft(ownerKey, savedNote.id);

        const latestFields = fieldsRef.current;
        const latestFingerprint = noteDraftFingerprint(latestFields);
        const hasNewChanges = latestFingerprint !== fingerprint;
        dirtyRef.current = hasNewChanges;
        if (hasNewChanges) {
          writeStoredNoteDraft(ownerKey, savedNote.id, latestFields);
          setSaveState("dirty");
        } else {
          setSaveState("saved");
        }
        return true;
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Не удалось сохранить заметку";
        failedFingerprintRef.current = fingerprint;
        dirtyRef.current = true;
        writeStoredNoteDraft(ownerKey, noteIdRef.current, fields);
        setSaveState("error");
        setSaveError(message);
        return false;
      }
    });

    saveQueueRef.current = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }, [onSave, ownerKey]);

  useEffect(() => {
    if (
      !hydrated ||
      currentFingerprint === savedFingerprint ||
      !hasMeaningfulNoteContent(currentFields) ||
      !title.trim()
    ) {
      return;
    }
    const timeout = window.setTimeout(() => {
      void saveNow();
    }, 1200);
    return () => window.clearTimeout(timeout);
  }, [
    currentFields,
    currentFingerprint,
    hydrated,
    saveNow,
    savedFingerprint,
    title,
  ]);

  useEffect(() => {
    function handleOnline() {
      if (dirtyRef.current) void saveNow();
    }

    function handleBeforeUnload(event: BeforeUnloadEvent) {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("online", handleOnline);
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [saveNow]);

  const requestClose = useCallback(async () => {
    if (closingRef.current) return;
    closingRef.current = true;
    const fields = fieldsRef.current;
    const isEmptyNewNote =
      noteIdRef.current === null && !hasMeaningfulNoteContent(fields);

    if (isEmptyNewNote) {
      clearStoredNoteDraft(ownerKey, null);
      onClose();
      return;
    }

    if (
      noteDraftFingerprint(fields) !== savedFingerprintRef.current
    ) {
      await saveNow();
    }

    const stillDirty =
      noteDraftFingerprint(fieldsRef.current) !==
      savedFingerprintRef.current;
    if (
      stillDirty &&
      !window.confirm(
        "Изменения ещё не отправлены в FlowTrack, но черновик сохранён на этом устройстве. Всё равно закрыть?",
      )
    ) {
      closingRef.current = false;
      return;
    }
    onClose();
  }, [onClose, ownerKey, saveNow]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "s"
      ) {
        event.preventDefault();
        void saveNow();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        if (fullscreen) setFullscreen(false);
        else void requestClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [fullscreen, requestClose, saveNow]);

  function markEdited() {
    failedFingerprintRef.current = null;
    setSaveError(null);
    setDraftRestored(false);
    setSaveState((current) =>
      current === "saving" ? current : "dirty",
    );
  }

  const visibleSaveState: NoteSaveState = isDirty
    ? saveState === "saving" || saveState === "error"
      ? saveState
      : "dirty"
    : "saved";
  const needsTitle = visibleSaveState === "dirty" && !title.trim();
  const saveStatusLabel = needsTitle
    ? "На устройстве · добавьте название"
    : visibleSaveState === "saving"
      ? "Сохраняю…"
      : visibleSaveState === "error"
        ? "Ошибка сохранения"
        : visibleSaveState === "dirty"
          ? draftRestored
            ? "Черновик восстановлен"
            : "Есть изменения"
          : "Сохранено";

  return (
    <div
      className={
        fullscreen
          ? "modal-backdrop modal-backdrop-note-fullscreen"
          : "modal-backdrop"
      }
      onMouseDown={() => void requestClose()}
    >
      <div
        className={
          fullscreen
            ? "modal modal-note modal-note-fullscreen"
            : "modal modal-note"
        }
        role="dialog"
        aria-modal="true"
        aria-label={note ? "Редактировать заметку" : "Новая заметка"}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="note-modal-header">
          <div>
            <span className="eyebrow">FlowTrack</span>
            <h2>{note ? "Редактировать заметку" : "Новая заметка"}</h2>
          </div>
          <div className="note-modal-header-actions">
            <div
              className={`note-save-status note-save-status-${visibleSaveState}`}
              role="status"
              aria-live="polite"
              title={saveError ?? undefined}
            >
              {visibleSaveState === "saved" ? (
                <Check size={14} />
              ) : visibleSaveState === "error" ? (
                <CloudOff size={14} />
              ) : visibleSaveState === "saving" ? (
                <RotateCcw className="note-save-spinner" size={14} />
              ) : (
                <Circle size={10} fill="currentColor" />
              )}
              <span>{saveStatusLabel}</span>
            </div>
            <button
              className="icon-button"
              type="button"
              onClick={() => setFullscreen((current) => !current)}
              aria-label={
                fullscreen
                  ? "Выйти из полноэкранного режима"
                  : "Открыть на весь экран"
              }
              title={
                fullscreen
                  ? "Выйти из полноэкранного режима"
                  : "На весь экран"
              }
            >
              {fullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
            </button>
            <button
              className="icon-button"
              type="button"
              onClick={() => void requestClose()}
              aria-label="Закрыть"
            >
              <X size={18} />
            </button>
          </div>
        </header>

        <form
          className="note-editor-form"
          onSubmit={(event) => {
            event.preventDefault();
            void saveNow();
          }}
        >
          <Field label="Название">
            <input
              ref={titleInputRef}
              name="title"
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                markEdited();
              }}
              autoFocus
              placeholder="Короткое понятное название"
            />
          </Field>

          <div className="field note-content-field">
            <span>Содержание</span>
            <Suspense
              fallback={
                <div
                  className="rich-editor rich-editor-loading"
                  role="status"
                >
                  <input
                    type="hidden"
                    name="content"
                    value={content}
                    readOnly
                  />
                  <span>Загружаем редактор…</span>
                </div>
              }
            >
              <RichTextEditor
                name="content"
                value={content}
                onChange={(nextContent) => {
                  setContent(nextContent);
                  markEdited();
                }}
                onStatsChange={setStats}
              />
            </Suspense>
          </div>

          <Field label="Теги через запятую">
            <input
              name="tags"
              value={tags}
              onChange={(event) => {
                setTags(event.target.value);
                markEdited();
              }}
            />
          </Field>

          <div className="form-grid form-grid-note">
            <Field label="Цвет">
              <input
                className="color-input"
                name="color"
                type="color"
                value={color}
                onChange={(event) => {
                  setColor(event.target.value);
                  markEdited();
                }}
              />
            </Field>
            <label className="check-field">
              <input
                name="pinned"
                type="checkbox"
                checked={pinned}
                onChange={(event) => {
                  setPinned(event.target.checked);
                  markEdited();
                }}
              />
              <span>
                <Pin size={15} />
                Закрепить заметку
              </span>
            </label>
          </div>

          <footer className="modal-actions note-modal-actions">
            <span className="note-writing-stats">{noteStatsLabel(stats)}</span>
            <div>
              {visibleSaveState === "error" && (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => void saveNow()}
                >
                  Повторить
                </button>
              )}
              <span className="note-save-shortcut">Ctrl/⌘ + S</span>
              <button
                type="button"
                className="primary-button"
                onClick={() => void requestClose()}
              >
                Готово
              </button>
            </div>
          </footer>
        </form>
      </div>
    </div>
  );
}

function EditorModal({
  editor,
  data,
  busy,
  onClose,
  onMutate,
}: {
  editor: EditorState;
  data: AppData;
  busy: boolean;
  onClose: () => void;
  onMutate: (
    action: string,
    payload: Record<string, unknown>,
    success?: string,
  ) => Promise<void>;
}) {
  const titles: Record<EditorKind, string> = {
    habit: editor.item ? "Редактировать привычку" : "Новая привычка",
    task: editor.item ? "Редактировать задачу" : "Новая задача",
    project: "Новый проект",
    column: "Новая колонка",
    card: editor.item ? "Редактировать карточку" : "Новая карточка",
    timer: "Новая фокус-сессия",
    note: editor.item ? "Редактировать заметку" : "Новая заметка",
    goal: editor.item ? "Редактировать цель" : "Новая цель",
  };

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }

    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [busy, onClose]);

  function value(form: FormData, key: string) {
    return String(form.get(key) ?? "");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    if (editor.kind === "habit") {
      const item = editor.item as Habit | undefined;
      await onMutate(
        item ? "updateHabit" : "createHabit",
        {
          id: item?.id,
          title: value(form, "title"),
          description: value(form, "description"),
          color: value(form, "color"),
          icon: value(form, "icon"),
          frequency: value(form, "frequency"),
          targetPerDay: value(form, "targetPerDay"),
          order: data.habits.length,
        },
        item ? "Привычка обновлена" : "Привычка создана",
      );
    }

    if (editor.kind === "task") {
      const item = editor.item as Task | undefined;
      await onMutate(
        item ? "updateTask" : "createTask",
        {
          id: item?.id,
          title: value(form, "title"),
          description: value(form, "description"),
          status: value(form, "status"),
          priority: value(form, "priority"),
          dueDate: value(form, "dueDate"),
          dueTime: value(form, "dueTime"),
          estimatedMinutes: value(form, "estimatedMinutes"),
          projectId: value(form, "projectId"),
          inbox: form.get("inbox") === "on",
          recurrence: value(form, "recurrence"),
          tags: value(form, "tags"),
        },
        item ? "Задача обновлена" : "Задача создана",
      );
    }

    if (editor.kind === "project") {
      await onMutate(
        "createProject",
        {
          title: value(form, "title"),
          description: value(form, "description"),
          color: value(form, "color"),
        },
        "Проект создан",
      );
    }

    if (editor.kind === "column") {
      await onMutate(
        "createColumn",
        {
          projectId: editor.contextId,
          title: value(form, "title"),
          color: value(form, "color"),
        },
        "Колонка создана",
      );
    }

    if (editor.kind === "card") {
      const item = editor.item as Card | undefined;
      const defaultColumnId = item?.columnId ?? editor.contextId;
      await onMutate(
        item ? "updateCard" : "createCard",
        {
          id: item?.id,
          columnId: value(form, "columnId") || defaultColumnId,
          title: value(form, "title"),
          description: value(form, "description"),
          priority: value(form, "priority"),
          dueDate: value(form, "dueDate"),
          tags: value(form, "tags"),
        },
        item ? "Карточка обновлена" : "Карточка создана",
      );
    }

    if (editor.kind === "timer") {
      await onMutate(
        "startTimer",
        {
          title: value(form, "title"),
          description: value(form, "description"),
          projectId: value(form, "projectId"),
          taskId: value(form, "taskId"),
        },
        "Таймер запущен",
      );
    }

    if (editor.kind === "goal") {
      const item = editor.item as Goal | undefined;
      await onMutate(
        item ? "updateGoal" : "createGoal",
        {
          id: item?.id,
          title: value(form, "title"),
          description: value(form, "description"),
          category: value(form, "category"),
          targetValue: value(form, "targetValue"),
          currentValue: value(form, "currentValue"),
          unit: value(form, "unit"),
          deadline: value(form, "deadline"),
          color: value(form, "color"),
        },
        item ? "Цель обновлена" : "Цель создана",
      );
    }
  }

  const habit = editor.kind === "habit" ? (editor.item as Habit | undefined) : undefined;
  const task = editor.kind === "task" ? (editor.item as Task | undefined) : undefined;
  const card = editor.kind === "card" ? (editor.item as Card | undefined) : undefined;
  const goal = editor.kind === "goal" ? (editor.item as Goal | undefined) : undefined;
  const cardColumns =
    editor.kind === "card" && card
      ? data.columns.filter((column) =>
          data.columns
            .filter(
              (candidate) =>
                candidate.projectId ===
                data.columns.find((source) => source.id === card.columnId)?.projectId,
            )
            .some((candidate) => candidate.id === column.id),
        )
      : data.columns;

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className={editor.kind === "note" ? "modal modal-note" : "modal"}
        role="dialog"
        aria-modal="true"
        aria-label={titles[editor.kind]}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span className="eyebrow">FlowTrack</span>
            <h2>{titles[editor.kind]}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Закрыть">
            <X size={18} />
          </button>
        </header>

        <form onSubmit={submit}>
          {(editor.kind === "habit" ||
            editor.kind === "task" ||
            editor.kind === "project" ||
            editor.kind === "column" ||
            editor.kind === "card" ||
            editor.kind === "timer" ||
            editor.kind === "goal") && (
            <Field label="Название">
              <input
                name="title"
                required
                autoFocus
                defaultValue={
                  habit?.title ||
                  task?.title ||
                  card?.title ||
                  goal?.title ||
                  ""
                }
                placeholder={
                  editor.kind === "timer"
                    ? "Например, корейский язык"
                    : "Короткое понятное название"
                }
              />
            </Field>
          )}

          {(editor.kind === "habit" ||
            editor.kind === "task" ||
            editor.kind === "project" ||
            editor.kind === "card" ||
            editor.kind === "timer" ||
            editor.kind === "goal") && (
            <Field label="Описание">
              <textarea
                name="description"
                rows={3}
                defaultValue={
                  habit?.description ||
                  task?.description ||
                  card?.description ||
                  goal?.description ||
                  ""
                }
                placeholder="Необязательно"
              />
            </Field>
          )}

          {editor.kind === "habit" && (
            <>
              <div className="form-grid">
                <Field label="Периодичность">
                  <select name="frequency" defaultValue={habit?.frequency ?? "daily"}>
                    <option value="daily">Каждый день</option>
                    <option value="weekdays">По будням</option>
                    <option value="weekly">Раз в неделю</option>
                  </select>
                </Field>
                <Field label="Цель в день">
                  <input
                    name="targetPerDay"
                    type="number"
                    min="1"
                    max="99"
                    defaultValue={habit?.targetPerDay ?? 1}
                  />
                </Field>
              </div>
              <div className="form-grid">
                <Field label="Иконка">
                  <select name="icon" defaultValue={habit?.icon ?? "star"}>
                    <option value="star">✨ Универсальная</option>
                    <option value="water">💧 Вода</option>
                    <option value="book">📖 Учёба</option>
                    <option value="sport">💪 Спорт</option>
                    <option value="sleep">🌙 Сон</option>
                  </select>
                </Field>
                <ColorField defaultValue={habit?.color ?? "#6366f1"} />
              </div>
            </>
          )}

          {editor.kind === "task" && (
            <>
              <div className="form-grid">
                <Field label="Дата">
                  <input
                    name="dueDate"
                    type="date"
                    defaultValue={task?.dueDate ?? editor.defaults?.dueDate ?? ""}
                  />
                </Field>
                <Field label="Время">
                  <input name="dueTime" type="time" defaultValue={task?.dueTime ?? ""} />
                </Field>
              </div>
              <div className="form-grid">
                <Field label="Статус">
                  <select name="status" defaultValue={task?.status ?? "todo"}>
                    <option value="todo">Нужно сделать</option>
                    <option value="doing">В работе</option>
                    <option value="done">Готово</option>
                  </select>
                </Field>
                <Field label="Приоритет">
                  <select name="priority" defaultValue={task?.priority ?? "medium"}>
                    <option value="low">Низкий</option>
                    <option value="medium">Средний</option>
                    <option value="high">Высокий</option>
                  </select>
                </Field>
              </div>
              <div className="form-grid">
                <Field label="Проект">
                  <select name="projectId" defaultValue={task?.projectId ?? ""}>
                    <option value="">Без проекта</option>
                    {data.projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.title}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Повтор">
                  <select
                    name="recurrence"
                    defaultValue={task?.recurrence ?? "none"}
                  >
                    <option value="none">Не повторять</option>
                    <option value="daily">Каждый день</option>
                    <option value="weekdays">По будням</option>
                    <option value="weekly">Каждую неделю</option>
                    <option value="monthly">Каждый месяц</option>
                  </select>
                </Field>
              </div>
              <div className="form-grid">
                <Field label="Оценка, минут">
                  <input
                    name="estimatedMinutes"
                    type="number"
                    min="1"
                    defaultValue={task?.estimatedMinutes ?? ""}
                  />
                </Field>
                <label className="check-field">
                  <input
                    name="inbox"
                    type="checkbox"
                    defaultChecked={task?.inbox ?? !task?.projectId}
                  />
                  <span>
                    <Inbox size={15} />
                    Оставить во «Входящих»
                  </span>
                </label>
              </div>
              <Field label="Теги через запятую">
                <input name="tags" defaultValue={task?.tags.join(", ") ?? ""} />
              </Field>
            </>
          )}

          {(editor.kind === "project" || editor.kind === "column") && (
            <ColorField defaultValue="#8b5cf6" />
          )}

          {editor.kind === "card" && (
            <>
              <div className="form-grid">
                <Field label="Колонка">
                  <select
                    name="columnId"
                    defaultValue={card?.columnId ?? editor.contextId ?? ""}
                  >
                    {cardColumns.map((column) => (
                      <option key={column.id} value={column.id}>
                        {column.title}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Приоритет">
                  <select name="priority" defaultValue={card?.priority ?? "medium"}>
                    <option value="low">Низкий</option>
                    <option value="medium">Средний</option>
                    <option value="high">Высокий</option>
                  </select>
                </Field>
              </div>
              <Field label="Дедлайн">
                <input name="dueDate" type="date" defaultValue={card?.dueDate ?? ""} />
              </Field>
              <Field label="Теги через запятую">
                <input name="tags" defaultValue={card?.tags.join(", ") ?? ""} />
              </Field>
              {card && (
                <button
                  type="button"
                  className="delete-wide"
                  onClick={() => {
                    if (window.confirm(`Удалить карточку «${card.title}»?`)) {
                      onMutate(
                        "deleteCard",
                        { id: card.id },
                        "Карточка перемещена в корзину",
                      );
                    }
                  }}
                >
                  <Trash2 size={15} />
                  Удалить карточку
                </button>
              )}
            </>
          )}

          {editor.kind === "timer" && (
            <>
              <div className="form-grid">
                <Field label="Проект">
                  <select name="projectId">
                    <option value="">Без проекта</option>
                    {data.projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.title}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Задача">
                  <select name="taskId">
                    <option value="">Без задачи</option>
                    {data.tasks
                      .filter((taskItem) => taskItem.status !== "done")
                      .map((taskItem) => (
                        <option key={taskItem.id} value={taskItem.id}>
                          {taskItem.title}
                        </option>
                      ))}
                  </select>
                </Field>
              </div>
            </>
          )}

          {editor.kind === "goal" && (
            <>
              <div className="form-grid">
                <Field label="Категория">
                  <select name="category" defaultValue={goal?.category ?? "personal"}>
                    <option value="personal">Личное</option>
                    <option value="education">Образование</option>
                    <option value="career">Карьера</option>
                    <option value="health">Здоровье</option>
                    <option value="finance">Финансы</option>
                    <option value="travel">Путешествия</option>
                  </select>
                </Field>
                <Field label="Дедлайн">
                  <input name="deadline" type="date" defaultValue={goal?.deadline ?? ""} />
                </Field>
              </div>
              <div className="form-grid form-grid-three">
                <Field label="Текущее">
                  <input
                    name="currentValue"
                    type="number"
                    min="0"
                    defaultValue={goal?.currentValue ?? 0}
                  />
                </Field>
                <Field label="Цель">
                  <input
                    name="targetValue"
                    type="number"
                    min="1"
                    defaultValue={goal?.targetValue ?? ""}
                  />
                </Field>
                <Field label="Единица">
                  <input name="unit" defaultValue={goal?.unit ?? ""} placeholder="км" />
                </Field>
              </div>
              <ColorField defaultValue={goal?.color ?? "#10b981"} />
            </>
          )}

          <footer className="modal-actions">
            <button type="button" className="secondary-button" onClick={onClose}>
              Отмена
            </button>
            <button type="submit" className="primary-button" disabled={busy}>
              {busy ? "Сохраняю…" : editor.kind === "timer" ? "Запустить" : "Сохранить"}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function ColorField({ defaultValue }: { defaultValue: string }) {
  return (
    <Field label="Цвет">
      <input
        className="color-input"
        name="color"
        type="color"
        defaultValue={defaultValue}
      />
    </Field>
  );
}
