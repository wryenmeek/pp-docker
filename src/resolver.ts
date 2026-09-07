import { ToolMeta } from './types.js';

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
 * Resolves full tool metadata using GitHub Releases API or registry.json.
 */
export async function resolveTool(input: string): Promise<ToolMeta> {
  const slug = normalizeSlug(input);
  const tag = `${slug}-current`;

  let categoryPath = '';
  let description = `Agent-native ${slug} MCP server`;
  let requiresAuth = true;

  // 1. Attempt GitHub Release API
  try {
    const res = await fetch(
      `https://api.github.com/repos/mvanhorn/printing-press-library/releases/tags/${tag}`,
      { headers: { 'User-Agent': 'pp-docker' } }
    );
    if (res.ok) {
      const data = (await res.json()) as { body?: string; name?: string };
      const body = data.body || '';
      const match = body.match(/Auto-built artifacts for \*\*([^*]+)\*\*/);
      if (match && match[1]) {
        categoryPath = match[1]; // e.g. "developer-tools/jules"
      }
    }
  } catch {
    // Network / API rate limit - fall through to registry.json
  }

  // 2. Fallback to raw registry.json
  if (!categoryPath) {
    try {
      const regRes = await fetch(
        'https://raw.githubusercontent.com/mvanhorn/printing-press-library/main/registry.json'
      );
      if (regRes.ok) {
        const regData = (await regRes.json()) as {
          entries?: Array<{
            name: string;
            category: string;
            description?: string;
            path: string;
            mcp?: { binary?: string };
          }>;
        };

        const found = regData.entries?.find(
          (e) => e.name.toLowerCase() === slug || e.path?.endsWith(`/${slug}`)
        );

        if (found) {
          categoryPath = found.path.replace(/^library\//, '');
          if (found.description) {
            description = found.description;
          }
        }
      }
    } catch {
      // Fall through
    }
  }

  if (!categoryPath) {
    throw new Error(
      `Could not resolve tool '${slug}' in printing-press-library catalog. Please verify the tool name.`
    );
  }

  const envKey = `${slug.toUpperCase().replace(/-/g, '_')}_API_KEY`;
  const title = `${slug.charAt(0).toUpperCase() + slug.slice(1)} (Printing Press)`;

  return {
    slug,
    title,
    category: categoryPath,
    packagePath: `github.com/mvanhorn/printing-press-library/library/${categoryPath}/cmd/${slug}-pp-mcp`,
    imageTag: `printing-press/${slug}-mcp:latest`,
    envKey,
    description,
    requiresAuth,
  };
}
