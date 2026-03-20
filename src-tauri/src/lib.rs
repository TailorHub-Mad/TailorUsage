mod proxy;

use serde::{Deserialize, Serialize};
use std::fs;
use std::net::TcpStream;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{
    image::Image,
    tray::{TrayIcon, TrayIconBuilder},
    webview::WebviewWindowBuilder,
    AppHandle, Emitter, Manager, WebviewUrl,
};
// --- State ---

struct AuthState {
    cookie: Option<String>,
}

struct AppState {
    auth: Mutex<AuthState>,
    /// Timestamp of the last show() call — used to debounce blur-hide
    last_shown: Mutex<Option<Instant>>,
    /// Keep tray icon alive for the lifetime of the app
    _tray: TrayIcon,
    /// Running proxy handle
    proxy: Mutex<Option<proxy::ProxyHandle>>,
}

// --- Auth persistence ---

fn auth_path(app: &AppHandle) -> PathBuf {
    let dir = app.path().app_data_dir().expect("app data dir");
    fs::create_dir_all(&dir).ok();
    dir.join("auth.json")
}

fn load_persisted_cookie(app: &AppHandle) -> Option<String> {
    let path = auth_path(app);
    let data = fs::read_to_string(path).ok()?;
    let v: serde_json::Value = serde_json::from_str(&data).ok()?;
    v.get("cookie")?.as_str().map(|s| s.to_string())
}

fn persist_cookie(app: &AppHandle, cookie: &str) {
    let path = auth_path(app);
    let data = serde_json::json!({ "cookie": cookie });
    fs::write(path, data.to_string()).ok();
}

fn clear_persisted_cookie(app: &AppHandle) {
    let path = auth_path(app);
    fs::remove_file(path).ok();
}

// --- Tauri Commands ---

#[tauri::command]
fn get_auth_cookie(state: tauri::State<'_, AppState>) -> Option<String> {
    state.auth.lock().unwrap().cookie.clone()
}

#[tauri::command]
fn set_auth_cookie(app: AppHandle, state: tauri::State<'_, AppState>, cookie: String) {
    persist_cookie(&app, &cookie);
    state.auth.lock().unwrap().cookie = Some(cookie);
}

#[tauri::command]
fn clear_auth_cookie(app: AppHandle, state: tauri::State<'_, AppState>) {
    clear_persisted_cookie(&app);
    state.auth.lock().unwrap().cookie = None;
}

#[tauri::command]
async fn start_auth_flow(app: AppHandle) -> Result<(), String> {
    // source=tailor tells the dashboard callback to redirect to tailorbar:// instead of the web root
    let url = "https://ai-usage-dashboard-sage.vercel.app/api/auth/login?source=tailor";

    let app_handle = app.clone();
    let _auth_window = WebviewWindowBuilder::new(&app, "auth", WebviewUrl::External(url.parse().unwrap()))
        .title("Sign in to Tailor")
        .inner_size(500.0, 700.0)
        .center()
        .visible(true)
        .on_navigation(move |url: &url::Url| {
            // After OAuth the dashboard redirects to /tailor-auth?token=<jwt>
            // Intercept here in Rust before the page loads
            let is_tailor_auth = url.host_str() == Some("ai-usage-dashboard-sage.vercel.app")
                && url.path() == "/tailor-auth";

            if is_tailor_auth {
                let token = url
                    .query_pairs()
                    .find(|(k, _)| k == "token")
                    .map(|(_, v)| v.to_string());

                if let Some(token) = token {
                    persist_cookie(&app_handle, &token);
                    if let Some(state) = app_handle.try_state::<AppState>() {
                        state.auth.lock().unwrap().cookie = Some(token);
                    }
                    app_handle.emit("auth-success", ()).ok();
                    // Close the auth window off the navigation callback to avoid deadlock
                    let handle = app_handle.clone();
                    tauri::async_runtime::spawn(async move {
                        if let Some(w) = handle.get_webview_window("auth") {
                            w.close().ok();
                        }
                    });
                }

                return false; // cancel navigation — /tailor-auth is not a real page
            }
            true
        })
        .build()
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
async fn fetch_metrics(cookie: String) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let resp = client
        .get("https://ai-usage-dashboard-sage.vercel.app/api/metrics")
        .header("Cookie", format!("ai_dashboard_session={}", cookie))
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if resp.status() == 401 {
        return Err("unauthorized".to_string());
    }

    resp.json::<serde_json::Value>()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn fetch_usage(
    cookie: String,
    start_date: String,
    end_date: String,
) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let resp = client
        .get("https://ai-usage-dashboard-sage.vercel.app/api/usage")
        .query(&[("start_date", &start_date), ("end_date", &end_date)])
        .header("Cookie", format!("ai_dashboard_session={}", cookie))
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if resp.status() == 401 {
        return Err("unauthorized".to_string());
    }

    resp.json::<serde_json::Value>()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn read_local_logs(date: String) -> Vec<serde_json::Value> {
    let Some(home) = dirs_next() else { return vec![] };
    let path = home
        .join(".anthropic-proxy")
        .join("logs")
        .join(format!("{}.jsonl", date));
    let Ok(content) = fs::read_to_string(&path) else { return vec![] };
    content
        .lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|l| serde_json::from_str(l).ok())
        .collect()
}

