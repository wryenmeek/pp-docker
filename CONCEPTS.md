# Concepts

> Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

### Docker MCP Profile
A named grouping of Model Context Protocol servers configured inside Docker Desktop (e.g. `default`, `mct`, `printing-press`). Profiles define which MCP clients (Claude, Cursor, Gemini, etc.) have access to which containerized tools.

### Catalog Spec
A YAML specification residing under `~/.docker/mcp/catalogs/` declaring the container image, volume mounts, authentication secrets, and lifecycle settings (`longLived: false`) for an on-demand Docker MCP server.

### Printing Press MCP Server
A containerized Go binary implementing the Model Context Protocol stdio transport for a tool from `@mvanhorn/printing-press-library`, configured with dedicated persistent volume storage at `/data` (`XDG_DATA_HOME=/data`).

### Pre-flight Daemon Check
An upfront, zero-side-effect probe (`docker info`) executed before dispatching batch container or profile registration tasks to fail fast with actionable guidance when the background Docker daemon is stopped.
