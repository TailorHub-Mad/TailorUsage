use crate::proxy::types::LogEntry;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::net::{IpAddr, SocketAddr};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RepoAttribution {
    pub repo: String,
    pub source: String,
    pub pid: Option<u32>,
    pub cwd: Option<PathBuf>,
}

fn logs_dir() -> Option<PathBuf> {
    let home = std::env::var("HOME").ok()?;
    let dir = PathBuf::from(home).join(".tailor-usage-proxy").join("logs");
    fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

fn credentials_path() -> Option<PathBuf> {
    let home = std::env::var("HOME").ok()?;
    Some(
        PathBuf::from(home)
            .join(".tailor-usage-proxy")
            .join("credentials.json"),
    )
}

fn diagnostics_dir() -> Option<PathBuf> {
    let home = std::env::var("HOME").ok()?;
    let dir = PathBuf::from(home)
        .join(".tailor-usage-proxy")
        .join("diagnostics");
    fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

fn read_json_file(path: PathBuf) -> Option<serde_json::Value> {
    let data = fs::read_to_string(path).ok()?;
    serde_json::from_str::<serde_json::Value>(&data).ok()
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

pub fn write_anthropic_token_diagnostics(diagnostics: &serde_json::Value) {
    let Some(dir) = diagnostics_dir() else { return };
    let path = dir.join("anthropic-token-debug.json");

    let Ok(payload) = serde_json::to_string_pretty(diagnostics) else {
        return;
    };

    fs::write(path, payload).ok();
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
    repo_name_from_path(std::env::current_dir().ok().as_deref())
        .unwrap_or_else(|| "unknown".to_string())
}

pub fn get_repo_attribution_for_connection(
    local_addr: SocketAddr,
    peer_addr: SocketAddr,
) -> RepoAttribution {
    let connection = connection_context(local_addr, peer_addr);

    if let Some(cwd) = connection.cwd.as_deref() {
        if let Some(repo) = repo_name_from_path(Some(cwd)) {
            return RepoAttribution {
                repo,
                source: "connection_cwd".to_string(),
                pid: connection.pid,
                cwd: connection.cwd,
            };
        }
    }

    RepoAttribution {
        repo: get_repo_name(),
        source: if connection.pid.is_some() {
            "process_cwd_fallback".to_string()
        } else {
            "current_dir_fallback".to_string()
        },
        pid: connection.pid,
        cwd: connection.cwd,
    }
}

fn repo_name_from_path(path: Option<&Path>) -> Option<String> {
    let path = path?;
    repo_name_from_git(path).or_else(|| directory_name(path))
}

fn repo_name_from_git(path: &Path) -> Option<String> {
    std::process::Command::new("git")
        .arg("-C")
        .arg(path)
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
        .and_then(|s| directory_name(Path::new(s.trim())))
}

fn directory_name(path: &Path) -> Option<String> {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty())
}

struct ConnectionContext {
    pid: Option<u32>,
    cwd: Option<PathBuf>,
}

fn connection_context(local_addr: SocketAddr, peer_addr: SocketAddr) -> ConnectionContext {
    if !is_loopback_connection(local_addr, peer_addr) {
        return ConnectionContext {
            pid: None,
            cwd: None,
        };
    }

    let pid = pid_for_connection(local_addr, peer_addr);
    let cwd = pid.and_then(cwd_for_pid);
    ConnectionContext { pid, cwd }
}

fn is_loopback_connection(local_addr: SocketAddr, peer_addr: SocketAddr) -> bool {
    local_addr.ip().is_loopback() && peer_addr.ip().is_loopback()
}

fn pid_for_connection(local_addr: SocketAddr, peer_addr: SocketAddr) -> Option<u32> {
    let output = std::process::Command::new("lsof")
        .args(["-nP", "-iTCP", "-sTCP:ESTABLISHED", "-F", "pn"])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8(output.stdout).ok()?;
    parse_client_pid_from_lsof(&stdout, local_addr, peer_addr)
}

fn cwd_for_pid(pid: u32) -> Option<PathBuf> {
    let output = std::process::Command::new("lsof")
        .arg("-a")
        .arg("-p")
        .arg(pid.to_string())
        .args(["-d", "cwd", "-Fn"])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8(output.stdout).ok()?;
    parse_cwd_from_lsof(&stdout)
}

fn parse_client_pid_from_lsof(
    stdout: &str,
    local_addr: SocketAddr,
    peer_addr: SocketAddr,
) -> Option<u32> {
    let mut current_pid = None;

    for line in stdout.lines() {
        if let Some(pid) = line.strip_prefix('p') {
            current_pid = pid.parse::<u32>().ok();
            continue;
        }

        let Some(name) = line.strip_prefix('n') else {
            continue;
        };

        if connection_name_matches(name, local_addr, peer_addr) {
            return current_pid;
        }
    }

    None
}

fn parse_cwd_from_lsof(stdout: &str) -> Option<PathBuf> {
    stdout
        .lines()
        .find_map(|line| line.strip_prefix('n'))
        .map(PathBuf::from)
}

fn connection_name_matches(name: &str, local_addr: SocketAddr, peer_addr: SocketAddr) -> bool {
    let expected = format!(
        "{}:{}->{}:{}",
        format_lsof_ip(peer_addr.ip()),
        peer_addr.port(),
        format_lsof_ip(local_addr.ip()),
        local_addr.port()
    );

    name == expected
}

fn format_lsof_ip(ip: IpAddr) -> String {
    match ip {
        IpAddr::V4(addr) => addr.to_string(),
        IpAddr::V6(addr) => format!("[{}]", addr),
    }
}

#[cfg(test)]
mod tests {
    use super::{connection_name_matches, parse_client_pid_from_lsof, parse_cwd_from_lsof};
    use crate::proxy::types::{LogEntry, Provider};
    use std::net::{Ipv4Addr, SocketAddr};
    use std::path::PathBuf;

    #[test]
    fn matches_client_side_lsof_connection_name() {
        let local_addr = SocketAddr::from((Ipv4Addr::LOCALHOST, 8787));
        let peer_addr = SocketAddr::from((Ipv4Addr::LOCALHOST, 53123));

        assert!(connection_name_matches(
            "127.0.0.1:53123->127.0.0.1:8787",
            local_addr,
            peer_addr
        ));
        assert!(!connection_name_matches(
            "127.0.0.1:8787->127.0.0.1:53123",
            local_addr,
            peer_addr
        ));
    }

    #[test]
    fn parses_client_pid_from_lsof_output() {
        let stdout = "\
p111
n127.0.0.1:8787->127.0.0.1:53123
p222
n127.0.0.1:53123->127.0.0.1:8787
";
        let local_addr = SocketAddr::from((Ipv4Addr::LOCALHOST, 8787));
        let peer_addr = SocketAddr::from((Ipv4Addr::LOCALHOST, 53123));

        assert_eq!(
            parse_client_pid_from_lsof(stdout, local_addr, peer_addr),
            Some(222)
        );
    }

    #[test]
    fn parses_cwd_from_lsof_output() {
        let stdout = "p222\nn/Users/nikoto/Desktop/code/ai/TeamPulse\n";
        assert_eq!(
            parse_cwd_from_lsof(stdout),
            Some(PathBuf::from("/Users/nikoto/Desktop/code/ai/TeamPulse"))
        );
    }

    #[test]
    fn serializes_repo_attribution_diagnostics() {
        let entry = LogEntry {
            ts: 1,
            request_id: "req-1".to_string(),
            developer_id: "dev@example.com".to_string(),
            repo: "TailorUsage".to_string(),
            repo_source: "connection_cwd".to_string(),
            repo_pid: Some(12345),
            repo_cwd: Some("/Users/nikoto/Desktop/code/ai/TailorUsage".to_string()),
            provider: Provider::Anthropic,
            endpoint: "/v1/messages".to_string(),
            model: "claude-sonnet-4-6".to_string(),
            stream: true,
            status: 200,
            latency_ms: 42,
            input_tokens: 10,
            output_tokens: 12,
            stop_reason: "end_turn".to_string(),
            error_message: None,
        };

        let value = serde_json::to_value(entry).expect("serialize log entry");
        assert_eq!(
            value.get("repo_source").and_then(|value| value.as_str()),
            Some("connection_cwd")
        );
        assert_eq!(
            value.get("repo_pid").and_then(|value| value.as_u64()),
            Some(12345)
        );
        assert_eq!(
            value.get("repo_cwd").and_then(|value| value.as_str()),
            Some("/Users/nikoto/Desktop/code/ai/TailorUsage")
        );
    }
}
