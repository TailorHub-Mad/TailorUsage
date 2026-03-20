use crate::proxy::types::LogEntry;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;

fn logs_dir() -> Option<PathBuf> {
    let home = std::env::var("HOME").ok()?;
    let dir = PathBuf::from(home).join(".anthropic-proxy").join("logs");
    fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

fn settings_path() -> Option<PathBuf> {
    let home = std::env::var("HOME").ok()?;
    Some(
        PathBuf::from(home)
            .join(".anthropic-proxy")
            .join("settings.json"),
    )
}

fn credentials_path() -> Option<PathBuf> {
    let home = std::env::var("HOME").ok()?;
    Some(
        PathBuf::from(home)
            .join(".anthropic-proxy")
            .join("credentials.json"),
    )
}

fn read_json_file(path: PathBuf) -> Option<serde_json::Value> {
    let data = fs::read_to_string(path).ok()?;
    serde_json::from_str::<serde_json::Value>(&data).ok()
}

pub fn read_share_diagnostics() -> bool {
    let Some(path) = settings_path() else {
        return false;
    };
    let Some(v) = read_json_file(path) else {
        return false;
    };
    v.get("share_diagnostics")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
}

pub fn read_openai_api_key() -> Option<String> {
    std::env::var("TAILOR_OPENAI_API_KEY")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            std::env::var("OPENAI_API_KEY")
                .ok()
                .filter(|value| !value.trim().is_empty())
        })
        .or_else(|| {
            let path = credentials_path()?;
            let value = read_json_file(path)?;
            value
                .get("openai_api_key")
                .and_then(|v| v.as_str())
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty())
        })
}

pub fn append_log(entry: &LogEntry) {
    let Some(dir) = logs_dir() else { return };
    let date = chrono::Utc::now().format("%Y-%m-%d").to_string();
    let path = dir.join(format!("{}.jsonl", date));

    let Ok(line) = serde_json::to_string(entry) else {
        return;
    };

    let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) else {
        return;
    };

    writeln!(file, "{}", line).ok();
}

/// Get developer_id from git config (user.email).
pub fn get_developer_id() -> String {
    std::process::Command::new("git")
        .args(["config", "user.email"])
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| "unknown".to_string())
}

/// Get repo name from current working directory or "unknown".
pub fn get_repo_name() -> String {
    let git_repo = std::process::Command::new("git")
        .args(["rev-parse", "--show-toplevel"])
        .output()
        .ok()
        .and_then(|o| {
            if o.status.success() {
                String::from_utf8(o.stdout).ok()
            } else {
                None
            }
        })
        .and_then(|s| {
            let trimmed = s.trim();
            if trimmed.is_empty() {
                None
            } else {
                trimmed.rsplit('/').next().map(|s| s.to_string())
            }
        });

    git_repo
        .or_else(|| {
            std::env::current_dir().ok().and_then(|dir| {
                dir.file_name()
                    .and_then(|name| name.to_str())
                    .map(|name| name.trim().to_string())
                    .filter(|name| !name.is_empty())
            })
        })
        .unwrap_or_else(|| "unknown".to_string())
}
