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
}
