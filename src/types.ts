/**
 * Metadata for a resolved printing-press tool.
 */
export interface ToolMeta {
  slug: string;
  title: string;
  category: string;
  packagePath: string;
  imageTag: string;
  envKey: string;
  description: string;
  requiresAuth: boolean;
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
  secrets?: Array<{
    name: string;
    env: string;
    example: string;
  }>;
}

/**
 * Global CLI options.
 */
export interface CliOptions {
  profile?: string;
  dryRun?: boolean;
  noBuild?: boolean;
  json?: boolean;
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
