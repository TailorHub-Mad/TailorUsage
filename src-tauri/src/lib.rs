mod proxy;

use serde::{Deserialize, Serialize};
use std::fs;
use std::net::TcpStream;
use std::path::PathBuf;
use std::process::Command;
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

fn auth_value_from_url(url: &url::Url) -> Option<String> {
    const AUTH_KEYS: [&str; 4] = ["token", "cookie", "session", "sessionToken"];

    if let Some(value) = url
        .query_pairs()
        .find(|(key, _)| AUTH_KEYS.contains(&key.as_ref()))
        .map(|(_, value)| value.to_string())
    {
        return Some(value);
    }

    let fragment = url.fragment()?;
    url::form_urlencoded::parse(fragment.trim_start_matches('?').as_bytes())
        .find(|(key, _)| AUTH_KEYS.contains(&key.as_ref()))
        .map(|(_, value)| value.to_string())
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClaudeOauthCredentials {
    access_token: String,
    refresh_token: String,
    expires_at: i64,
    scopes: Vec<String>,
    subscription_type: Option<String>,
    rate_limit_tier: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct ClaudeCredentialsFile {
    #[serde(rename = "claudeAiOauth")]
    claude_ai_oauth: ClaudeOauthCredentials,
}

#[derive(Deserialize)]
struct ClaudeRefreshResponse {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: i64,
}

#[derive(Clone, Serialize, Deserialize)]
struct CodexAuthTokens {
    access_token: String,
    refresh_token: String,
    id_token: Option<String>,
    account_id: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
struct CodexAuthPayload {
    #[serde(rename = "OPENAI_API_KEY")]
    openai_api_key: Option<String>,
    tokens: CodexAuthTokens,
    last_refresh: Option<String>,
}

enum CodexCredentialSource {
    File(PathBuf),
    Keychain,
}

struct LoadedCodexCredentials {
    auth: CodexAuthPayload,
    source: CodexCredentialSource,
}

#[derive(Deserialize)]
struct CodexRefreshResponse {
    access_token: String,
    refresh_token: Option<String>,
    id_token: Option<String>,
}

fn claude_credentials_path() -> Result<PathBuf, String> {
    let home = dirs_next().ok_or_else(|| "HOME not set".to_string())?;
    Ok(home.join(".claude").join(".credentials.json"))
}

fn read_claude_credentials_from_file() -> Result<Option<ClaudeOauthCredentials>, String> {
    let path = claude_credentials_path()?;
    if !path.exists() {
        return Ok(None);
    }

    let data = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let credentials =
        serde_json::from_str::<ClaudeCredentialsFile>(&data).map_err(|e| e.to_string())?;
    Ok(Some(credentials.claude_ai_oauth))
}

fn read_claude_credentials_from_keychain() -> Result<Option<ClaudeOauthCredentials>, String> {
    let output = Command::new("security")
        .args([
            "find-generic-password",
            "-s",
            "Claude Code-credentials",
            "-w",
        ])
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Ok(None);
    }

    let stdout = String::from_utf8(output.stdout).map_err(|e| e.to_string())?;
    if stdout.trim().is_empty() {
        return Ok(None);
    }

    if let Ok(file) = serde_json::from_str::<ClaudeCredentialsFile>(&stdout) {
        return Ok(Some(file.claude_ai_oauth));
    }

    let credentials =
        serde_json::from_str::<ClaudeOauthCredentials>(&stdout).map_err(|e| e.to_string())?;
    Ok(Some(credentials))
}

fn load_claude_credentials() -> Result<ClaudeOauthCredentials, String> {
    if let Some(credentials) = read_claude_credentials_from_file()? {
        return Ok(credentials);
    }

    if let Some(credentials) = read_claude_credentials_from_keychain()? {
        return Ok(credentials);
    }

    Err("claude_credentials_missing".to_string())
}

fn persist_claude_credentials(credentials: &ClaudeOauthCredentials) -> Result<(), String> {
    let path = claude_credentials_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let payload = ClaudeCredentialsFile {
        claude_ai_oauth: credentials.clone(),
    };
    let json = serde_json::to_string_pretty(&payload).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())
}

fn should_refresh_claude_token(credentials: &ClaudeOauthCredentials) -> bool {
    let now_ms = chrono::Utc::now().timestamp_millis();
    credentials.expires_at - now_ms <= 5 * 60 * 1000
}

async fn refresh_claude_token(
    client: &reqwest::Client,
    credentials: &mut ClaudeOauthCredentials,
) -> Result<(), String> {
    let response = client
        .post("https://platform.claude.com/v1/oauth/token")
        .header("Accept", "application/json")
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({
            "grant_type": "refresh_token",
            "refresh_token": credentials.refresh_token,
            "client_id": "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
            "scope": "user:profile user:inference user:sessions:claude_code user:mcp_servers"
        }))
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        return Err(format!("claude_token_refresh_failed:{}", response.status()));
    }

    let refreshed = response
        .json::<ClaudeRefreshResponse>()
        .await
        .map_err(|e| e.to_string())?;

    credentials.access_token = refreshed.access_token;
    if let Some(refresh_token) = refreshed.refresh_token {
        credentials.refresh_token = refresh_token;
    }
    credentials.expires_at = chrono::Utc::now().timestamp_millis() + refreshed.expires_in * 1000;

    persist_claude_credentials(credentials)?;
    Ok(())
}

