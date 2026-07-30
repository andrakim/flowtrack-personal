export type UiScale = "compact" | "comfortable" | "large";
export type ThemePreference = "system" | "light" | "dark";
export type AccentColor =
  | "violet"
  | "blue"
  | "emerald"
  | "orange"
  | "graphite";
export type SidebarMode = "expanded" | "compact" | "auto";
export type StartView = "overview" | "last" | "schedule";
export type MotionPreference = "system" | "full" | "reduced";

export type UiPreferences = {
  version: 1;
  theme: ThemePreference;
  accent: AccentColor;
  scale: UiScale;
  sidebar: SidebarMode;
  startView: StartView;
  motion: MotionPreference;
};

export const UI_PREFERENCES_STORAGE_KEY = "flowtrack:ui-preferences:v1";
export const LEGACY_UI_SCALE_STORAGE_KEY = "flowtrack:ui-scale:v1";
export const LAST_VIEW_STORAGE_KEY = "flowtrack:last-view:v1";
const UI_PREFERENCES_EVENT = "flowtrack:ui-preferences-change";

export const DEFAULT_UI_PREFERENCES: UiPreferences = {
  version: 1,
  theme: "system",
  accent: "violet",
  scale: "comfortable",
  sidebar: "auto",
  startView: "overview",
  motion: "system",
};

const UI_SCALES = new Set<UiScale>(["compact", "comfortable", "large"]);
const THEMES = new Set<ThemePreference>(["system", "light", "dark"]);
const ACCENTS = new Set<AccentColor>([
  "violet",
  "blue",
  "emerald",
  "orange",
  "graphite",
]);
const SIDEBAR_MODES = new Set<SidebarMode>(["expanded", "compact", "auto"]);
const START_VIEWS = new Set<StartView>(["overview", "last", "schedule"]);
const MOTION_PREFERENCES = new Set<MotionPreference>([
  "system",
  "full",
  "reduced",
]);

let volatilePreferences = DEFAULT_UI_PREFERENCES;
let initialized = false;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function pickValue<T extends string>(
  value: unknown,
  allowed: Set<T>,
  fallback: T,
): T {
  return typeof value === "string" && allowed.has(value as T)
    ? (value as T)
    : fallback;
}

export function normalizeUiPreferences(value: unknown): UiPreferences {
  const source = isRecord(value) ? value : {};
  return {
    version: 1,
    theme: pickValue(source.theme, THEMES, DEFAULT_UI_PREFERENCES.theme),
    accent: pickValue(source.accent, ACCENTS, DEFAULT_UI_PREFERENCES.accent),
    scale: pickValue(source.scale, UI_SCALES, DEFAULT_UI_PREFERENCES.scale),
    sidebar: pickValue(
      source.sidebar,
      SIDEBAR_MODES,
      DEFAULT_UI_PREFERENCES.sidebar,
    ),
    startView: pickValue(
      source.startView,
      START_VIEWS,
      DEFAULT_UI_PREFERENCES.startView,
    ),
    motion: pickValue(
      source.motion,
      MOTION_PREFERENCES,
      DEFAULT_UI_PREFERENCES.motion,
    ),
  };
}

function preferencesEqual(a: UiPreferences, b: UiPreferences) {
  return (
    a.theme === b.theme &&
    a.accent === b.accent &&
    a.scale === b.scale &&
    a.sidebar === b.sidebar &&
    a.startView === b.startView &&
    a.motion === b.motion
  );
}

function readStoredPreferences(): UiPreferences {
  try {
    const raw = window.localStorage.getItem(UI_PREFERENCES_STORAGE_KEY);
    if (raw) return normalizeUiPreferences(JSON.parse(raw));

    const legacyScale = window.localStorage.getItem(
      LEGACY_UI_SCALE_STORAGE_KEY,
    );
    return normalizeUiPreferences({ scale: legacyScale });
  } catch {
    return volatilePreferences;
  }
}

export function getClientUiPreferencesSnapshot(): UiPreferences {
  const next = readStoredPreferences();
  if (!initialized || !preferencesEqual(next, volatilePreferences)) {
    volatilePreferences = next;
    initialized = true;
  }
  return volatilePreferences;
}

export function getServerUiPreferencesSnapshot(): UiPreferences {
  return DEFAULT_UI_PREFERENCES;
}

