import { afterEach, describe, expect, it } from 'bun:test';
import { resetRegistryCache } from '#resolver.js';
import type { CommandExecutor, SecretDefinition, ToolMeta } from '#types.js';
import { checkKeystore, verifyMcpContainer, verifyTool } from '#verifier.js';

describe('checkKeystore', () => {
  it('returns required false and allConfigured true when secrets array is empty', async () => {
    const res = await checkKeystore([]);
    expect(res.required).toBe(false);
    expect(res.allConfigured).toBe(true);
    expect(res.secrets).toHaveLength(0);
  });

  it('detects when all secrets exist in keystore output', async () => {
    const secrets: SecretDefinition[] = [
      { name: 'slack-pp-mcp.bot_token', env: 'SLACK_BOT_TOKEN', example: '' },
      { name: 'slack-pp-mcp.user_token', env: 'SLACK_USER_TOKEN', example: '' },
    ];

    const mockExecutor: CommandExecutor = async () => ({
      stdout: ['docker/mcp/slack-pp-mcp.bot_token', 'docker/mcp/slack-pp-mcp.user_token'].join(
        '\n',
      ),
      exitCode: 0,
    });

    const res = await checkKeystore(secrets, mockExecutor);
    expect(res.required).toBe(true);
    expect(res.allConfigured).toBe(true);
    expect(res.secrets[0].configured).toBe(true);
    expect(res.secrets[1].configured).toBe(true);
  });

  it('detects when secrets are missing from keystore output', async () => {
    const secrets: SecretDefinition[] = [
      { name: 'figma-pp-mcp.access_token', env: 'FIGMA_ACCESS_TOKEN', example: '' },
    ];

    const mockExecutor: CommandExecutor = async () => ({
      stdout: 'docker/mcp/other-tool.api_key\n',
      exitCode: 0,
    });

    const res = await checkKeystore(secrets, mockExecutor);
    expect(res.required).toBe(true);
    expect(res.allConfigured).toBe(false);
    expect(res.secrets[0].configured).toBe(false);
  });

  it('handles keystore execution error gracefully', async () => {
    const secrets: SecretDefinition[] = [
      { name: 'jules-pp-mcp.api_key', env: 'JULES_API_KEY', example: '' },
    ];

    const mockExecutor: CommandExecutor = async () => {
      throw new Error('Docker daemon not running');
    };

    const res = await checkKeystore(secrets, mockExecutor);
    expect(res.required).toBe(true);
    expect(res.allConfigured).toBe(false);
    expect(res.error).toContain('Docker daemon not running');
  });
});

describe('verifyMcpContainer', () => {
  const dummyMeta: ToolMeta = {
    slug: 'test-tool',
    title: 'Test Tool (Printing Press)',
    category: 'test/tool',
    packagePath: 'github.com/mvanhorn/test-tool',
    imageTag: 'printing-press/test-tool-mcp:latest',
    description: 'Test MCP server',
    secrets: [],
  };

  it('returns error when image is not available locally', async () => {
    const mockExecutor: CommandExecutor = async (_file, args = []) => {
      if (args[0] === 'image' && args[1] === 'inspect') {
        throw new Error('No such image');
      }
      return { stdout: '', exitCode: 0 };
    };

    const res = await verifyMcpContainer(dummyMeta, mockExecutor);
    expect(res.imageAvailable).toBe(false);
    expect(res.containerStarted).toBe(false);
    expect(res.error).toContain('not found locally');
  });

  it('returns parsed handshake and toolsCount when container succeeds', async () => {
    const initResponse = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'Test Server', version: '1.2.3' },
      },
    });

    const toolsResponse = JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      result: {
        tools: [{ name: 'tool_a' }, { name: 'tool_b' }],
      },
    });

    const mockExecutor: CommandExecutor = async (_file, args = []) => {
      if (args[0] === 'image' && args[1] === 'inspect') {
        return { stdout: '[]', exitCode: 0 };
      }
      if (args[0] === 'run') {
        return {
          stdout: `${initResponse}\n${toolsResponse}\n`,
          exitCode: 0,
        };
      }
      return { stdout: '', exitCode: 0 };
    };

    const res = await verifyMcpContainer(dummyMeta, mockExecutor);
    expect(res.imageAvailable).toBe(true);
    expect(res.containerStarted).toBe(true);
    expect(res.protocolVersion).toBe('2024-11-05');
    expect(res.serverName).toBe('Test Server');
    expect(res.serverVersion).toBe('1.2.3');
    expect(res.toolsCount).toBe(2);
  });

  it('handles invalid JSON-RPC response from container', async () => {
    const mockExecutor: CommandExecutor = async (_file, args = []) => {
      if (args[0] === 'image' && args[1] === 'inspect') {
        return { stdout: '[]', exitCode: 0 };
      }
      if (args[0] === 'run') {
        return {
          stdout: 'Server crashed on startup\n',
          exitCode: 0,
        };
      }
      return { stdout: '', exitCode: 0 };
    };

    const res = await verifyMcpContainer(dummyMeta, mockExecutor);
    expect(res.imageAvailable).toBe(true);
    expect(res.containerStarted).toBe(true);
    expect(res.error).toContain('did not respond with valid MCP initialize');
  });

  it('handles container execution exception', async () => {
    const mockExecutor: CommandExecutor = async (_file, args = []) => {
      if (args[0] === 'image' && args[1] === 'inspect') {
        return { stdout: '[]', exitCode: 0 };
      }
      if (args[0] === 'run') {
        throw new Error('container exited with code 137 (OOM)');
      }
      return { stdout: '', exitCode: 0 };
    };

    const res = await verifyMcpContainer(dummyMeta, mockExecutor);
    expect(res.imageAvailable).toBe(true);
    expect(res.containerStarted).toBe(false);
    expect(res.error).toContain('code 137');
  });
});