async fn request_claude_usage(
    client: &reqwest::Client,
    access_token: &str,
) -> Result<reqwest::Response, String> {
    client
        .get("https://api.anthropic.com/api/oauth/usage")
        .header("Authorization", format!("Bearer {}", access_token))
        .header("Accept", "application/json")
        .header("Content-Type", "application/json")
        .header("anthropic-beta", "oauth-2025-04-20")
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| e.to_string())
}

fn codex_auth_paths() -> Result<Vec<PathBuf>, String> {
    let home = dirs_next().ok_or_else(|| "HOME not set".to_string())?;
    let mut paths = Vec::new();

    if let Ok(codex_home) = std::env::var("CODEX_HOME") {
        paths.push(PathBuf::from(codex_home).join("auth.json"));
    }

    paths.push(home.join(".config").join("codex").join("auth.json"));
    paths.push(home.join(".codex").join("auth.json"));

    Ok(paths)
}

fn read_codex_credentials_from_file() -> Result<Option<LoadedCodexCredentials>, String> {
    for path in codex_auth_paths()? {
        if !path.exists() {
            continue;
        }

        let data = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let auth = serde_json::from_str::<CodexAuthPayload>(&data).map_err(|e| e.to_string())?;
        return Ok(Some(LoadedCodexCredentials {
            auth,
            source: CodexCredentialSource::File(path),
        }));
    }

    Ok(None)
}

fn read_codex_credentials_from_keychain() -> Result<Option<LoadedCodexCredentials>, String> {
    let output = Command::new("security")
        .args(["find-generic-password", "-s", "Codex Auth", "-w"])
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Ok(None);
    }

    let stdout = String::from_utf8(output.stdout).map_err(|e| e.to_string())?;
    if stdout.trim().is_empty() {
        return Ok(None);
    }

    let auth = serde_json::from_str::<CodexAuthPayload>(&stdout).map_err(|e| e.to_string())?;
    Ok(Some(LoadedCodexCredentials {
        auth,
        source: CodexCredentialSource::Keychain,
    }))
}

fn load_codex_credentials() -> Result<LoadedCodexCredentials, String> {
    if let Some(credentials) = read_codex_credentials_from_file()? {
        return Ok(credentials);
    }

    if let Some(credentials) = read_codex_credentials_from_keychain()? {
        return Ok(credentials);
    }

    Err("codex_credentials_missing".to_string())
}

fn persist_codex_credentials(credentials: &LoadedCodexCredentials) -> Result<(), String> {
    let CodexCredentialSource::File(path) = &credentials.source else {
        return Ok(());
    };

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let json = serde_json::to_string_pretty(&credentials.auth).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())
}

fn should_refresh_codex_token(credentials: &LoadedCodexCredentials) -> bool {
    let Some(last_refresh) = &credentials.auth.last_refresh else {
        return true;
    };

    let Ok(parsed) = chrono::DateTime::parse_from_rfc3339(last_refresh) else {
        return true;
    };

    chrono::Utc::now() - parsed.with_timezone(&chrono::Utc) >= chrono::Duration::days(8)
}

