import { invoke } from "@tauri-apps/api/core";
import type { ClaudeUsage, CodexUsage, Preferences } from "./types";

export async function getAuthCookie(): Promise<string | null> {
  return invoke<string | null>("get_auth_cookie");
}

export async function setAuthCookie(cookie: string): Promise<void> {
  return invoke("set_auth_cookie", { cookie });
}

export async function clearAuthCookie(): Promise<void> {
  return invoke("clear_auth_cookie");
}

export async function startAuthFlow(): Promise<void> {
  return invoke("start_auth_flow");
}

export async function fetchMetrics(
  cookie: string,
): Promise<Record<string, unknown>> {
  return invoke("fetch_metrics", { cookie });
}

export async function fetchUsage(
  cookie: string,
  startDate: string,
  endDate: string,
): Promise<Record<string, unknown>> {
  return invoke("fetch_usage", {
    cookie,
    startDate,
    endDate,
  });
}

export async function fetchClaudeUsage(): Promise<ClaudeUsage> {
  return invoke("fetch_claude_usage");
}

export async function fetchCodexUsage(): Promise<CodexUsage> {
  return invoke("fetch_codex_usage");
}

export async function readLocalLogs(date: string): Promise<Record<string, unknown>[]> {
  return invoke("read_local_logs", { date });
}

export async function setTrayTitle(title: string): Promise<void> {
  return invoke("set_tray_title", { title });
}

export async function checkProxyRunning(): Promise<boolean> {
  return invoke("check_proxy_running");
}

export async function getPreferences(): Promise<Preferences> {
  return invoke("get_preferences");
}

export async function setPreferences(prefs: Preferences): Promise<void> {
  return invoke("set_preferences", { prefs });
}

export async function startProxy(): Promise<void> {
  return invoke("start_proxy");
}

export async function stopProxy(): Promise<void> {
  return invoke("stop_proxy");
}

export async function getProxyEnabled(): Promise<boolean> {
  return invoke("get_proxy_enabled");
}

export async function getAppVersion(): Promise<string> {
  return invoke("get_app_version");
}

export async function checkForUpdate(): Promise<import("./types").UpdateInfo> {
  return invoke("check_for_update");
}

export async function openUrl(url: string): Promise<void> {
  return invoke("open_url", { url });
}

export async function keepWindowVisible(): Promise<void> {
  return invoke("keep_window_visible");
}

export async function forwardLogsToDashboard(): Promise<number> {
  return invoke("forward_logs_to_dashboard");
}
