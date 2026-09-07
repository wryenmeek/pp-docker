# pp-docker 🐳

[![CI](https://github.com/wryenmeek/pp-docker/actions/workflows/ci.yml/badge.svg)](https://github.com/wryenmeek/pp-docker/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Auto-containerize and register [Printing Press Library](https://github.com/mvanhorn/printing-press-library) MCP servers directly into **Docker Desktop MCP Toolkit** with **on-demand lifecycle management**.

---

## The Problem & The Solution

Normally, running dozens of MCP servers across multiple AI clients (Claude Desktop, Cursor, VS Code, Zed) means:
* Duplicating configuration files across every client.
* Keeping background Node/Go processes constantly running in RAM.
* Managing API tokens and credentials across multiple unencrypted config files.

**`pp-docker`** bridges the 500+ agent-native tools in the Printing Press Library to Docker's centralized **MCP Gateway**:
1. **Zero Client Clutter:** Your AI clients connect to Docker Desktop's gateway once (`MCP_DOCKER`).
2. **On-Demand Spin-Up / Spin-Down:** Servers are configured with `longLived: false`. Containers only spin up when a tool is called and terminate when idle.
3. **Encrypted Secrets:** API keys are stored in Docker Desktop's credential store instead of plain text JSON files.
4. **Persistent SQLite Caching:** Volumes are automatically provisioned so offline databases and mirror caches survive container teardown.

---

## Prerequisites

1. **Docker Desktop** (v4.38+) with **MCP Toolkit / Profiles** enabled:
   * Open **Docker Desktop Settings** > **Features in development** > check **MCP Toolkit** (or run `docker mcp feature enable profiles`).
2. **Node.js** >= 20 (if running locally; zero installation needed via `npx`).

---

## Quick Start (Zero Install)

Run directly via `npx`:

```bash
# Install tool via printing-press and register with Docker MCP
npx pp-docker install jules

# Install multiple tools at once
npx pp-docker install espn sentry cal-com
```

### Register directly from a GitHub Release URL:

```bash
npx pp-docker register https://github.com/mvanhorn/printing-press-library/releases/tag/jules-current
```

### Sync All Already-Installed Tools:

```bash
npx pp-docker sync
```

---

## CLI Usage

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

---

## Connecting Your AI Clients

Once your servers are registered in Docker Desktop, connect your clients with a single command:

```bash
docker mcp client connect claude-desktop
docker mcp client connect cursor
docker mcp client connect vscode
docker mcp client connect zed
```

---

## Supplying API Keys

If a tool requires an API token (e.g. `JULES_API_KEY`):

1. **Via CLI:**
   ```bash
   docker mcp secret set jules-pp-mcp.api_key="your-api-key-here"
   ```
2. **Via Docker Desktop UI:**
   * Go to **MCP Toolkit** in the sidebar.
   * Select your profile (default: `printing-press`).
   * Click on the server to enter the secret.

---

## Development & Contributing

Clone the repository and install dependencies:

```bash
git clone https://github.com/wryenmeek/pp-docker.git
cd pp-docker
npm install
```

### Run Tests:

```bash
npm test
```

### Build TypeScript:

```bash
npm run build
```

---

## License

[MIT](LICENSE) © 2026 wryenmeek and contributors
