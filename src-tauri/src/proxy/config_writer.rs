use std::fs;
use std::path::PathBuf;

const SENTINEL_START: &str = "# --- TailorUsage Proxy (managed) ---";
const SENTINEL_END: &str = "# --- End TailorUsage Proxy ---";
const LEGACY_SENTINEL_START: &str = "# --- Tailor Bar Proxy (managed) ---";
const LEGACY_SENTINEL_END: &str = "# --- End Tailor Bar Proxy ---";

fn home_dir() -> Option<PathBuf> {
    std::env::var("HOME").ok().map(PathBuf::from)
}

fn proxy_block(anthropic_port: u16, openai_port: u16) -> String {
    // OPENAI_BASE_URL must include /v1 — the OpenAI SDK and OpenCode append
    // only the resource path (e.g. /chat/completions) to this value.
    // ANTHROPIC_BASE_URL does NOT include /v1 — the Anthropic SDK adds it.
    format!(
        "{}\nexport ANTHROPIC_BASE_URL=\"http://127.0.0.1:{}\"\nexport OPENAI_BASE_URL=\"http://127.0.0.1:{}/v1\"\n{}",
        SENTINEL_START, anthropic_port, openai_port, SENTINEL_END
    )
}

/// Remove the sentinel block from a file's content.
fn remove_sentinel_block(content: &str) -> String {
    let mut result = String::new();
    let mut inside_block = false;

    for line in content.lines() {
        if line.trim() == SENTINEL_START || line.trim() == LEGACY_SENTINEL_START {
            inside_block = true;
            continue;
        }
        if line.trim() == SENTINEL_END || line.trim() == LEGACY_SENTINEL_END {
            inside_block = false;
            continue;
        }
        if !inside_block {
            result.push_str(line);
            result.push('\n');
        }
    }

    // Remove trailing extra newlines that were left by the block removal
    while result.ends_with("\n\n") {
        result.pop();
    }

    result
}

/// Write proxy env vars to shell profiles.
pub fn enable_shell_profiles(anthropic_port: u16, openai_port: u16) -> Result<(), String> {
    let home = home_dir().ok_or("Cannot determine home directory")?;
    let block = proxy_block(anthropic_port, openai_port);

    let profiles = vec![home.join(".zshrc"), home.join(".bashrc")];

    for profile_path in profiles {
        if !profile_path.exists()
            && profile_path
                .file_name()
                .map(|n| n == ".bashrc")
                .unwrap_or(false)
        {
            // Only write .bashrc if it already exists
            continue;
        }

        let existing = fs::read_to_string(&profile_path).unwrap_or_default();

        // Remove any existing block first
        let cleaned = if existing.contains(SENTINEL_START) {
            remove_sentinel_block(&existing)
        } else {
            existing
        };

        let new_content = format!("{}\n{}\n", cleaned.trim_end(), block);
        fs::write(&profile_path, new_content)
            .map_err(|e| format!("Failed to write {}: {}", profile_path.display(), e))?;
    }

    Ok(())
}

/// Remove proxy env vars from shell profiles.
pub fn disable_shell_profiles() -> Result<(), String> {
    let home = home_dir().ok_or("Cannot determine home directory")?;

    let profiles = vec![home.join(".zshrc"), home.join(".bashrc")];

    for profile_path in profiles {
        if !profile_path.exists() {
            continue;
        }

        let existing = fs::read_to_string(&profile_path).unwrap_or_default();
        if !existing.contains(SENTINEL_START) {
            continue;
        }

        let cleaned = remove_sentinel_block(&existing);
        fs::write(&profile_path, cleaned)
            .map_err(|e| format!("Failed to write {}: {}", profile_path.display(), e))?;
    }

    Ok(())
}

/// Set apiBaseUrl in ~/.claude.json for Claude Code.
pub fn enable_claude_config(port: u16) -> Result<(), String> {
    let home = home_dir().ok_or("Cannot determine home directory")?;
    let config_path = home.join(".claude.json");

    let mut config: serde_json::Value = if config_path.exists() {
        let data = fs::read_to_string(&config_path).map_err(|e| e.to_string())?;
        serde_json::from_str(&data).unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    config
        .as_object_mut()
        .ok_or("Invalid claude.json format")?
        .insert(
            "apiBaseUrl".to_string(),
            serde_json::Value::String(format!("http://127.0.0.1:{}", port)),
        );

    let pretty = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    fs::write(&config_path, pretty).map_err(|e| e.to_string())?;

    Ok(())
}

/// Remove apiBaseUrl from ~/.claude.json.
pub fn disable_claude_config() -> Result<(), String> {
    let home = home_dir().ok_or("Cannot determine home directory")?;
    let config_path = home.join(".claude.json");

    if !config_path.exists() {
        return Ok(());
    }

    let data = fs::read_to_string(&config_path).map_err(|e| e.to_string())?;
    let mut config: serde_json::Value =
        serde_json::from_str(&data).unwrap_or(serde_json::json!({}));

    if let Some(obj) = config.as_object_mut() {
        obj.remove("apiBaseUrl");
    }

    let pretty = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    fs::write(&config_path, pretty).map_err(|e| e.to_string())?;

    Ok(())
}