#[tauri::command]
fn set_tray_title(app: AppHandle, title: String) {
    if let Some(tray) = app.tray_by_id("main") {
        tray.set_title(Some(&title)).ok();
    }
}

#[tauri::command]
fn check_proxy_running() -> bool {
    TcpStream::connect_timeout(
        &"127.0.0.1:8787".parse().unwrap(),
        Duration::from_millis(500),
    )
    .is_ok()
}

#[derive(Serialize, Deserialize)]
#[allow(dead_code)]
struct ProxySettings {
    share_diagnostics: bool,
}

fn proxy_settings_path() -> PathBuf {
    let home = dirs_next().unwrap_or_else(|| PathBuf::from("/tmp"));
    home.join(".anthropic-proxy").join("settings.json")
}

fn dirs_next() -> Option<PathBuf> {
    std::env::var("HOME").ok().map(PathBuf::from)
}

#[tauri::command]
fn get_proxy_settings() -> Result<serde_json::Value, String> {
    let path = proxy_settings_path();
    let data = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let settings: serde_json::Value = serde_json::from_str(&data).map_err(|e| e.to_string())?;
    Ok(settings)
}

#[tauri::command]
fn set_proxy_settings(share_diagnostics: bool) -> Result<(), String> {
    let path = proxy_settings_path();

    // Read existing settings, update share_diagnostics
    let mut settings: serde_json::Value = if path.exists() {
        let data = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&data).unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    settings["share_diagnostics"] = serde_json::Value::Bool(share_diagnostics);

    fs::write(&path, serde_json::to_string_pretty(&settings).unwrap())
        .map_err(|e| e.to_string())?;

    Ok(())
}

// --- Preferences ---

#[derive(Serialize, Deserialize)]
#[allow(dead_code)]
struct Preferences {
    poll_interval: u64,
    tray_display: String,
}

fn preferences_path(app: &AppHandle) -> PathBuf {
    let dir = app.path().app_data_dir().expect("app data dir");
    fs::create_dir_all(&dir).ok();
    dir.join("preferences.json")
}

#[tauri::command]
fn get_preferences(app: AppHandle) -> serde_json::Value {
    let path = preferences_path(&app);
    fs::read_to_string(&path)
        .ok()
        .and_then(|d| serde_json::from_str(&d).ok())
        .unwrap_or(serde_json::json!({
            "poll_interval": 60000,
            "tray_display": "cost"
        }))
}

#[tauri::command]
fn set_preferences(app: AppHandle, prefs: serde_json::Value) -> Result<(), String> {
    let path = preferences_path(&app);
    fs::write(&path, serde_json::to_string_pretty(&prefs).unwrap())
        .map_err(|e| e.to_string())?;
    Ok(())
}

// --- Proxy lifecycle commands ---

#[tauri::command]
async fn start_proxy(app: AppHandle, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut guard = state.proxy.lock().unwrap();
    if guard.is_some() {
        return Err("Proxy is already running".to_string());
    }

    let config = proxy::types::ProxyConfig::default();
    let handle = proxy::start(config)?;
    *guard = Some(handle);

    // Persist preference
    set_proxy_enabled_pref(&app, true);

    Ok(())
}

#[tauri::command]
async fn stop_proxy(app: AppHandle, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let handle = {
        let mut guard = state.proxy.lock().unwrap();
        guard.take()
    };

    if let Some(h) = handle {
        h.stop();
    }

    proxy::cleanup_config();

    // Persist preference
    set_proxy_enabled_pref(&app, false);

    Ok(())
}

#[tauri::command]
fn get_proxy_enabled(state: tauri::State<'_, AppState>) -> bool {
    state.proxy.lock().unwrap().is_some()
}

fn proxy_enabled_pref_path(app: &AppHandle) -> PathBuf {
    let dir = app.path().app_data_dir().expect("app data dir");
    fs::create_dir_all(&dir).ok();
    dir.join("proxy_enabled.json")
}

