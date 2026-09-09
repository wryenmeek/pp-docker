import type { McpMetadata, SecretDefinition, ToolMeta } from './types.js';

/**
 * Extracts a bare tool slug from a URL, release tag, or bare name.
 * e.g., "https://github.com/mvanhorn/printing-press-library/releases/tag/jules-current" -> "jules"
 * e.g., "jules-current" -> "jules"
 * e.g., "jules" -> "jules"
 */
export function normalizeSlug(input: string): string {
  let cleaned = input.trim();

  // Handle URL format
  if (cleaned.includes('/releases/tag/')) {
    const parts = cleaned.split('/releases/tag/');
    cleaned = parts[parts.length - 1].split('/')[0];
  }

  // Handle -current suffix
  if (cleaned.endsWith('-current')) {
    cleaned = cleaned.replace(/-current$/, '');
  }

  // Strip path prefixes if provided (e.g., library/developer-tools/jules)
  if (cleaned.includes('/')) {
    const parts = cleaned.split('/');
    cleaned = parts[parts.length - 1];
  }

  // Strip -pp-cli or -pp-mcp suffix if user passed full binary name
  cleaned = cleaned.replace(/-pp-(cli|mcp)$/, '');

  return cleaned.toLowerCase();
}

/**
 * Derives a Docker MCP secret name suffix from an environment variable name.
 * e.g., "FIGMA_ACCESS_TOKEN" -> "access_token"
 * e.g., "SLACK_BOT_TOKEN" -> "bot_token"
 * e.g., "JULES_API_KEY" -> "api_key"
 */
export function envVarToSecretSuffix(envVar: string, slug: string): string {
  const upperSlug = slug.toUpperCase().replace(/-/g, '_');
  let suffix = envVar;

  // Strip the tool slug prefix if present (e.g., FIGMA_ACCESS_TOKEN -> ACCESS_TOKEN)
  if (suffix.startsWith(`${upperSlug}_`)) {
    suffix = suffix.slice(upperSlug.length + 1);
  }
  // Also handle common prefixes without the slug (e.g., PRINTING_PRESS_CLIENT_PROFILE)
  if (suffix === envVar) {
    // No slug prefix found — use the full env var name lowercased
    suffix = envVar;
  }

  return suffix.toLowerCase();
}

/**
 * Builds a SecretDefinition array from upstream env_vars.
 *
 * Design: When multiple env vars are alternatives for the same credential
 * (all share the tool slug prefix AND have credential-type-only suffixes like
 * ACCESS_TOKEN, API_TOKEN, API_KEY), only the first (primary) is used.
 * When they have purpose-distinguishing prefixes (e.g., BOT_TOKEN, USER_TOKEN),
 * they are distinct credentials and all are included.
 */
export function buildSecrets(slug: string, envVars: string[]): SecretDefinition[] {
  if (!envVars || envVars.length === 0) {
    return [];
  }

  // Filter out meta/config env vars that are never actual secrets
  const secretEnvVars = envVars.filter((v) => v !== 'PRINTING_PRESS_CLIENT_PROFILE');

  if (secretEnvVars.length === 0) {
    return [];
  }

  const upperSlug = slug.toUpperCase().replace(/-/g, '_');

  // Check if all env vars share the tool slug prefix
  const allSharePrefix = secretEnvVars.every((v) => v.startsWith(`${upperSlug}_`));

  // Even if all share prefix, check if suffixes indicate they're distinct
  // credentials (e.g., BOT_TOKEN vs USER_TOKEN) rather than format alternatives
  // (e.g., ACCESS_TOKEN vs API_TOKEN vs API_KEY)
  let areAlternatives = false;
  if (allSharePrefix && secretEnvVars.length > 1) {
    const suffixes = secretEnvVars.map((v) => v.slice(upperSlug.length + 1));
    // Credential-type-only suffixes that indicate format alternatives
    const credentialTypeSuffixes = new Set([
      'API_KEY',
      'API_TOKEN',
      'ACCESS_TOKEN',
      'TOKEN',
      'KEY',
      'SECRET',
      'SECRET_KEY',
      'BEARER_AUTH',
      'AUTH_TOKEN',
    ]);
    areAlternatives = suffixes.every((s) => credentialTypeSuffixes.has(s));
  }

  const effectiveVars = areAlternatives ? [secretEnvVars[0]] : secretEnvVars;

  return effectiveVars.map((envVar) => {
    const suffix = envVarToSecretSuffix(envVar, slug);
    return {
      name: `${slug}-pp-mcp.${suffix}`,
      env: envVar,
      example: `your_${slug.replace(/-/g, '_')}_${suffix}`,
    };
  });
}

