import { describe, expect, it } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import { createServerSpec, ensureProfileExists, registerServer } from '#registrar.js';
import type { CommandExecutor, ToolMeta } from '#types.js';

describe('registrar module', () => {
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

  describe('createServerSpec', () => {
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
  });

  describe('ensureProfileExists', () => {
    it('skips profile creation if profile is already in profile list', async () => {
      const calls: Array<{ file: string; args?: readonly string[] }> = [];
      const mockExecutor: CommandExecutor = async (file, args = []) => {
        calls.push({ file, args });
        return {
          stdout: JSON.stringify([{ name: 'existing-profile', id: 'existing-profile' }]),
          exitCode: 0,
        };
      };

      await ensureProfileExists('existing-profile', mockExecutor);

      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual({
        file: 'docker',
        args: ['mcp', 'profile', 'list', '--format', 'json'],
      });
    });

    it('creates profile if missing from profile list', async () => {
      const calls: Array<{ file: string; args?: readonly string[] }> = [];
      const mockExecutor: CommandExecutor = async (file, args = []) => {
        calls.push({ file, args });
        if (args[1] === 'profile' && args[2] === 'list') {
          return {
            stdout: JSON.stringify([{ name: 'other-profile' }]),
            exitCode: 0,
          };
        }
        return { stdout: 'profile created', exitCode: 0 };
      };

      await ensureProfileExists('new-profile', mockExecutor);

      expect(calls).toHaveLength(2);
      expect(calls[0].args).toEqual(['mcp', 'profile', 'list', '--format', 'json']);
      expect(calls[1]).toEqual({
        file: 'docker',
        args: ['mcp', 'profile', 'create', '--name', 'new-profile', '--id', 'new-profile'],
      });
    });

    it('falls back to creating profile when profile list command fails', async () => {
      const calls: Array<{ file: string; args?: readonly string[] }> = [];
      const mockExecutor: CommandExecutor = async (file, args = []) => {
        calls.push({ file, args });
        if (args[1] === 'profile' && args[2] === 'list') {
          throw new Error('list command failed');
        }
        return { stdout: 'profile created', exitCode: 0 };
      };

      await ensureProfileExists('fallback-profile', mockExecutor);

      expect(calls).toHaveLength(2);
      expect(calls[0].args).toEqual(['mcp', 'profile', 'list', '--format', 'json']);
      expect(calls[1].args).toEqual([
        'mcp',
        'profile',
        'create',
        '--name',
        'fallback-profile',
        '--id',
        'fallback-profile',
      ]);
    });

    it('gracefully swallows error when both list and fallback create fail', async () => {
      const mockExecutor: CommandExecutor = async (_file, args = []) => {
        if (args[1] === 'profile' && args[2] === 'list') {
          throw new Error('list command failed');
        }
        if (args[1] === 'profile' && args[2] === 'create') {
          throw new Error('profile already exists');
        }
        return { stdout: '', exitCode: 0 };
      };

      await expect(ensureProfileExists('failing-profile', mockExecutor)).resolves.toBeUndefined();
    });

    it('uses default execa executor without unhandled rejection', async () => {
      await expect(ensureProfileExists('test-profile')).resolves.toBeUndefined();
    });
  });

  describe('registerServer', () => {
    it('handles dry-run registration cleanly without writing files or calling executor', async () => {
      let executorCalled = false;
      const mockExecutor: CommandExecutor = async () => {
        executorCalled = true;
      };

      const res = await registerServer(
        dummyMeta,
        'test-profile',
        true,
        mockExecutor,
        '/tmp/catalogs',
      );
      expect(res.yamlPath).toBe(path.join('/tmp/catalogs', 'jules-pp-mcp.yaml'));
      expect(executorCalled).toBe(false);
    });

    it('handles dry-run registration with default profile and default catalogs directory', async () => {
      const res = await registerServer(dummyMeta, undefined, true);
      const expectedPath = path.join(
        os.homedir(),
        '.docker',
        'mcp',
        'catalogs',
        'jules-pp-mcp.yaml',
      );
      expect(res.yamlPath).toBe(expectedPath);
    });

    it('writes catalog spec and registers server with profile in isolated directory', async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pp-mcp-test-'));
      const calls: Array<{ file: string; args?: readonly string[] }> = [];

      try {
        const mockExecutor: CommandExecutor = async (file, args = []) => {
          calls.push({ file, args });
          if (args[1] === 'profile' && args[2] === 'list') {
            return {
              stdout: JSON.stringify([{ name: 'test-profile' }]),
              exitCode: 0,
            };
          }
          return { stdout: 'success', exitCode: 0 };
        };

        const res = await registerServer(dummyMeta, 'test-profile', false, mockExecutor, tmpDir);

        expect(res.yamlPath).toBe(path.join(tmpDir, 'jules-pp-mcp.yaml'));

        // Verify YAML was written to disk
        const fileContent = await fs.readFile(res.yamlPath, 'utf-8');
        const parsedSpec = YAML.parse(fileContent);
        expect(parsedSpec.name).toBe('jules-pp-mcp');
        expect(parsedSpec.image).toBe('printing-press/jules-mcp:latest');
        expect(parsedSpec.secrets).toHaveLength(1);

        // Verify executor calls
        expect(calls).toHaveLength(2);
        // First call: ensureProfileExists
        expect(calls[0].args).toEqual(['mcp', 'profile', 'list', '--format', 'json']);
        // Second call: docker mcp profile server add
        expect(calls[1]).toEqual({
          file: 'docker',
          args: [
            'mcp',
            'profile',
            'server',
            'add',
            'test-profile',
            '--server',
            'file://jules-pp-mcp.yaml',
          ],
        });
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    });

    it('propagates error when server add command fails', async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pp-mcp-test-'));

      try {
        const mockExecutor: CommandExecutor = async (_file, args = []) => {
          if (args[1] === 'profile' && args[2] === 'list') {
            return {
              stdout: JSON.stringify([{ name: 'test-profile' }]),
              exitCode: 0,
            };
          }
          if (args[1] === 'profile' && args[2] === 'server' && args[3] === 'add') {
            throw new Error('failed to add server to profile: server already exists');
          }
          return { stdout: '', exitCode: 0 };
        };

        await expect(
          registerServer(dummyMeta, 'test-profile', false, mockExecutor, tmpDir),
        ).rejects.toThrow('failed to add server to profile: server already exists');
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