async fn refresh_codex_token(
    client: &reqwest::Client,
    credentials: &mut LoadedCodexCredentials,
) -> Result<(), String> {
    let response = client
        .post("https://auth.openai.com/oauth/token")
        .header("Accept", "application/json")
        .form(&[
            ("grant_type", "refresh_token"),
            ("client_id", "app_EMoamEEZ73f0CkXaXp7hrann"),
            (
                "refresh_token",
                credentials.auth.tokens.refresh_token.as_str(),
            ),
        ])
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        return Err(format!("codex_token_refresh_failed:{}", response.status()));
    }

    let refreshed = response
        .json::<CodexRefreshResponse>()
        .await
        .map_err(|e| e.to_string())?;

    credentials.auth.tokens.access_token = refreshed.access_token;
    if let Some(refresh_token) = refreshed.refresh_token {
        credentials.auth.tokens.refresh_token = refresh_token;
    }
    if let Some(id_token) = refreshed.id_token {
        credentials.auth.tokens.id_token = Some(id_token);
    }
    credentials.auth.last_refresh = Some(chrono::Utc::now().to_rfc3339());

    persist_codex_credentials(credentials)?;
    Ok(())
}

async fn request_codex_usage(
    client: &reqwest::Client,
    access_token: &str,
    account_id: Option<&str>,
) -> Result<reqwest::Response, String> {
    let mut request = client
        .get("https://chatgpt.com/backend-api/wham/usage")
        .header("Authorization", format!("Bearer {}", access_token))
        .header("Accept", "application/json")
        .timeout(Duration::from_secs(10));

    if let Some(account_id) = account_id {
        request = request.header("ChatGPT-Account-Id", account_id);
    }

    request.send().await.map_err(|e| e.to_string())
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
    // Use the hosted callback as the primary desktop auth path so the webview can
    // intercept the final redirect directly in both dev and packaged builds.
    let url = "https://ai-usage-dashboard-sage.vercel.app/api/auth/login";

    let app_handle = app.clone();
    let _auth_window =
        WebviewWindowBuilder::new(&app, "auth", WebviewUrl::External(url.parse().unwrap()))
            .title("Sign in to Tailor")
            .inner_size(500.0, 700.0)
            .center()
            .visible(true)
            .on_navigation(move |url: &url::Url| {
                // Accept both the legacy hosted callback and the desktop deep link callback.
                let is_tailor_auth = url.host_str() == Some("ai-usage-dashboard-sage.vercel.app")
                    && url.path() == "/tailor-auth";
                let is_tailor_scheme = url.scheme() == "tailorbar";

                if is_tailor_auth || is_tailor_scheme {
                    let token = auth_value_from_url(url);

                    if let Some(token) = token {
                        persist_cookie(&app_handle, &token);
                        if let Some(state) = app_handle.try_state::<AppState>() {
                            state.auth.lock().unwrap().cookie = Some(token.clone());
                        }
                        app_handle.emit("auth-success", token).ok();
                    } else {
                        app_handle.emit("auth-success", url.as_str().to_string()).ok();
                        // Close the auth window off the navigation callback to avoid deadlock
                    }

                    // Close the auth window off the navigation callback to avoid deadlock
                    let handle = app_handle.clone();
                    tauri::async_runtime::spawn(async move {
                        if let Some(w) = handle.get_webview_window("auth") {
                            w.close().ok();
                        }
                    });

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
async fn fetch_claude_usage() -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let mut credentials = load_claude_credentials()?;

    if should_refresh_claude_token(&credentials) {
        refresh_claude_token(&client, &mut credentials).await?;
    }

    let mut response = request_claude_usage(&client, &credentials.access_token).await?;
    if response.status() == reqwest::StatusCode::UNAUTHORIZED
        || response.status() == reqwest::StatusCode::FORBIDDEN
    {
        refresh_claude_token(&client, &mut credentials).await?;
        response = request_claude_usage(&client, &credentials.access_token).await?;
    }

    if !response.status().is_success() {
        let retry_after = response
            .headers()
            .get("retry-after")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.parse::<u64>().ok())
            .map(|secs| {
                let now = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs();
                now + secs
            });
        return Err(match retry_after {
            Some(ts) => format!("claude_usage_failed:{}:{}", response.status(), ts),
            None => format!("claude_usage_failed:{}", response.status()),
        });
    }

    response
        .json::<serde_json::Value>()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn fetch_codex_usage() -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let mut credentials = load_codex_credentials()?;

    if should_refresh_codex_token(&credentials) {
        refresh_codex_token(&client, &mut credentials).await?;
    }

    let mut response = request_codex_usage(
        &client,
        &credentials.auth.tokens.access_token,
        credentials.auth.tokens.account_id.as_deref(),
    )
    .await?;

    if response.status() == reqwest::StatusCode::UNAUTHORIZED
        || response.status() == reqwest::StatusCode::FORBIDDEN
    {
        refresh_codex_token(&client, &mut credentials).await?;
        response = request_codex_usage(
            &client,
            &credentials.auth.tokens.access_token,
            credentials.auth.tokens.account_id.as_deref(),
        )
        .await?;
    }

    if !response.status().is_success() {
        return Err(format!("codex_usage_failed:{}", response.status()));
    }

    response
        .json::<serde_json::Value>()
        .await
        .map_err(|e| e.to_string())
}

// --- One-time migration: ~/.anthropic-proxy → ~/.tailor-usage-proxy ---

fn migrate_proxy_dir() {
    let Some(home) = dirs_next() else { return };
    let old_dir = home.join(".anthropic-proxy");
    let new_dir = home.join(".tailor-usage-proxy");
    if old_dir.exists() && !new_dir.exists() {
        fs::rename(&old_dir, &new_dir).ok();
    }
}

// --- Dashboard log forwarding ---

fn last_forwarded_path() -> Option<PathBuf> {
    let home = dirs_next()?;
    Some(home.join(".tailor-usage-proxy").join("last_forwarded.json"))
}

fn read_last_forwarded_ts() -> u64 {
    let Some(path) = last_forwarded_path() else {
        return 0;
    };
    fs::read_to_string(path)
        .ok()
        .and_then(|d| serde_json::from_str::<serde_json::Value>(&d).ok())
        .and_then(|v| v.get("ts")?.as_u64())
        .unwrap_or(0)
}

fn write_last_forwarded_ts(ts: u64) {
    let Some(path) = last_forwarded_path() else {
        return;
    };
    fs::write(path, serde_json::json!({ "ts": ts }).to_string()).ok();
}

const DASHBOARD_INGEST_URL: &str = "https://ai-usage-dashboard-sage.vercel.app/api/ingest";

#[tauri::command]
async fn forward_logs_to_dashboard() -> Result<usize, String> {
    let last_ts = read_last_forwarded_ts();

    let Some(home) = dirs_next() else {
        return Ok(0);
    };
    let logs_dir = home.join(".tailor-usage-proxy").join("logs");

    let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
    let yesterday = (chrono::Utc::now() - chrono::Duration::days(1))
        .format("%Y-%m-%d")
        .to_string();

    let mut entries: Vec<serde_json::Value> = Vec::new();

    for date in &[&yesterday, &today] {
        let path = logs_dir.join(format!("{}.jsonl", date));
        let Ok(content) = fs::read_to_string(&path) else {
            continue;
        };
        for line in content.lines() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            let Ok(entry) = serde_json::from_str::<serde_json::Value>(line) else {
                continue;
            };
            let entry_ts = entry.get("ts").and_then(|v| v.as_u64()).unwrap_or(0);
            if entry_ts > last_ts {
                entries.push(entry);
            }
        }
    }

    if entries.is_empty() {
        return Ok(0);
    }

    let count = entries.len();

    let client = reqwest::Client::builder()
        .user_agent("TailorUsage")
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .post(DASHBOARD_INGEST_URL)
        .json(&entries)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("ingest_failed:{}", resp.status().as_u16()));
    }

    let now_ts = chrono::Utc::now().timestamp_millis() as u64;
    write_last_forwarded_ts(now_ts);

    Ok(count)
}