describe('verifyTool', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    resetRegistryCache();
  });

  it('handles tool resolution failure', async () => {
    globalThis.fetch = (async () => new Response(null, { status: 404 })) as typeof fetch;

    const res = await verifyTool('nonexistent-tool');
    expect(res.status).toBe('failed');
    expect(res.error).toContain('Resolution failed');
  });

  it('returns verified in dry-run mode without invoking Docker', async () => {
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
                description: 'Live scores',
                mcp: { auth_type: 'none', env_vars: [] },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(null, { status: 404 });
    }) as typeof fetch;

    const res = await verifyTool('espn', true);
    expect(res.status).toBe('verified');
    expect(res.keystore.required).toBe(false);
    expect(res.runtime.containerStarted).toBe(true);
  });

  it('returns failed status when required secrets are missing from keystore', async () => {
    globalThis.fetch = (async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes('registry.json')) {
        return new Response(
          JSON.stringify({
            entries: [
              {
                name: 'jules',
                category: 'developer-tools',
                path: 'library/developer-tools/jules',
                description: 'Jules Planning API',
                mcp: { auth_type: 'api_key', env_vars: ['JULES_API_KEY'] },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(null, { status: 404 });
    }) as typeof fetch;

    const mockExecutor: CommandExecutor = async (_file, args = []) => {
      if (args[0] === 'pass' && args[1] === 'ls') {
        return { stdout: '', exitCode: 0 };
      }
      return { stdout: '', exitCode: 0 };
    };

    const res = await verifyTool('jules', false, mockExecutor);
    expect(res.status).toBe('failed');
    expect(res.keystore.allConfigured).toBe(false);
    expect(res.error).toContain('Missing required secret(s) in Docker keystore');
  });

  it('returns verified when keystore is satisfied and container handshake succeeds', async () => {
    globalThis.fetch = (async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes('registry.json')) {
        return new Response(
          JSON.stringify({
            entries: [
              {
                name: 'jules',
                category: 'developer-tools',
                path: 'library/developer-tools/jules',
                description: 'Jules Planning API',
                mcp: { auth_type: 'api_key', env_vars: ['JULES_API_KEY'] },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(null, { status: 404 });
    }) as typeof fetch;

    const initResponse = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'Jules', version: '2026.8.1' },
      },
    });
    const toolsResponse = JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      result: { tools: [{ name: 'task_create' }] },
    });

    const mockExecutor: CommandExecutor = async (_file, args = []) => {
      if (args[0] === 'pass' && args[1] === 'ls') {
        return { stdout: 'docker/mcp/jules-pp-mcp.api_key\n', exitCode: 0 };
      }
      if (args[0] === 'image' && args[1] === 'inspect') {
        return { stdout: '[]', exitCode: 0 };
      }
      if (args[0] === 'run') {
        return { stdout: `${initResponse}\n${toolsResponse}\n`, exitCode: 0 };
      }
      return { stdout: '', exitCode: 0 };
    };

    const res = await verifyTool('jules', false, mockExecutor);
    expect(res.status).toBe('verified');
    expect(res.keystore.allConfigured).toBe(true);
    expect(res.runtime.containerStarted).toBe(true);
    expect(res.runtime.toolsCount).toBe(1);
  });
});
