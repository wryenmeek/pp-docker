---
name: pp-docker
description: Build, sync, and register printing-press-library MCP servers into Docker Desktop. Use when containerizing tools, registering MCP specs into Docker Desktop profiles, or troubleshooting Docker MCP catalogs.
---

# pp-docker Workflow Skill

Use this skill to containerize printing-press tools and manage their registration in Docker Desktop's MCP Toolkit.

## Prerequisites
- Docker Desktop running (`docker info`)
- Node.js >= 20 or Bun >= 1.2
- `pp-docker` linked locally or executed via `npx github:wryenmeek/pp-docker`

## Commands

### 1. Sync All Installed Tools
```bash
pp-docker sync
```
*Discovers all locally installed printing-press tools, builds container images using `golang:alpine` (`go 1.27+`), and registers specs into profile `printing-press`.*

### 2. Register Specific Tool or Release URL
```bash
pp-docker register <tool_name_or_url>
```
*Examples:*
- `pp-docker register jules`
- `pp-docker register https://github.com/mvanhorn/printing-press-library/releases/tag/jules-current`

### 3. Dry-Run Verification
```bash
pp-docker sync --dry-run
pp-docker register jules --dry-run
```

### 4. Custom Profile Targeting
```bash
pp-docker sync -p <profile_name>
```

## Docker MCP Catalog Location
All generated server YAML specs reside in:
`~/.docker/mcp/catalogs/<slug>-pp-mcp.yaml`
and are registered via:
`docker mcp profile server add <profile> --server file://<slug>-pp-mcp.yaml`
