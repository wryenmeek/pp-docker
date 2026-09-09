<!-- infigraph-instructions -->
# Infigraph — Code Intelligence

> [!NOTE]
> **Tool Availability Condition**: Infigraph tools are active only when the Infigraph MCP server is registered in your client toolset. In environments where Infigraph MCP tools are not present (such as Google Antigravity or headless agents), fall back immediately to native file reading (`read_file`, `view_file`), search (`grep_search`, `find_by_name`), and git commands. Do not attempt invoking Infigraph tools if they are not listed in your registered tool definitions.

When Infigraph is available:
1. Check `list_projects` before indexing — don't re-index
2. **`search`** for ALL code search — hybrid BM25+vector+grep in one call, auto-escalates
3. **`get_doc_context`** before editing any function — returns source+callers+callees in one call
4. **`trace_callers`** / **`find_all_references`** before refactoring — never grep for callers
5. **`trace_callees`** / **`transitive_impact`** for blast radius — never manually trace call chains
6. Read files directly only for non-code files (configs, docs, manifests) or edit tool line-number context

## Session Continuity (When Infigraph MCP is present)
- Call `get_latest_session` on startup if available to resume prior context.
- Call `save_session` on milestone completions and findings if the tool is present.
<!-- infigraph-instructions -->

---

# Project Guidelines — pp-docker

## 1. Quality & CI Stack
- **Fast Preflight:** `bun run preflight` (<500ms — runs Knip, TypeScript typecheck, and unit test suite).
- **Linting & Formatting:** Biome (`bun run check` or `bun run check:fix`).
- **Type Checking:** TypeScript strict mode (`bun run typecheck`).
- **Dead Code & Hygiene:** Knip (`bun run knip` with unlisted binary exclusion).
- **Testing & Coverage:** Bun Test (`bun run test:coverage` or `bun run test:unit`).
- **Spend Telemetry Testing:** `bun run test:telemetry` (Python unit tests).
- **All-in-one Gate:** Always run `bun run ci` before committing.

## 2. Architectural & Code Constraints
- **Subpath Imports:** Always use package subpath imports (`#* -> ./src/*` mapped in `package.json`, e.g. `#cli.js`, `#types.js`, `#verifier.js`). Never use relative `../src/` imports in tests.
- **Go Container Builder:** Multi-stage Dockerfiles must use `golang:alpine` (`go 1.27+`). Pinned older versions fail because upstream `printing-press-library` packages require `go >= 1.26.5` with `GOTOOLCHAIN=local`.
- **Docker MCP Catalogs:** Server YAML specs must be written to `~/.docker/mcp/catalogs/<slug>-pp-mcp.yaml`. Docker MCP Toolkit's `--server file://...` flag only resolves specs located under `~/.docker/mcp/catalogs/`.
- **Pre-flight Checks:** Always verify external daemons (e.g. `verifyDockerAvailable()`) upfront before iterating through tool operations to fail fast with actionable guidance.
- **Network Call Timeouts:** Wrap external CLI/network queries (e.g. `npx`, GitHub API) with explicit execution timeouts (`{ timeout: 2000 }` or minimum 15,000ms for subprocess integration tests) to prevent hangs.

## 3. Antigravity Agent Fleet & Pre-Merge Rules
- **Deterministic Commit Receipts:** Every git commit created by an agent must include the standard git trailer:
  `Antigravity-Session-ID: <session-conversation-uuid>`
  *(Automatically enforced by the Antigravity PreToolUse harness hook).*
- **Pre-Merge Telemetry Gate:** Pull requests cannot merge to `main` without verified session spend telemetry and 0 unresolved review threads. Run `antigravity-telemetry post --pr <PR_NUMBER>` and satisfy `antigravity-telemetry verify --pr <PR_NUMBER>`.
- **Automated Branch & Worktree Pruning:** When merges complete, remote tracking branches and attached git worktrees are pruned via `antigravity-telemetry prune` (or `bun run prune`).
- **Agent Tooling Prerequisites:** Agents operating in this repo must use `bun >= 1.2`, `docker`, and `gh >= 2.40`.
