import { afterEach, describe, expect, it } from 'bun:test';
import {
  buildSecrets,
  envVarToSecretSuffix,
  normalizeSlug,
  resetRegistryCache,
  resolveTool,
} from '#resolver.js';

describe('normalizeSlug', () => {
  it('handles full GitHub release URLs', () => {
    expect(
      normalizeSlug(
        'https://github.com/mvanhorn/printing-press-library/releases/tag/jules-current',
      ),
    ).toBe('jules');
  });

  it('handles release tags ending in -current', () => {
    expect(normalizeSlug('jules-current')).toBe('jules');
    expect(normalizeSlug('espn-current')).toBe('espn');
  });

  it('handles bare slugs', () => {
    expect(normalizeSlug('jules')).toBe('jules');
    expect(normalizeSlug('cal-com')).toBe('cal-com');
  });

  it('strips binary suffixes if provided', () => {
    expect(normalizeSlug('jules-pp-cli')).toBe('jules');
    expect(normalizeSlug('cal-com-pp-mcp')).toBe('cal-com');
  });

  it('handles library category paths', () => {
    expect(normalizeSlug('library/developer-tools/jules')).toBe('jules');
  });
});

describe('envVarToSecretSuffix', () => {
  it('strips tool slug prefix and lowercases', () => {
    expect(envVarToSecretSuffix('FIGMA_ACCESS_TOKEN', 'figma')).toBe('access_token');
    expect(envVarToSecretSuffix('JULES_API_KEY', 'jules')).toBe('api_key');
    expect(envVarToSecretSuffix('SLACK_BOT_TOKEN', 'slack')).toBe('bot_token');
  });

  it('handles hyphenated slugs', () => {
    expect(envVarToSecretSuffix('CAL_COM_API_KEY', 'cal-com')).toBe('api_key');
  });

  it('uses full env var when slug prefix is absent', () => {
    expect(envVarToSecretSuffix('PRINTING_PRESS_CLIENT_PROFILE', 'flow')).toBe(
      'printing_press_client_profile',
    );
  });
});

describe('buildSecrets', () => {
  it('returns empty array for empty env vars', () => {
    expect(buildSecrets('espn', [])).toEqual([]);
  });

  it('builds single secret for single env var', () => {
    const secrets = buildSecrets('jules', ['JULES_API_KEY']);
    expect(secrets).toHaveLength(1);
    expect(secrets[0]).toEqual({
      name: 'jules-pp-mcp.api_key',
      env: 'JULES_API_KEY',
      example: 'your_jules_api_key',
    });
  });

  it('uses first env var only when all share slug prefix (alternatives)', () => {
    const secrets = buildSecrets('figma', [
      'FIGMA_ACCESS_TOKEN',
      'FIGMA_API_TOKEN',
      'FIGMA_API_KEY',
    ]);
    expect(secrets).toHaveLength(1);
    expect(secrets[0]).toEqual({
      name: 'figma-pp-mcp.access_token',
      env: 'FIGMA_ACCESS_TOKEN',
      example: 'your_figma_access_token',
    });
  });

  it('builds multiple secrets when env vars are distinct credentials', () => {
    const secrets = buildSecrets('slack', ['SLACK_BOT_TOKEN', 'SLACK_USER_TOKEN']);
    expect(secrets).toHaveLength(2);
    expect(secrets[0]).toEqual({
      name: 'slack-pp-mcp.bot_token',
      env: 'SLACK_BOT_TOKEN',
      example: 'your_slack_bot_token',
    });
    expect(secrets[1]).toEqual({
      name: 'slack-pp-mcp.user_token',
      env: 'SLACK_USER_TOKEN',
      example: 'your_slack_user_token',
    });
  });

  it('filters out PRINTING_PRESS_CLIENT_PROFILE when other env vars exist', () => {
    const secrets = buildSecrets('cosmos', ['PRINTING_PRESS_CLIENT_PROFILE', 'COSMOS_TOKEN']);
    expect(secrets).toHaveLength(1);
    expect(secrets[0].env).toBe('COSMOS_TOKEN');
  });

  it('keeps PRINTING_PRESS_CLIENT_PROFILE when it is the only env var', () => {
    const secrets = buildSecrets('flow', ['PRINTING_PRESS_CLIENT_PROFILE']);
    expect(secrets).toHaveLength(0); // Filtered out since it's a meta-config, not a secret
  });
});

