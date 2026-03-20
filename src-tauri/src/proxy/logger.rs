use crate::proxy::types::LogEntry;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;

fn logs_dir() -> Option<PathBuf> {
    let home = std::env::var("HOME").ok()?;
    let dir = PathBuf::from(home)
        .join(".anthropic-proxy")
        .join("logs");
    fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

fn settings_path() -> Option<PathBuf> {
    let home = std::env::var("HOME").ok()?;
    Some(PathBuf::from(home).join(".anthropic-proxy").join("settings.json"))
}

pub fn read_share_diagnostics() -> bool {
    let Some(path) = settings_path() else { return false };
    let Ok(data) = fs::read_to_string(&path) else { return false };
    let Ok(v) = serde_json::from_str::<serde_json::Value>(&data) else { return false };
    v.get("share_diagnostics")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
}

pub fn append_log(entry: &LogEntry) {
    let Some(dir) = logs_dir() else { return };
    let date = chrono::Utc::now().format("%Y-%m-%d").to_string();
    let path = dir.join(format!("{}.jsonl", date));

    let Ok(line) = serde_json::to_string(entry) else { return };

    let Ok(mut file) = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
    else {
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
    std::process::Command::new("git")
        .args(["rev-parse", "--show-toplevel"])
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .and_then(|s| {
            s.trim()
                .rsplit('/')
                .next()
                .map(|s| s.to_string())
        })
        .unwrap_or_else(|| "unknown".to_string())
}
