# TailorUsage

## What it does

TailorUsage is a macOS menu bar app for monitoring Claude and OpenAI usage. It shows provider usage limits, weekly activity, and model token counts with estimated costs, marking unpriced usage separately. It also provides controls to enable or disable the local proxy.

## How it works

The [React frontend](src/) calls [Tauri commands](src/lib/api.ts) implemented in the [Rust backend](src-tauri/src/). The [polling hook](src/hooks/usePolling.ts) combines local activity logs and Codex history with provider usage APIs and authenticated dashboard data.

An embedded [Anthropic/OpenAI proxy](src-tauri/src/proxy/) forwards requests and records activity in local JSONL logs. Enabling it updates shell profiles and supported client configurations (Claude Code and OpenCode) to route requests through the proxy; disabling it removes the managed configuration.

## Technology

- Frontend: React 19 and TypeScript, Vite for builds, Tailwind CSS for styling, Zustand for state, and Recharts for charts. See [frontend source](src/) and [package.json](package.json).
- Backend: Tauri 2 and Rust for the desktop app and commands, Tokio for async work, Hyper and Reqwest for HTTP, and SQLite via rusqlite for reading Codex activity. See [backend source](src-tauri/src/) and [Cargo.toml](src-tauri/Cargo.toml).
