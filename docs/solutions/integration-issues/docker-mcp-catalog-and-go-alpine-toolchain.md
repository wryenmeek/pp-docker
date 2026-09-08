---
title: "Docker MCP Catalog Resolution and Go Alpine Toolchain Incompatibilities"
date: "2026-09-08"
category: "integration-issues"
module: "docker-registrar"
problem_type: "integration_issue"
component: "docker-mcp"
symptoms:
  - "Command failed with exit code 1: docker build: requires go >= 1.26.5 (running go 1.24.13; GOTOOLCHAIN=local)"
  - "Docker MCP CLI returned 'invalid server value: unsupported server type:' when pointing --server file:// outside ~/.docker/mcp/catalogs"
  - "Profile inspection failed with 'profile printing-press not found' when builds failed prior to registration"
root_cause: "toolchain_drift_and_undocumented_cli_contract"
resolution_type: "code_fix"
severity: "high"
tags:
  - "docker-mcp"
  - "golang-alpine"
  - "toolchain"
  - "catalogs"
  - "pre-flight"
---

# Docker MCP Catalog Resolution and Go Alpine Toolchain Incompatibilities

## Problem
When auto-containerizing and registering MCP servers from `printing-press-library` into Docker Desktop, `docker build` failed across all packages due to hardcoded Go 1.24 base images rejecting Go 1.26+ dependencies. Additionally, server spec registration failed because Docker MCP Toolkit strictly requires local YAML specs to resolve under `~/.docker/mcp/catalogs/`.

## Symptoms
- `go install ... requires go >= 1.26.5 (running go 1.24.13; GOTOOLCHAIN=local)` during container build.
- `docker mcp profile server add <profile> --server file://...` failed when the YAML spec was placed in `~/.docker/mcp/servers/`.
- Repetitive error output across every tool when Docker Desktop was offline, followed by misleading success banners.

## What Didn't Work
- Relying on Go's automatic toolchain download (`GOTOOLCHAIN=auto`) inside `golang:1.24-alpine`: Alpine uses musl libc rather than glibc, preventing Go from downloading standard precompiled toolchain binaries at build time.
- Storing server YAML manifests in `~/.docker/mcp/servers/` and pointing `--server file:///absolute/path/to/servers/<slug>.yaml`: Docker MCP Toolkit CLI returned `unsupported server type:` because `--server file://...` is strictly restricted to resolve under `~/.docker/mcp/catalogs/`.
- Passing only `--name <profile>` during profile creation: Docker MCP auto-slugified `printing-press` into `printing_press` (with an underscore), breaking subsequent profile inspection by name.

## Solution
1. **Upgraded Base Builder Image:** Changed the builder stage in `generateDockerfile()` from `golang:1.24-alpine` to `golang:alpine` (`go 1.27+`).
2. **Standardized Catalog Directory:** Relocated all generated YAML specs to `~/.docker/mcp/catalogs/${meta.slug}-pp-mcp.yaml` and registered them using `--server file://${meta.slug}-pp-mcp.yaml`.
3. **Explicit Profile Creation:** Updated profile creation to explicitly specify both `--name <profile>` and `--id <profile>` to prevent ID slugification mismatches.
4. **Proactive Pre-flight Check:** Added `verifyDockerAvailable()` at the start of `sync`, `register`, and `install` to immediately halt execution if Docker Desktop is stopped.

## Why This Works
- `golang:alpine` tracks the current stable Go release on Alpine (Go 1.27.1), which satisfies the `go.mod` directive (`go >= 1.26.5`) without requiring toolchain switching or glibc.
- Storing specs directly in `~/.docker/mcp/catalogs/` satisfies Docker MCP's file resolver constraints, allowing native registration and profile attachment.
- Explicit `--id` guarantees that `docker mcp profile show <profile>` matches the exact user-specified profile string.

## Prevention
- Always use rolling Alpine Go builder tags (`golang:alpine`) rather than pinning older minor versions when building downstream dependencies tracking Go tip.
- Never write Docker MCP server specs to arbitrary directories; always target `~/.docker/mcp/catalogs/`.
- Always verify external daemon availability upfront before looping through multi-step batch tasks.

## Related Issues
- Solved in commit `2b46d61`.
- Project guidelines formalized in `GEMINI.md` and `AGENTS.md`.
