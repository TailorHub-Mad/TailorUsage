pub mod config_writer;
pub mod logger;
pub mod server;
pub mod sse_parser;
pub mod types;
pub mod upstream;

use tokio::sync::watch;
use types::ProxyConfig;

/// Handle to a running proxy — drop or call `stop()` to shut down.
pub struct ProxyHandle {
    shutdown_tx: watch::Sender<bool>,
    /// Keeps the dedicated Tokio runtime alive; dropped last.
    _runtime: tokio::runtime::Runtime,
}

impl ProxyHandle {
    /// Gracefully stop both proxy listeners.
    pub fn stop(self) {
        // Signal listeners to exit.
        let _ = self.shutdown_tx.send(true);
        // Drop the runtime on a dedicated OS thread — dropping a Runtime inside an
        // async context (e.g. Tauri's async command handler) panics with
        // "Cannot drop a runtime in a context where blocking is not allowed".
        std::thread::spawn(move || drop(self._runtime));
    }
}

/// Start the dual proxy (Anthropic + OpenAI).
/// Returns a handle to stop it, or an error if ports are in use.
pub fn start(config: ProxyConfig) -> Result<ProxyHandle, String> {
    // Check port availability
    if !server::is_port_available(config.anthropic_port) {
        return Err(format!(
            "Port {} is already in use (Anthropic proxy)",
            config.anthropic_port
        ));
    }
    if !server::is_port_available(config.openai_port) {
        return Err(format!(
            "Port {} is already in use (OpenAI proxy)",
            config.openai_port
        ));
    }

    // Build a dedicated runtime so proxy::start() is safe to call from any thread,
    // including the macOS main thread where Tauri's setup() runs.
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .map_err(|e| e.to_string())?;

    let (shutdown_tx, shutdown_rx) = watch::channel(false);

    let anthropic_rx = shutdown_rx.clone();
    let anthropic_port = config.anthropic_port;
    runtime.spawn(async move {
        if let Err(e) =
            server::run_listener(types::Provider::Anthropic, anthropic_port, anthropic_rx).await
        {
            log::error!("Anthropic proxy error: {}", e);
        }
    });

    let openai_rx = shutdown_rx;
    let openai_port = config.openai_port;
    runtime.spawn(async move {
        if let Err(e) = server::run_listener(types::Provider::Openai, openai_port, openai_rx).await
        {
            log::error!("OpenAI proxy error: {}", e);
        }
    });

    // Write config files so new shells pick up the proxy
    if let Err(e) = config_writer::enable_shell_profiles(config.anthropic_port, config.openai_port)
    {
        log::warn!("Failed to update shell profiles: {}", e);
    }
    if let Err(e) = config_writer::enable_claude_config(config.anthropic_port) {
        log::warn!("Failed to update claude config: {}", e);
    }
    if let Err(e) = config_writer::enable_opencode_config(config.anthropic_port, config.openai_port)
    {
        log::warn!("Failed to update opencode config: {}", e);
    }
    if let Err(e) =
        config_writer::enable_opencode_wrappers(config.anthropic_port, config.openai_port)
    {
        log::warn!("Failed to install opencode wrappers: {}", e);
    }

    Ok(ProxyHandle {
        shutdown_tx,
        _runtime: runtime,
    })
}

/// Clean up config files when proxy is disabled.
pub fn cleanup_config() {
    if let Err(e) = config_writer::disable_shell_profiles() {
        log::warn!("Failed to clean shell profiles: {}", e);
    }
    if let Err(e) = config_writer::disable_claude_config() {
        log::warn!("Failed to clean claude config: {}", e);
    }
    if let Err(e) = config_writer::disable_opencode_config() {
        log::warn!("Failed to clean opencode config: {}", e);
    }
    if let Err(e) = config_writer::disable_opencode_wrappers() {
        log::warn!("Failed to clean opencode wrappers: {}", e);
    }
}