export function applyUiPreferencesToDocument(preferences: UiPreferences) {
  const root = document.documentElement;
  root.dataset.flowtrackTheme = preferences.theme;
  root.dataset.flowtrackAccent = preferences.accent;
  root.dataset.flowtrackScale = preferences.scale;
  root.dataset.flowtrackMotion = preferences.motion;
}

export function subscribeToUiPreferences(onStoreChange: () => void) {
  const handleStorage = (event: StorageEvent) => {
    if (
      event.key !== UI_PREFERENCES_STORAGE_KEY &&
      event.key !== LEGACY_UI_SCALE_STORAGE_KEY
    ) {
      return;
    }
    volatilePreferences = readStoredPreferences();
    initialized = true;
    applyUiPreferencesToDocument(volatilePreferences);
    onStoreChange();
  };
  const handlePreferenceChange = () => onStoreChange();

  window.addEventListener("storage", handleStorage);
  window.addEventListener(UI_PREFERENCES_EVENT, handlePreferenceChange);
  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(UI_PREFERENCES_EVENT, handlePreferenceChange);
  };
}

export function storeUiPreferences(patch: Partial<UiPreferences>) {
  const next = normalizeUiPreferences({
    ...getClientUiPreferencesSnapshot(),
    ...patch,
  });
  volatilePreferences = next;
  initialized = true;
  try {
    window.localStorage.setItem(
      UI_PREFERENCES_STORAGE_KEY,
      JSON.stringify(next),
    );
    window.localStorage.removeItem(LEGACY_UI_SCALE_STORAGE_KEY);
  } catch {
    // The preference still applies for the current page if storage is blocked.
  }
  applyUiPreferencesToDocument(next);
  window.dispatchEvent(new Event(UI_PREFERENCES_EVENT));
}

export function resetUiPreferences() {
  volatilePreferences = DEFAULT_UI_PREFERENCES;
  initialized = true;
  try {
    window.localStorage.removeItem(UI_PREFERENCES_STORAGE_KEY);
    window.localStorage.removeItem(LEGACY_UI_SCALE_STORAGE_KEY);
    window.localStorage.removeItem(LAST_VIEW_STORAGE_KEY);
  } catch {
    // Reset the current page even if browser storage is unavailable.
  }
  applyUiPreferencesToDocument(DEFAULT_UI_PREFERENCES);
  window.dispatchEvent(new Event(UI_PREFERENCES_EVENT));
}

export function getStoredLastView<T extends string>(
  allowedViews: readonly T[],
  fallback: T,
): T {
  try {
    const value = window.localStorage.getItem(LAST_VIEW_STORAGE_KEY);
    return value && allowedViews.includes(value as T) ? (value as T) : fallback;
  } catch {
    return fallback;
  }
}

export function storeLastView(view: string) {
  try {
    window.localStorage.setItem(LAST_VIEW_STORAGE_KEY, view);
  } catch {
    // The launch preference remains useful even without last-view persistence.
  }
}

export const UI_PREFERENCES_BOOT_SCRIPT = `
(() => {
  const defaults = {
    theme: "system",
    accent: "violet",
    scale: "comfortable",
    motion: "system"
  };
  try {
    const raw = localStorage.getItem("${UI_PREFERENCES_STORAGE_KEY}");
    const legacyScale = localStorage.getItem("${LEGACY_UI_SCALE_STORAGE_KEY}");
    const stored = raw ? JSON.parse(raw) : { scale: legacyScale };
    const root = document.documentElement;
    root.dataset.flowtrackTheme = ["system", "light", "dark"].includes(stored.theme)
      ? stored.theme
      : defaults.theme;
    root.dataset.flowtrackAccent = ["violet", "blue", "emerald", "orange", "graphite"].includes(stored.accent)
      ? stored.accent
      : defaults.accent;
    root.dataset.flowtrackScale = ["compact", "comfortable", "large"].includes(stored.scale)
      ? stored.scale
      : defaults.scale;
    root.dataset.flowtrackMotion = ["system", "full", "reduced"].includes(stored.motion)
      ? stored.motion
      : defaults.motion;
  } catch {
    const root = document.documentElement;
    root.dataset.flowtrackTheme = defaults.theme;
    root.dataset.flowtrackAccent = defaults.accent;
    root.dataset.flowtrackScale = defaults.scale;
    root.dataset.flowtrackMotion = defaults.motion;
  }
})();
`;
