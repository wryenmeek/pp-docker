/**
 * A single secret required by an MCP server container.
 * Maps a Docker MCP secret name to the environment variable injected
 * into the container at runtime.
 */
export interface SecretDefinition {
  /** Docker MCP secret identifier, e.g. "figma-pp-mcp.access_token" */
  name: string;
  /** Environment variable name injected into the container, e.g. "FIGMA_ACCESS_TOKEN" */
  env: string;
  /** Human-readable example or placeholder value */
  example: string;
}

/**
 * Upstream MCP metadata from the printing-press-library registry.
 */
export interface McpMetadata {
  authType: string;
  envVars: string[];
  toolCount?: number;
}

/**
 * Metadata for a resolved printing-press tool.
 */
export interface ToolMeta {
  slug: string;
  title: string;
  category: string;
  packagePath: string;
  imageTag: string;
  description: string;
  /** Dynamic secrets derived from upstream registry env_vars. Empty array = no auth. */
  secrets: SecretDefinition[];
  /** Optional upstream MCP metadata for diagnostics. */
  mcpMeta?: McpMetadata;
}

/**
 * Docker MCP Gateway server specification format.
 */
export interface DockerMcpServerSpec {
  name: string;
  title: string;
  type: 'server';
  image: string;
  description: string;
  longLived: boolean;
  volumes?: string[];
  secrets?: SecretDefinition[];
}

/**
 * Generic process execution interface compatible with execa.
 */
export type CommandExecutor = (
  file: string,
  args?: readonly string[],
  options?: any,
) => Promise<any> | any;

/**
 * Global CLI options.
 */
export interface CliOptions {
  profile?: string;
  dryRun?: boolean;
  noBuild?: boolean;
  json?: boolean;
  startDocker?: boolean;
}

/**
 * Result of processing a single tool.
 */
export interface CliToolResult {
  tool: string;
  status: 'success' | 'failed' | 'skipped';
  imageTag?: string;
  error?: string;
}

/**
 * Batch execution summary.
 */
export interface CliSummary {
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
}

/**
 * Structured JSON payload emitted on stdout when --json is specified.
 */
export interface CliJsonOutput {
  command: 'sync' | 'register' | 'install';
  profile: string;
  dryRun: boolean;
  results: CliToolResult[];
  summary: CliSummary;
}