describe('resolveTool', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    resetRegistryCache();
  });

  it('resolves metadata with dynamic secrets from registry', async () => {
    globalThis.fetch = (async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes('/releases/tags/jules-current')) {
        return new Response(
          JSON.stringify({
            name: 'jules (latest build)',
            body: 'Auto-built artifacts for **developer-tools/jules** at commit 82a35f508.',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (urlStr.includes('registry.json')) {
        return new Response(
          JSON.stringify({
            entries: [
              {
                name: 'jules',
                category: 'developer-tools',
                path: 'library/developer-tools/jules',
                description: 'Jules Planning & Progress API',
                mcp: {
                  auth_type: 'api_key',
                  env_vars: ['JULES_API_KEY'],
                  tool_count: 10,
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(null, { status: 404 });
    }) as typeof fetch;

    const meta = await resolveTool('jules-current');
    expect(meta.slug).toBe('jules');
    expect(meta.category).toBe('developer-tools/jules');
    expect(meta.packagePath).toBe(
      'github.com/mvanhorn/printing-press-library/library/developer-tools/jules/cmd/jules-pp-mcp',
    );
    expect(meta.imageTag).toBe('printing-press/jules-mcp:latest');
    expect(meta.secrets).toHaveLength(1);
    expect(meta.secrets[0]).toEqual({
      name: 'jules-pp-mcp.api_key',
      env: 'JULES_API_KEY',
      example: 'your_jules_api_key',
    });
    expect(meta.mcpMeta?.authType).toBe('api_key');
  });

  it('resolves multi-secret tool from registry', async () => {
    globalThis.fetch = (async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes('registry.json')) {
        return new Response(
          JSON.stringify({
            entries: [
              {
                name: 'slack',
                category: 'productivity',
                path: 'library/productivity/slack',
                description: 'Slack MCP server',
                mcp: {
                  auth_type: 'bearer_token',
                  env_vars: ['SLACK_BOT_TOKEN', 'SLACK_USER_TOKEN'],
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(null, { status: 404 });
    }) as typeof fetch;

    const meta = await resolveTool('slack');
    expect(meta.secrets).toHaveLength(2);
    expect(meta.secrets[0].env).toBe('SLACK_BOT_TOKEN');
    expect(meta.secrets[0].name).toBe('slack-pp-mcp.bot_token');
    expect(meta.secrets[1].env).toBe('SLACK_USER_TOKEN');
    expect(meta.secrets[1].name).toBe('slack-pp-mcp.user_token');
  });

  it('resolves no-auth tool with empty secrets array', async () => {
    globalThis.fetch = (async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes('registry.json')) {
        return new Response(
          JSON.stringify({
            entries: [
              {
                name: 'espn',
                category: 'media-and-entertainment',
                path: 'library/media-and-entertainment/espn',
                description: 'Live scores from ESPN',
                mcp: {
                  auth_type: 'none',
                  env_vars: [],
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(null, { status: 404 });
    }) as typeof fetch;

    const meta = await resolveTool('espn');
    expect(meta.slug).toBe('espn');
    expect(meta.secrets).toHaveLength(0);
    expect(meta.description).toBe('Live scores from ESPN');
  });

  it('falls back to single-key heuristic when registry is unavailable', async () => {
    globalThis.fetch = (async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes('/releases/tags/custom-tool-current')) {
        return new Response(
          JSON.stringify({
            name: 'custom-tool (latest build)',
            body: 'Auto-built artifacts for **developer-tools/custom-tool** at commit abc123.',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      // Registry fetch fails
      return new Response(null, { status: 404 });
    }) as typeof fetch;

    const meta = await resolveTool('custom-tool');
    expect(meta.slug).toBe('custom-tool');
    expect(meta.secrets).toHaveLength(1);
    expect(meta.secrets[0]).toEqual({
      name: 'custom-tool-pp-mcp.api_key',
      env: 'CUSTOM_TOOL_API_KEY',
      example: 'your_custom_tool_api_key',
    });
    expect(meta.mcpMeta).toBeUndefined();
  });

  it('throws error when tool is not found in catalog', async () => {
    globalThis.fetch = (async () => {
      return new Response(null, { status: 404 });
    }) as typeof fetch;

    expect(resolveTool('unknown-nonexistent-tool')).rejects.toThrow('Could not resolve tool');
  });
});