/** Cached registry data to avoid redundant fetches within a session. */
let registryCache: Array<{
  name: string;
  category: string;
  path: string;
  description?: string;
  mcp?: {
    auth_type?: string;
    env_vars?: string[];
    tool_count?: number;
  };
}> | null = null;

/**
 * Fetches and caches the full printing-press-library registry.
 */
async function fetchRegistry(): Promise<typeof registryCache> {
  if (registryCache !== null) {
    return registryCache;
  }

  try {
    const regRes = await fetch(
      'https://raw.githubusercontent.com/mvanhorn/printing-press-library/main/registry.json',
    );
    if (regRes.ok) {
      const regData = (await regRes.json()) as {
        entries?: typeof registryCache;
      };
      registryCache = regData.entries ?? null;
      return registryCache;
    }
  } catch {
    // Network / API rate limit - fall through
  }

  return null;
}

/**
 * Resets the registry cache. Exposed for testing.
 */
export function resetRegistryCache(): void {
  registryCache = null;
}

/**
 * Resolves full tool metadata using GitHub Releases API and registry.json.
 */
export async function resolveTool(input: string): Promise<ToolMeta> {
  const slug = normalizeSlug(input);
  const tag = `${slug}-current`;

  let categoryPath = '';
  let description = `Agent-native ${slug} MCP server`;
  let mcpMeta: McpMetadata | undefined;

  // 1. Attempt GitHub Release API for category path
  try {
    const res = await fetch(
      `https://api.github.com/repos/mvanhorn/printing-press-library/releases/tags/${tag}`,
      { headers: { 'User-Agent': 'pp-docker' } },
    );
    if (res.ok) {
      const data = (await res.json()) as { body?: string; name?: string };
      const body = data.body || '';
      const match = body.match(/Auto-built artifacts for \*\*([^*]+)\*\*/);
      if (match?.[1]) {
        categoryPath = match[1]; // e.g. "developer-tools/jules"
      }
    }
  } catch {
    // Network / API rate limit - fall through to registry.json
  }

  // 2. Fetch full registry for category path fallback AND mcp metadata
  const registry = await fetchRegistry();

  if (registry) {
    const found = registry.find(
      (e) => e.name.toLowerCase() === slug || e.path?.endsWith(`/${slug}`),
    );

    if (found) {
      if (!categoryPath) {
        categoryPath = found.path.replace(/^library\//, '');
      }
      if (found.description) {
        description = found.description;
      }
      if (found.mcp) {
        mcpMeta = {
          authType: found.mcp.auth_type ?? 'none',
          envVars: found.mcp.env_vars ?? [],
          toolCount: found.mcp.tool_count,
        };
      }
    }
  }

  if (!categoryPath) {
    throw new Error(
      `Could not resolve tool '${slug}' in printing-press-library catalog. Please verify the tool name.`,
    );
  }

  // 3. Build secrets from upstream metadata or fallback to heuristic
  let secrets: SecretDefinition[];
  if (mcpMeta) {
    if (mcpMeta.authType === 'none' && mcpMeta.envVars.length === 0) {
      secrets = [];
    } else {
      secrets = buildSecrets(slug, mcpMeta.envVars);
    }
  } else {
    // Fallback: no registry data available, use legacy single-key heuristic
    const envKey = `${slug.toUpperCase().replace(/-/g, '_')}_API_KEY`;
    secrets = [
      {
        name: `${slug}-pp-mcp.api_key`,
        env: envKey,
        example: `your_${slug.replace(/-/g, '_')}_api_key`,
      },
    ];
  }

  const title = `${slug.charAt(0).toUpperCase() + slug.slice(1)} (Printing Press)`;

  return {
    slug,
    title,
    category: categoryPath,
    packagePath: `github.com/mvanhorn/printing-press-library/library/${categoryPath}/cmd/${slug}-pp-mcp`,
    imageTag: `printing-press/${slug}-mcp:latest`,
    description,
    secrets,
    mcpMeta,
  };
}
