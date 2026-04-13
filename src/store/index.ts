import { create } from "zustand";
import type {
  LogRecord,
  DeveloperMetrics,
  ClaudeUsage,
  CodexUsage,
  ProxyStatus,
  Preferences,
  UpdateInfo,
} from "../lib/types";

interface AppStore {
  isAuthenticated: boolean;
  cookie: string | null;
  metrics: DeveloperMetrics | null;
  claudeUsage: ClaudeUsage | null;
  claudeUsageError: string | null;
  codexUsage: CodexUsage | null;
  codexUsageError: string | null;
  todayLogs: LogRecord[];
  weekLogs: LogRecord[];
  proxyStatus: ProxyStatus;
  preferences: Preferences;
  updateInfo: UpdateInfo | null;
  appVersion: string;
  launchAtLogin: boolean;
  hideFromDock: boolean;
  loading: boolean;
  error: string | null;

  setAuthenticated: (auth: boolean, cookie?: string | null) => void;
  setMetrics: (metrics: DeveloperMetrics | null) => void;
  setClaudeUsage: (usage: ClaudeUsage | null) => void;
  setClaudeUsageError: (error: string | null) => void;
  setCodexUsage: (usage: CodexUsage | null) => void;
  setCodexUsageError: (error: string | null) => void;
  setTodayLogs: (logs: LogRecord[]) => void;
  setWeekLogs: (logs: LogRecord[]) => void;
  setProxyStatus: (status: ProxyStatus) => void;
  setPreferences: (prefs: Preferences) => void;
  setUpdateInfo: (info: UpdateInfo | null) => void;
  setAppVersion: (version: string) => void;
  setLaunchAtLogin: (enabled: boolean) => void;
  setHideFromDock: (enabled: boolean) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  signOut: () => void;
}

export const useStore = create<AppStore>((set) => ({
  isAuthenticated: false,
  cookie: null,
  metrics: null,
  claudeUsage: null,
  claudeUsageError: null,
  codexUsage: null,
  codexUsageError: null,
  todayLogs: [],
  weekLogs: [],
  proxyStatus: { running: false, enabled: false },
  preferences: { poll_interval: 900000, tray_display: "tokens", tray_source: "claude" },
  updateInfo: null,
  appVersion: "",
  launchAtLogin: false,
  hideFromDock: false,
  loading: false,
  error: null,

  setAuthenticated: (auth, cookie) =>
    set({ isAuthenticated: auth, cookie: cookie ?? null }),
  setMetrics: (metrics) => set({ metrics }),
  setClaudeUsage: (claudeUsage) => set({ claudeUsage }),
  setClaudeUsageError: (claudeUsageError) => set({ claudeUsageError }),
  setCodexUsage: (codexUsage) => set({ codexUsage }),
  setCodexUsageError: (codexUsageError) => set({ codexUsageError }),
  setTodayLogs: (todayLogs) => set({ todayLogs }),
  setWeekLogs: (weekLogs) => set({ weekLogs }),
  setProxyStatus: (proxyStatus) => set({ proxyStatus }),
  setPreferences: (preferences) => set({ preferences }),
  setUpdateInfo: (updateInfo) => set({ updateInfo }),
  setAppVersion: (appVersion) => set({ appVersion }),
  setLaunchAtLogin: (launchAtLogin) => set({ launchAtLogin }),
  setHideFromDock: (hideFromDock) => set({ hideFromDock }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  signOut: () =>
    set({
      isAuthenticated: false,
      cookie: null,
      metrics: null,
      claudeUsage: null,
      claudeUsageError: null,
      codexUsage: null,
      codexUsageError: null,
      todayLogs: [],
      weekLogs: [],
    }),
}));
