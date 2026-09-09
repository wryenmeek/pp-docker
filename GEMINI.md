<!-- infigraph-instructions -->
# Infigraph — Code Intelligence

This project is indexed by Infigraph. Use Infigraph tools FIRST for all code tasks. Fall back to grep/read only if Infigraph returns nothing or for non-code files.

## Rules
1. Check `list_projects` before indexing — don't re-index
2. **`search`** for ALL code search — hybrid BM25+vector+grep in one call, auto-escalates
3. **`get_doc_context`** before editing any function — returns source+callers+callees in one call
4. **`trace_callers`** / **`find_all_references`** before refactoring — never grep for callers
5. **`trace_callees`** / **`transitive_impact`** for blast radius — never manually trace call chains
6. Read files directly only for non-code files (configs, docs, manifests) or edit tool line-number context

## Workflows
- **Find code:** `search` → if need symbol detail: `get_code_snippet` or `symbol_context`
- **Before editing:** `get_doc_context`
- **Before refactoring:** `find_all_references` → `transitive_impact` → edit
- **Onboarding:** `index_project` → `get_architecture` → `get_stats`
- **Multi-repo:** `group_create` → `group_add` × N → `group_index` → `group_sync` → `group_link`

> Each tool description says what it replaces — check descriptions when unsure which tool to use.

## Session Continuity — MANDATORY
- **On session start:** MUST call `get_latest_session` to resume prior context
- **After context compaction:** if you see "continued from a previous conversation" or a compaction summary, IMMEDIATELY call `save_session` with whatever context survived before doing anything else
- **MUST call `save_session` IMMEDIATELY (before responding to the user)** when ANY of these occur. No session-end signal exists — if you don't save now, context is lost forever:
  1. **Finding** — root cause identified, discovered a bug, learned how something works
  2. **Milestone** — bug fixed and verified, feature committed, test passing, build green
  3. **Decision** — chose an approach, ruled something out, changed strategy
  4. **Task done** — any pending task from a prior session is completed
  5. **Periodic** — if you have NOT called `save_session` in the last 5 exchanges with the user, call it NOW regardless of whether anything dramatic happened. This is a hard rule, not a suggestion.
- Do NOT defer saves ("I'll save later"). Do NOT batch them. Do NOT wait for user to ask.
- "Later" does not exist — context compaction or session end can happen at any moment.
- Same-day saves merge: summary/pending_tasks overwrite, decisions append, files_touched union
- **Narrative dumps:** On every `save_session`, include `narrative` field with full session story — what was explored, found, reasoned, decided, and why. Chronological prose, not terse bullets. Written to `.infigraph/sessions/session_YYYY-MM-DD.md` and embedded for semantic search. On session start, if `get_latest_session` shows a narrative log path, read it when structured fields aren't enough context.
<!-- infigraph-instructions -->

---

# Project Guidelines — pp-docker

## 1. Quality & CI Stack
- **Linting & Formatting:** Biome (`bun run check` or `bun run check:fix`).
- **Type Checking:** TypeScript strict mode (`bun run typecheck`).
- **Dead Code & Hygiene:** Knip (`bun run knip` with unlisted binary exclusion).
- **Testing & Coverage:** Bun Test (`bun run test:coverage`).
- **All-in-one Gate:** Always run `bun run ci` before committing.

## 2. Architectural & Code Constraints
- **Subpath Imports:** Always use package subpath imports (`#* -> ./src/*` mapped in `package.json`, e.g. `#cli.js`, `#types.js`). Never use relative `../src/` imports in tests to comply with Infigraph `[SEC040] Path Traversal` checks.
- **Go Container Builder:** Multi-stage Dockerfiles must use `golang:alpine` (`go 1.27+`). Pinned older versions (e.g. `golang:1.24-alpine`) fail because upstream `printing-press-library` packages require `go >= 1.26.5` with `GOTOOLCHAIN=local`.
- **Docker MCP Catalogs:** Server YAML specs must be written to `~/.docker/mcp/catalogs/<slug>-pp-mcp.yaml`. Docker MCP Toolkit's `--server file://...` flag only resolves specs located under `~/.docker/mcp/catalogs/`.
- **Pre-flight Checks:** Always verify external daemons (e.g. `verifyDockerAvailable()`) upfront before iterating through tool operations to fail fast with actionable guidance.
- **Network Call Timeouts:** Wrap external CLI/network queries (e.g. `npx`) with explicit execution timeouts (`{ timeout: 2000 }`) to prevent network hangs during tests and scans.