#[tauri::command]
fn read_local_logs(date: String) -> Vec<serde_json::Value> {
    let Some(home) = dirs_next() else {
        return vec![];
    };
    let path = home
        .join(".tailor-usage-proxy")
        .join("logs")
        .join(format!("{}.jsonl", date));
    let Ok(content) = fs::read_to_string(&path) else {
        return vec![];
    };
    content
        .lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|l| serde_json::from_str(l).ok())
        .collect()
}

#[tauri::command]
fn open_logs_folder() -> Result<(), String> {
    let home = dirs_next().ok_or_else(|| "HOME not set".to_string())?;
    let logs_dir = home.join(".tailor-usage-proxy").join("logs");

    fs::create_dir_all(&logs_dir).map_err(|e| e.to_string())?;

    Command::new("open")
        .arg(&logs_dir)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn set_tray_title(app: AppHandle, title: String) {
    if let Some(tray) = app.tray_by_id("main") {
        tray.set_title(Some(&title)).ok();
    }
}

#[tauri::command]
fn check_proxy_running() -> bool {
    let anthropic_ok = TcpStream::connect_timeout(
        &"127.0.0.1:8787".parse().unwrap(),
        Duration::from_millis(500),
    )
    .is_ok();
    let openai_ok = TcpStream::connect_timeout(
        &"127.0.0.1:8788".parse().unwrap(),
        Duration::from_millis(500),
    )
    .is_ok();
    anthropic_ok && openai_ok
}

fn dirs_next() -> Option<PathBuf> {
    std::env::var("HOME").ok().map(PathBuf::from)
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
            "poll_interval": 900000,
            "tray_display": "tokens",
            "tray_source": "auto"
        }))
}

