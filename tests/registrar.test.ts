import { describe, expect, it } from 'bun:test';
import { createServerSpec, registerServer } from '#registrar.js';
import type { ToolMeta } from '#types.js';

describe('createServerSpec', () => {
  const dummyMeta: ToolMeta = {
    slug: 'jules',
    title: 'Jules (Printing Press)',
    category: 'developer-tools/jules',
    packagePath:
      'github.com/mvanhorn/printing-press-library/library/developer-tools/jules/cmd/jules-pp-mcp',
    imageTag: 'printing-press/jules-mcp:latest',
    envKey: 'JULES_API_KEY',
    description: 'Jules Planning & Progress API for async coding tasks',
    requiresAuth: true,
  };

  it('generates a valid Docker MCP Server Spec with on-demand lifecycle', () => {
    const spec = createServerSpec(dummyMeta);

    expect(spec.name).toBe('jules-pp-mcp');
    expect(spec.title).toBe('Jules (Printing Press)');
    expect(spec.type).toBe('server');
    expect(spec.image).toBe('printing-press/jules-mcp:latest');
    expect(spec.longLived).toBe(false); // Must be false for on-demand spin-up / spin-down
    expect(spec.volumes).toEqual(['jules-data:/data']);
    expect(spec.secrets).toHaveLength(1);
    expect(spec.secrets?.[0]).toEqual({
      name: 'jules-pp-mcp.api_key',
      env: 'JULES_API_KEY',
      example: 'your_jules_api_key',
    });
  });

  it('omits secrets when authentication is not required', () => {
    const unauthMeta: ToolMeta = {
      ...dummyMeta,
      slug: 'espn',
      requiresAuth: false,
    };

    const spec = createServerSpec(unauthMeta);
    expect(spec.secrets).toBeUndefined();
  });

  it('handles dry-run registration cleanly', async () => {
    const res = await registerServer(dummyMeta, 'test-profile', true);
    expect(res.yamlPath).toContain('jules-pp-mcp.yaml');
  });
});
