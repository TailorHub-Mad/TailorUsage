import { invoke } from "@tauri-apps/api/core";
import type { Preferences } from "./types";

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

export async function setTrayTitle(title: string): Promise<void> {
  return invoke("set_tray_title", { title });
}

export async function checkProxyRunning(): Promise<boolean> {
  return invoke("check_proxy_running");
}

export async function getProxySettings(): Promise<Record<string, unknown>> {
  return invoke("get_proxy_settings");
}

export async function setProxySettings(
  shareDiagnostics: boolean,
): Promise<void> {
  return invoke("set_proxy_settings", { shareDiagnostics });
}

export async function getPreferences(): Promise<Preferences> {
  return invoke("get_preferences");
}

export async function setPreferences(prefs: Preferences): Promise<void> {
  return invoke("set_preferences", { prefs });
}