fn set_proxy_enabled_pref(app: &AppHandle, enabled: bool) {
    let path = proxy_enabled_pref_path(app);
    let data = serde_json::json!({ "enabled": enabled });
    fs::write(path, data.to_string()).ok();
}

fn load_proxy_enabled_pref(app: &AppHandle) -> bool {
    let path = proxy_enabled_pref_path(app);
    fs::read_to_string(path)
        .ok()
        .and_then(|d| serde_json::from_str::<serde_json::Value>(&d).ok())
        .and_then(|v| v.get("enabled")?.as_bool())
        .unwrap_or(false)
}

// --- App Setup ---

fn toggle_popover(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else { return; };
    if window.is_visible().unwrap_or(false) {
        window.hide().ok();
    } else {
        if let Some(state) = app.try_state::<AppState>() {
            *state.last_shown.lock().unwrap() = Some(Instant::now());
        }
        window.center().ok();
        window.show().ok();
        window.set_focus().ok();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // Load persisted cookie
            if let Some(cookie) = load_persisted_cookie(app.handle()) {
                // Will be stored in AppState after tray is built below
                let _ = cookie; // placeholder until manage() below
            }

            // Create tray icon — must be stored in managed state or it gets dropped
            let app_handle = app.handle().clone();
            let quit_handle = app.handle().clone();

            // A right-click menu keeps the NSStatusItem stable on macOS Sequoia+
            let menu = tauri::menu::MenuBuilder::new(app)
                .text("quit", "Quit Tailor Bar")
                .build()?;

            let tray = TrayIconBuilder::with_id("main")
                .icon(Image::from_bytes(include_bytes!("../icons/new-icon.png"))
                    .expect("tray icon"))
                .title("--")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_tray_icon_event(move |_tray, event| {
                    if let tauri::tray::TrayIconEvent::Click {
                        button_state: tauri::tray::MouseButtonState::Up, ..
                    } = event
                    {
                        toggle_popover(&app_handle);
                    }
                })
                .on_menu_event(move |_app, event| {
                    if event.id() == "quit" {
                        quit_handle.exit(0);
                    }
                })
                .build(app)?;

            // Auto-start proxy if it was enabled before
            let proxy_handle = if load_proxy_enabled_pref(app.handle()) {
                match proxy::start(proxy::types::ProxyConfig::default()) {
                    Ok(h) => Some(h),
                    Err(e) => {
                        log::warn!("Failed to auto-start proxy: {}", e);
                        None
                    }
                }
            } else {
                None
            };

            // Store everything in managed state (keeps tray alive)
            app.manage(AppState {
                auth: Mutex::new(AuthState {
                    cookie: load_persisted_cookie(app.handle()),
                }),
                last_shown: Mutex::new(None::<Instant>),
                _tray: tray,
                proxy: Mutex::new(proxy_handle),
            });

            // Create the hidden popover window
            let _window = WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::default(),
            )
            .title("Tailor Bar")
            .inner_size(380.0, 520.0)
            .decorations(false)
            .transparent(true)
            .shadow(true)
            .skip_taskbar(true)
            .visible(false)
            .center()
            .build()?;

            // Hide popover on blur (with 800ms guard to avoid hiding right after show)
            let app_handle2 = app.handle().clone();
            if let Some(window) = app.get_webview_window("main") {
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::Focused(false) = event {
                        if let Some(state) = app_handle2.try_state::<AppState>() {
                            let guard = state.last_shown.lock().unwrap();
                            if let Some(ts) = *guard {
                                if ts.elapsed() < Duration::from_millis(800) {
                                    return;
                                }
                            }
                        }
                        if let Some(w) = app_handle2.get_webview_window("main") {
                            w.hide().ok();
                        }
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_auth_cookie,
            set_auth_cookie,
            clear_auth_cookie,
            start_auth_flow,
            fetch_metrics,
            fetch_usage,
            read_local_logs,
            set_tray_title,
            check_proxy_running,
            get_proxy_settings,
            set_proxy_settings,
            get_preferences,
            set_preferences,
            start_proxy,
            stop_proxy,
            get_proxy_enabled,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            match event {
                tauri::RunEvent::ExitRequested { api, .. } => {
                    // Keep the process (and tray icon) alive when all windows are hidden
                    api.prevent_exit();
                }
                tauri::RunEvent::Exit => {
                    // Gracefully stop proxy on app exit
                    if let Some(state) = app_handle.try_state::<AppState>() {
                        let handle = state.proxy.lock().unwrap().take();
                        if let Some(h) = handle {
                            // Best-effort shutdown — send signal but don't block on join
                            let _ = h;
                        }
                    }
                }
                _ => {}
            }
        });
}