#[tauri::command]
fn set_preferences(app: AppHandle, prefs: serde_json::Value) -> Result<(), String> {
    let path = preferences_path(&app);
    fs::write(&path, serde_json::to_string_pretty(&prefs).unwrap()).map_err(|e| e.to_string())?;
    Ok(())
}

// --- Update ---

#[derive(Serialize)]
struct UpdateInfo {
    available: bool,
    latest_version: String,
    download_url: String,
}

#[tauri::command]
fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

fn parse_version(v: &str) -> (u64, u64, u64) {
    let parts: Vec<u64> = v.split('.').map(|p| p.parse().unwrap_or(0)).collect();
    (
        parts.first().copied().unwrap_or(0),
        parts.get(1).copied().unwrap_or(0),
        parts.get(2).copied().unwrap_or(0),
    )
}

fn is_newer(latest: &str, current: &str) -> bool {
    parse_version(latest) > parse_version(current)
}

#[tauri::command]
async fn check_for_update() -> Result<UpdateInfo, String> {
    let client = reqwest::Client::builder()
        .user_agent("TailorUsage")
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .get("https://api.github.com/repos/TailorHub-Mad/TailorUsage/releases/latest")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("GitHub API error: {}", resp.status()));
    }

    let release: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;

    let latest_version = release["tag_name"]
        .as_str()
        .unwrap_or("")
        .trim_start_matches('v')
        .to_string();

    let download_url = release["assets"]
        .as_array()
        .and_then(|assets| {
            assets
                .iter()
                .find(|a| a["name"].as_str().unwrap_or("").ends_with(".dmg"))
        })
        .and_then(|a| a["browser_download_url"].as_str())
        .unwrap_or(release["html_url"].as_str().unwrap_or(""))
        .to_string();

    let current = env!("CARGO_PKG_VERSION");
    let available = !latest_version.is_empty() && is_newer(&latest_version, current);

    Ok(UpdateInfo {
        available,
        latest_version,
        download_url,
    })
}

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    std::process::Command::new("open")
        .arg(&url)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
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

fn current_logical_height(window: &tauri::WebviewWindow) -> f64 {
    let scale = window.scale_factor().unwrap_or(1.0);
    window
        .inner_size()
        .map(|s| s.height as f64 / scale)
        .unwrap_or(600.0)
}

fn resize_and_center_main_window(window: &tauri::WebviewWindow) {
    if let Ok(Some(monitor)) = window.current_monitor() {
        let scale = monitor.scale_factor();
        let monitor_x = monitor.position().x as f64 / scale;
        let monitor_y = monitor.position().y as f64 / scale;
        let monitor_width = monitor.size().width as f64 / scale;
        let monitor_height = monitor.size().height as f64 / scale;
        let width = 450.0;
        let height = current_logical_height(window);
        window
            .set_size(tauri::Size::Logical(tauri::LogicalSize::new(width, height)))
            .ok();
        window
            .set_position(tauri::Position::Logical(tauri::LogicalPosition::new(
                monitor_x + (monitor_width - width) / 2.0,
                monitor_y + (monitor_height - height) / 2.0,
            )))
            .ok();
        return;
    }
    window.center().ok();
}

