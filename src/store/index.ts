import { create } from "zustand";
import type { LogRecord, DeveloperMetrics, ProxyStatus, Preferences } from "../lib/types";

interface AppStore {
  isAuthenticated: boolean;
  cookie: string | null;
  metrics: DeveloperMetrics | null;
  todayLogs: LogRecord[];
  weekLogs: LogRecord[];
  proxyStatus: ProxyStatus;
  preferences: Preferences;
  loading: boolean;
  error: string | null;

  setAuthenticated: (auth: boolean, cookie?: string | null) => void;
  setMetrics: (metrics: DeveloperMetrics | null) => void;
  setTodayLogs: (logs: LogRecord[]) => void;
  setWeekLogs: (logs: LogRecord[]) => void;
  setProxyStatus: (status: ProxyStatus) => void;
  setPreferences: (prefs: Preferences) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  signOut: () => void;
}

export const useStore = create<AppStore>((set) => ({
  isAuthenticated: false,
  cookie: null,
  metrics: null,
  todayLogs: [],
  weekLogs: [],
  proxyStatus: { running: false, enabled: false, shareDiagnostics: false },
  preferences: { poll_interval: 60000, tray_display: "cost" },
  loading: false,
  error: null,

  setAuthenticated: (auth, cookie) =>
    set({ isAuthenticated: auth, cookie: cookie ?? null }),
  setMetrics: (metrics) => set({ metrics }),
  setTodayLogs: (todayLogs) => set({ todayLogs }),
  setWeekLogs: (weekLogs) => set({ weekLogs }),
  setProxyStatus: (proxyStatus) => set({ proxyStatus }),
  setPreferences: (preferences) => set({ preferences }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  signOut: () =>
    set({
      isAuthenticated: false,
      cookie: null,
      metrics: null,
      todayLogs: [],
      weekLogs: [],
    }),
}));
