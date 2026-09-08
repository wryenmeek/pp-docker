import { describe, expect, it } from 'bun:test';
import { buildContainerImage, generateDockerfile, verifyDockerAvailable } from '#docker.js';
import type { CommandExecutor, ToolMeta } from '#types.js';

describe('docker module', () => {
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

  it('generates a valid multi-stage Dockerfile', () => {
    const dockerfile = generateDockerfile(dummyMeta);
    expect(dockerfile).toContain('FROM golang:alpine AS builder');
    expect(dockerfile).toContain(`go install ${dummyMeta.packagePath}@latest`);
    expect(dockerfile).toContain(
      `COPY --from=builder /go/bin/${dummyMeta.slug}-pp-mcp /usr/local/bin/mcp-server`,
    );
    expect(dockerfile).toContain('ENTRYPOINT ["/usr/local/bin/mcp-server"]');
    expect(dockerfile).toContain('CMD ["--transport", "stdio"]');
  });

  describe('verifyDockerAvailable', () => {
    it('returns true when docker info succeeds', async () => {
      const calls: Array<{ file: string; args?: readonly string[] }> = [];
      const mockExecutor: CommandExecutor = async (file, args) => {
        calls.push({ file, args });
        return { stdout: '24.0.7', exitCode: 0 };
      };

      const available = await verifyDockerAvailable(mockExecutor);
      expect(available).toBe(true);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual({
        file: 'docker',
        args: ['info', '--format', '{{.ServerVersion}}'],
      });
    });

    it('returns false when docker info throws an error', async () => {
      const mockExecutor: CommandExecutor = async () => {
        throw new Error('Docker daemon not running');
      };

      const available = await verifyDockerAvailable(mockExecutor);
      expect(available).toBe(false);
    });

    it('uses default execa executor when none provided', async () => {
      const isAvailable = await verifyDockerAvailable();
      expect(typeof isAvailable).toBe('boolean');
    });
  });

  describe('buildContainerImage', () => {
    it('handles dry-run builds without checking docker or building', async () => {
      let executorCalled = false;
      const mockExecutor: CommandExecutor = async () => {
        executorCalled = true;
      };

      await expect(buildContainerImage(dummyMeta, true, mockExecutor)).resolves.toBeUndefined();
      expect(executorCalled).toBe(false);
    });

    it('handles dry-run builds with default executor parameter', async () => {
      await expect(buildContainerImage(dummyMeta, true)).resolves.toBeUndefined();
    });

    it('throws informative error when docker daemon is offline', async () => {
      const mockExecutor: CommandExecutor = async (_file, args = []) => {
        if (args[0] === 'info') {
          throw new Error('connect ENOENT /var/run/docker.sock');
        }
        return { stdout: '', exitCode: 0 };
      };

      await expect(buildContainerImage(dummyMeta, false, mockExecutor)).rejects.toThrow(
        'Docker daemon is not running. Please launch Docker Desktop and try again.',
      );
    });

    it('executes docker build with stdin input when daemon is online', async () => {
      const calls: Array<{ file: string; args?: readonly string[]; options?: unknown }> = [];
      const mockExecutor: CommandExecutor = async (file, args, options) => {
        calls.push({ file, args, options });
        return { stdout: 'Successfully built image', exitCode: 0 };
      };

      await buildContainerImage(dummyMeta, false, mockExecutor);

      expect(calls).toHaveLength(2);
      expect(calls[0]).toEqual({
        file: 'docker',
        args: ['info', '--format', '{{.ServerVersion}}'],
        options: undefined,
      });
      expect(calls[1].file).toBe('docker');
      expect(calls[1].args).toEqual(['build', '-t', dummyMeta.imageTag, '-']);
      expect(calls[1].options?.input).toBe(generateDockerfile(dummyMeta));
    });

    it('propagates error when docker build fails', async () => {
      const mockExecutor: CommandExecutor = async (_file, args = []) => {
        if (args[0] === 'info') {
          return { stdout: '24.0.7', exitCode: 0 };
        }
        if (args[0] === 'build') {
          throw new Error('docker build failed: syntax error in Dockerfile');
        }
        return { stdout: '', exitCode: 0 };
      };

      await expect(buildContainerImage(dummyMeta, false, mockExecutor)).rejects.toThrow(
        'docker build failed: syntax error in Dockerfile',
      );
    });
  });
});
