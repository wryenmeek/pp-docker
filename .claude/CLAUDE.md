
<!-- BEGIN INFIGRAPH v2 -->
## Infigraph — Code Intelligence (auto-generated)

This project is indexed by Infigraph. Use Infigraph MCP tools FIRST for all code tasks.
Fall back to grep/Read only if Infigraph returns nothing or for non-code files.

### Tool Preferences
1. **`search`** for ALL code search — hybrid BM25+vector+grep in one call
2. **`get_doc_context`** before editing any function — returns source+callers+callees
3. **`trace_callers`** / **`find_all_references`** before refactoring — never grep for callers
4. **`trace_callees`** / **`transitive_impact`** for blast radius
5. Read files directly only for non-code files or Edit tool line-number context

### Subagent Rules
Do NOT spawn these agent types for code tasks — they lack MCP access:
- **Explore** → use `search`, `search_code`, `search_symbols` directly
- **Plan** → use `get_architecture`, `get_skeleton`, `get_stats` directly
- **code-reviewer** → use `get_doc_context`, `get_code_snippet`, `review` directly

For tasks requiring a subagent, use **general-purpose** — it has full MCP/infigraph access.

### Verbose tools — delegate to subagent
`get_architecture`, `transitive_impact`, `detect_dead_code`, `detect_clusters`,
`detect_clones`, `export_graph`, `query_graph`, `trace_callers`/`trace_callees` (deep),
`group_query`, `group_index`

### Context Compression
Tool outputs are automatically compressed to save context window budget.
- Compression scales with session length (Off → Summary → Aggressive → Minimal)
- `search` results are capped at Summary level to preserve result quality
- Security tools (`detect_security_issues`, `detect_taint_flows`, etc.) are never compressed
- `get_code_snippet` passes through uncompressed for edit accuracy
- No action needed — compression is transparent and automatic
<!-- END INFIGRAPH -->

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
