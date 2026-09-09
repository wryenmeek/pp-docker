import { describe, expect, it } from 'bun:test';
import {
  buildContainerImage,
  generateDockerfile,
  startDockerDesktop,
  verifyDockerAvailable,
  waitForDockerReady,
} from '#docker.js';
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
      const calls: Array<{ file: string; args?: readonly string[]; options?: any }> = [];
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

  describe('startDockerDesktop', () => {
    it('invokes open -a Docker on darwin', async () => {
      const calls: Array<{ file: string; args?: readonly string[] }> = [];
      const mockExecutor: CommandExecutor = async (file, args) => {
        calls.push({ file, args });
        return {};
      };

      await startDockerDesktop(mockExecutor, 'darwin');

      expect(calls).toEqual([{ file: 'open', args: ['-a', 'Docker'] }]);
    });

    it('invokes cmd /c start "" "Docker Desktop" on win32', async () => {
      const calls: Array<{ file: string; args?: readonly string[] }> = [];
      const mockExecutor: CommandExecutor = async (file, args) => {
        calls.push({ file, args });
        return {};
      };

      await startDockerDesktop(mockExecutor, 'win32');

      expect(calls).toEqual([{ file: 'cmd', args: ['/c', 'start', '', 'Docker Desktop'] }]);
    });

    it('invokes systemctl --user start docker-desktop on linux when user unit succeeds', async () => {
      const calls: Array<{ file: string; args?: readonly string[] }> = [];
      const mockExecutor: CommandExecutor = async (file, args) => {
        calls.push({ file, args });
        return {};
      };

      await startDockerDesktop(mockExecutor, 'linux');

      expect(calls).toEqual([{ file: 'systemctl', args: ['--user', 'start', 'docker-desktop'] }]);
    });

    it('falls back to sudo systemctl start docker on linux when user unit fails', async () => {
      const calls: Array<{ file: string; args?: readonly string[] }> = [];
      const mockExecutor: CommandExecutor = async (file, args) => {
        calls.push({ file, args });
        if (file === 'systemctl') {
          throw new Error('user unit not found');
        }
        return {};
      };

      await startDockerDesktop(mockExecutor, 'linux');

      expect(calls).toEqual([
        { file: 'systemctl', args: ['--user', 'start', 'docker-desktop'] },
        { file: 'sudo', args: ['systemctl', 'start', 'docker'] },
      ]);
    });

    it('throws error for unsupported platform', async () => {
      const mockExecutor: CommandExecutor = async () => ({});

      await expect(startDockerDesktop(mockExecutor, 'freebsd' as NodeJS.Platform)).rejects.toThrow(
        'Unsupported platform for Docker auto-start: freebsd',
      );
    });
  });

  describe('waitForDockerReady', () => {
    it('Case 1: returns true immediately when Docker is already available (0 wait)', async () => {
      let tickCalls = 0;
      const mockExecutor: CommandExecutor = async () => ({
        stdout: '24.0.0',
      });

      const ready = await waitForDockerReady({
        timeoutMs: 10_000,
        intervalMs: 100,
        executor: mockExecutor,
        onTick: () => {
          tickCalls++;
        },
      });

      expect(ready).toBe(true);
      expect(tickCalls).toBe(0);
    });

    it('Case 2: returns true when Docker becomes available after 2 polling attempts', async () => {
      let attempts = 0;
      let tickCalls = 0;
      const ticks: number[] = [];

      const mockExecutor: CommandExecutor = async () => {
        attempts++;
        if (attempts <= 2) {
          throw new Error('daemon starting');
        }
        return { stdout: '24.0.0' };
      };

      const ready = await waitForDockerReady({
        timeoutMs: 5_000,
        intervalMs: 20,
        executor: mockExecutor,
        onTick: (elapsed, max) => {
          tickCalls++;
          ticks.push(elapsed);
          expect(max).toBe(5);
        },
      });

      expect(ready).toBe(true);
      expect(attempts).toBeGreaterThanOrEqual(3);
      expect(tickCalls).toBeGreaterThanOrEqual(1);
    });

    it('Case 3: returns false when Docker polling times out', async () => {
      let tickCalls = 0;
      const mockExecutor: CommandExecutor = async () => {
        throw new Error('daemon offline');
      };

      const ready = await waitForDockerReady({
        timeoutMs: 60,
        intervalMs: 20,
        executor: mockExecutor,
        onTick: () => {
          tickCalls++;
        },
      });

      expect(ready).toBe(false);
      expect(tickCalls).toBeGreaterThan(0);
    });

    it('works with default options when Docker is available', async () => {
      const mockExecutor: CommandExecutor = async () => ({
        stdout: '24.0.0',
      });
      const ready = await waitForDockerReady({ executor: mockExecutor });
      expect(ready).toBe(true);
    });
  });
});
