# pp-docker 🐳

[![CI](https://github.com/wryenmeek/pp-docker/actions/workflows/ci.yml/badge.svg)](https://github.com/wryenmeek/pp-docker/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Bun](https://img.shields.io/badge/Runtime-Bun%201.4+-black?logo=bun)](https://bun.sh)
[![Biome](https://img.shields.io/badge/Linter-Biome-60a5fa?logo=biome)](https://biomejs.dev)
[![Docker MCP](https://img.shields.io/badge/Docker-MCP_Toolkit-2496ED?logo=docker)](https://docs.docker.com/ai/mcp-catalog-and-toolkit/)

Auto-containerize and register [Printing Press Library](https://github.com/mvanhorn/printing-press-library) MCP servers directly into **Docker Desktop MCP Toolkit** with **on-demand lifecycle management**.

---

## 💡 The Problem & The Solution

Normally, running dozens of Model Context Protocol (MCP) servers across multiple AI clients (Claude Desktop, Cursor, VS Code, Zed) leads to:
* **Config Spaghetti:** Duplicating configurations across `claude_desktop_config.json`, `.cursor/mcp.json`, and `.vscode/mcp.json`.
* **Resource Drain:** 10+ background Node/Go processes constantly running in RAM and draining battery even when idle.
* **Credential Sprawl:** Storing sensitive API tokens in plain-text JSON files across your home directory.

**`pp-docker`** bridges the 500+ agent-native tools in the Printing Press Library to Docker's centralized **MCP Gateway**:

```text
  [Claude Desktop] ──┐
  [Cursor]         ──┼──> [Docker Desktop MCP Gateway]
  [VS Code]        ──┤         (Single Endpoint)
  [Zed / Terminal] ──┘                 │
                                       ▼ (On Tool Call)
                         ┌───────────────────────────┐
                         │ Isolated Docker Container │
                         │   e.g. jules-pp-mcp       │
                         │   - Spins UP on call      │
                         │   - Persistent SQLite vol │
                         │   - Spins DOWN when idle  │
                         └───────────────────────────┘
```

1. **Zero Client Clutter:** Your AI clients connect to Docker Desktop's gateway once (`MCP_DOCKER`).
2. **On-Demand Spin-Up / Spin-Down:** Servers are configured with `longLived: false`. Containers only spin up when a tool is called and terminate when idle.
3. **Encrypted Secrets:** API keys are stored in Docker Desktop's credential store instead of plain-text JSON files.
4. **Persistent SQLite Caching:** Volumes (`<slug>-data:/data`) are automatically provisioned so offline databases and mirror caches survive container teardown.

---

## ⚡ Prerequisites

1. **Docker Desktop** (v4.38+) with **MCP Toolkit / Profiles** enabled:
   * Open **Docker Desktop Settings** > **Features in development** > check **MCP Toolkit** (or run `docker mcp feature enable profiles`).
   * Verify Docker is running: `docker info`
2. **Node.js** >= 20 or **Bun** >= 1.2 installed.

---

## 🚀 Quick Start

### 1. Run via npx (Direct from GitHub)

You can run `pp-docker` directly without cloning or installing:

```bash
# Sync all printing-press tools already installed on your machine
npx github:wryenmeek/pp-docker sync

# Install a tool via printing-press and containerize it for Docker MCP
npx github:wryenmeek/pp-docker install jules

# Install multiple tools in one shot
npx github:wryenmeek/pp-docker install espn sentry cal-com
```

### 2. Local Global Installation

If you cloned this repository locally, link it to your `$PATH`:

```bash
cd printing-press-docker
npm link  # or bun link
```

Now use `pp-docker` as a first-class command from any directory:

```bash
pp-docker sync
pp-docker install jules
```

---

## 📖 CLI Commands & Options

```text
Usage: pp-docker [options] [command]

Auto-containerize and register printing-press-library MCP servers into Docker Desktop

Options:
  -V, --version         output the version number
  -p, --profile <name>  Target Docker MCP profile name (default: "printing-press" or $MCP_PROFILE)
  --dry-run             Preview actions without building or modifying Docker (default: false)
  --no-build            Skip building the Docker image, only register the YAML spec (default: false)
  -h, --help            display help for command

Commands:
  install [options] <tools...>  Install tool(s) via printing-press-library and register into Docker MCP
  register <tools...>           Register a tool or release URL directly to Docker MCP without installing native CLI
  sync                          Scan all installed printing-press CLIs and register missing ones into Docker MCP
```

### Examples:

* **Preview what would be created (Dry Run):**
  ```bash
  pp-docker sync --dry-run
  ```

* **Register into an existing profile (e.g. `default` or `dev`):**
  ```bash
  pp-docker sync -p default
  pp-docker install jules -p dev
  ```

* **Register directly from a specific GitHub Release URL:**
  ```bash
  pp-docker register https://github.com/mvanhorn/printing-press-library/releases/tag/jules-current
  ```

---

## 🔌 Connecting Your AI Clients

Once your servers are registered in Docker Desktop, connect your AI clients with one command:

```bash
docker mcp client connect claude-desktop
docker mcp client connect cursor
docker mcp client connect vscode
docker mcp client connect zed
```

To list all connected clients and verify their status:
```bash
docker mcp client ls
```

---

## 🔐 Managing API Keys

If a tool requires an API token (e.g. `JULES_API_KEY`, `FIGMA_API_KEY`, `SLACK_API_KEY`):

### Option A: Via Docker CLI
```bash
docker mcp secret set jules-pp-mcp.api_key="your-api-key-here"
```

### Option B: Via Docker Desktop GUI
1. Open **Docker Desktop**.
2. Click **MCP Toolkit** in the sidebar.
3. Select your profile (e.g. `printing-press`).
4. Click on the server entry and paste your credentials.

---

## 🛠️ Troubleshooting

### 1. `Docker daemon is not running`
If you see this error during `sync` or `install`:
* Ensure Docker Desktop is open.
* On macOS, launch it from the terminal with:
  ```bash
  open -a Docker
  ```
* Verify it is responsive with `docker info`.

### 2. `npm error code E404` when running `npx pp-docker`
If `pp-docker` is not yet published to the public npm registry under your namespace:
* Run directly via GitHub:
  ```bash
  npx github:wryenmeek/pp-docker sync
  ```
* Or link it locally:
  ```bash
  cd printing-press-docker && npm link
  pp-docker sync
  ```

### 3. Verify Registered Servers in Docker Desktop
To inspect your profile and confirm all servers are attached:
```bash
docker mcp profile show printing-press
```

---

## 🧪 Development & Architecture

This repository uses modern, high-performance tooling:
* **Runtime & Testing:** [Bun](https://bun.sh) with native `bun:test` (100% function coverage).
* **Linter & Formatter:** [Biome](https://biomejs.dev) (Rust-powered, <10ms checks).
* **Dead Code & Dependency Hygiene:** [Knip](https://knip.dev).

### Quality & CI Commands:

```bash
# Run full CI pipeline locally (Biome + Typecheck + Knip + Bun Test with Coverage)
bun run ci

# Run tests and generate coverage report
bun run test:coverage

# Lint and format
bun run check
bun run check:fix

# Typecheck with TypeScript
bun run typecheck

# Audit for dead code and unused dependencies
bun run knip

# Build TypeScript distribution
bun run build
```

---

## 📄 License

[MIT](LICENSE) © 2026 wryenmeek and contributors