fn position_main_window_from_tray_icon(window: &tauri::WebviewWindow, icon_rect: tauri::Rect) {
    let width = 450.0;
    // Preserve the height set by the frontend's ResizeObserver; only reset width.
    let height = current_logical_height(window);
    let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize::new(width, height)));

    if let Ok(monitors) = window.available_monitors() {
        if let Some((monitor, icon_position, icon_size)) =
            monitors.into_iter().find_map(|monitor| {
                let scale = monitor.scale_factor();
                let icon_position = icon_rect.position.to_physical::<f64>(scale);
                let icon_size = icon_rect.size.to_physical::<f64>(scale);
                let position = monitor.position();
                let size = monitor.size();
                let left = position.x as f64;
                let top = position.y as f64;
                let right = left + size.width as f64;
                let bottom = top + size.height as f64;
                let icon_center_x = icon_position.x + (icon_size.width / 2.0);
                let icon_top_y = icon_position.y;

                (icon_center_x >= left
                    && icon_center_x <= right
                    && icon_top_y >= top
                    && icon_top_y <= bottom)
                    .then_some((monitor, icon_position, icon_size))
            })
        {
            let scale = monitor.scale_factor();
            let monitor_x = monitor.position().x as f64 / scale;
            let monitor_y = monitor.position().y as f64 / scale;
            let monitor_width = monitor.size().width as f64 / scale;
            let icon_center_x = (icon_position.x + (icon_size.width / 2.0)) / scale;
            let icon_bottom_y = (icon_position.y + icon_size.height) / scale;
            let horizontal_margin = 12.0;
            let y_offset = 8.0;

            let x = (icon_center_x - (width / 2.0)).clamp(
                monitor_x + horizontal_margin,
                monitor_x + monitor_width - width - horizontal_margin,
            );
            let y = (icon_bottom_y + y_offset).max(monitor_y + y_offset);

            let _ =
                window.set_position(tauri::Position::Logical(tauri::LogicalPosition::new(x, y)));
            return;
        }
    }

    resize_and_center_main_window(window);
}

fn toggle_popover(app: &AppHandle, icon_rect: Option<tauri::Rect>) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    if window.is_visible().unwrap_or(false) {
        window.hide().ok();
    } else {
        if let Some(state) = app.try_state::<AppState>() {
            *state.last_shown.lock().unwrap() = Some(Instant::now());
        }
        if let Some(icon_rect) = icon_rect {
            position_main_window_from_tray_icon(&window, icon_rect);
        } else {
            resize_and_center_main_window(&window);
        }
        window.show().ok();
        window.set_focus().ok();
    }
}

#[tauri::command]
fn keep_window_visible(state: tauri::State<'_, AppState>) {
    *state.last_shown.lock().unwrap() = Some(Instant::now());
}

#[tauri::command]
fn resize_window(window: tauri::WebviewWindow, height: f64) {
    let clamped = height.clamp(200.0, 900.0);
    let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize::new(450.0, clamped)));
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            migrate_proxy_dir();

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
                .text("quit", "Quit TailorUsage")
                .build()?;

            let tray = TrayIconBuilder::with_id("main")
                .icon(
                    Image::from_bytes(include_bytes!("../icons/new-icon.png")).expect("tray icon"),
                )
                .title("--")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_tray_icon_event(move |_tray, event| {
                    if let tauri::tray::TrayIconEvent::Click {
                        button_state: tauri::tray::MouseButtonState::Up,
                        rect,
                        ..
                    } = event
                    {
                        toggle_popover(&app_handle, Some(rect));
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
            let _window = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title("TailorUsage")
                .inner_size(450.0, 600.0)
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
                resize_and_center_main_window(&window);
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
            fetch_claude_usage,
            fetch_codex_usage,
            read_local_logs,
            open_logs_folder,
            set_tray_title,
            check_proxy_running,
            get_preferences,
            set_preferences,
            start_proxy,
            stop_proxy,
            get_proxy_enabled,
            get_app_version,
            check_for_update,
            open_url,
            keep_window_visible,
            forward_logs_to_dashboard,
            resize_window,
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
                    // Always clean up config on exit so Claude Code works without the app running
                    proxy::cleanup_config();
                }
                _ => {}
            }
        });
}
