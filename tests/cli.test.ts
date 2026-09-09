import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import readline from 'node:readline/promises';
import { execa } from 'execa';
import {
  checkDockerPreflight,
  computeExitCode,
  createProgram,
  emitJson,
  printBanner,
  printHumanSummary,
  processTool,
  promptUserToStartDocker,
  withJsonSuppression,
} from '#cli.js';
import type { CliJsonOutput, CliOptions, CliSummary, CliToolResult } from '#types.js';

describe('CLI Docker Pre-flight and Auto-start', () => {
  afterEach(() => {
    // Restore any mocked console methods
  });

  it('returns true immediately when dryRun is enabled', async () => {
    let verifyCalled = false;
    const options: CliOptions = { dryRun: true };

    const result = await checkDockerPreflight(options, {
      verifyAvailable: async () => {
        verifyCalled = true;
        return false;
      },
    });

    expect(result).toBe(true);
    expect(verifyCalled).toBe(false);
  });

  it('returns true immediately when Docker is already available', async () => {
    let verifyCalled = false;
    let startCalled = false;
    const options: CliOptions = { dryRun: false };

    const result = await checkDockerPreflight(options, {
      verifyAvailable: async () => {
        verifyCalled = true;
        return true;
      },
      startDesktop: async () => {
        startCalled = true;
      },
    });

    expect(result).toBe(true);
    expect(verifyCalled).toBe(true);
    expect(startCalled).toBe(false);
  });

  it('returns false when Docker is offline and auto-start is not requested (non-TTY)', async () => {
    const errorLogs: string[] = [];
    const consoleErrorSpy = spyOn(console, 'error').mockImplementation((msg) => {
      errorLogs.push(String(msg));
    });

    try {
      const options: CliOptions = { dryRun: false, startDocker: false };
      const result = await checkDockerPreflight(options, {
        verifyAvailable: async () => false,
        prompter: async () => false,
      });

      expect(result).toBe(false);
      expect(errorLogs.some((log) => log.includes('Docker daemon is not running'))).toBe(true);
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('emits JSON error when Docker is offline and json mode is enabled', async () => {
    const errorLogs: string[] = [];
    const consoleErrorSpy = spyOn(console, 'error').mockImplementation((msg) => {
      errorLogs.push(String(msg));
    });

    try {
      const options: CliOptions = {
        dryRun: false,
        startDocker: false,
        json: true,
      };
      const result = await checkDockerPreflight(options, {
        verifyAvailable: async () => false,
      });

      expect(result).toBe(false);
      expect(
        errorLogs.some((log) => {
          try {
            const parsed = JSON.parse(log);
            return parsed.error.includes('Docker daemon is not running');
          } catch {
            return false;
          }
        }),
      ).toBe(true);
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('starts Docker Desktop and polls for ready when --start-docker is passed', async () => {
    let startCalled = false;
    let waitCalled = false;
    const stdoutLogs: string[] = [];
    const consoleLogSpy = spyOn(console, 'log').mockImplementation((msg) => {
      stdoutLogs.push(String(msg));
    });

    try {
      const options: CliOptions = { dryRun: false, startDocker: true };
      const result = await checkDockerPreflight(options, {
        verifyAvailable: async () => false,
        startDesktop: async () => {
          startCalled = true;
        },
        waitForReady: async () => {
          waitCalled = true;
          return true;
        },
      });

      expect(result).toBe(true);
      expect(startCalled).toBe(true);
      expect(waitCalled).toBe(true);
      expect(stdoutLogs.some((log) => log.includes('Attempting to start Docker Desktop'))).toBe(
        true,
      );
    } finally {
      consoleLogSpy.mockRestore();
    }
  });

  it('prompts user and starts Docker Desktop when interactive prompter confirms', async () => {
    let startCalled = false;
    let waitCalled = false;
    let promptCalled = false;

    // Simulate TTY
    const origTTY = process.stdout.isTTY;
    process.stdout.isTTY = true;

    try {
      const options: CliOptions = { dryRun: false, startDocker: false };
      const result = await checkDockerPreflight(options, {
        verifyAvailable: async () => false,
        prompter: async () => {
          promptCalled = true;
          return true;
        },
        startDesktop: async () => {
          startCalled = true;
        },
        waitForReady: async () => {
          waitCalled = true;
          return true;
        },
      });

      expect(result).toBe(true);
      expect(promptCalled).toBe(true);
      expect(startCalled).toBe(true);
      expect(waitCalled).toBe(true);
    } finally {
      process.stdout.isTTY = origTTY;
    }
  });

  it('returns false when interactive prompter is refused by user', async () => {
    let startCalled = false;
    let promptCalled = false;
    const errorLogs: string[] = [];
    const consoleErrorSpy = spyOn(console, 'error').mockImplementation((msg) => {
      errorLogs.push(String(msg));
    });

    const origTTY = process.stdout.isTTY;
    process.stdout.isTTY = true;

    try {
      const options: CliOptions = { dryRun: false, startDocker: false };
      const result = await checkDockerPreflight(options, {
        verifyAvailable: async () => false,
        prompter: async () => {
          promptCalled = true;
          return false;
        },
        startDesktop: async () => {
          startCalled = true;
        },
      });

      expect(result).toBe(false);
      expect(promptCalled).toBe(true);
      expect(startCalled).toBe(false);
      expect(errorLogs.some((log) => log.includes('Docker daemon is not running'))).toBe(true);
    } finally {
      process.stdout.isTTY = origTTY;
      consoleErrorSpy.mockRestore();
    }
  });

  it('handles startDesktop failure gracefully (text mode)', async () => {
    const errorLogs: string[] = [];
    const consoleErrorSpy = spyOn(console, 'error').mockImplementation((msg) => {
      errorLogs.push(String(msg));
    });

    try {
      const options: CliOptions = { dryRun: false, startDocker: true };
      const result = await checkDockerPreflight(options, {
        verifyAvailable: async () => false,
        startDesktop: async () => {
          throw new Error('Launch failed: permission denied');
        },
      });

      expect(result).toBe(false);
      expect(
        errorLogs.some((log) => log.includes('Failed to start Docker Desktop: Launch failed')),
      ).toBe(true);
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('handles startDesktop failure gracefully (json mode)', async () => {
    const errorLogs: string[] = [];
    const consoleErrorSpy = spyOn(console, 'error').mockImplementation((msg) => {
      errorLogs.push(String(msg));
    });

    try {
      const options: CliOptions = {
        dryRun: false,
        startDocker: true,
        json: true,
      };
      const result = await checkDockerPreflight(options, {
        verifyAvailable: async () => false,
        startDesktop: async () => {
          throw new Error('Launch failed: permission denied');
        },
      });

      expect(result).toBe(false);
      expect(
        errorLogs.some((log) => {
          try {
            const parsed = JSON.parse(log);
            return parsed.error.includes('Failed to start Docker Desktop: Launch failed');
          } catch {
            return false;
          }
        }),
      ).toBe(true);
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('handles readiness polling timeout gracefully (text mode)', async () => {
    const errorLogs: string[] = [];
    const consoleErrorSpy = spyOn(console, 'error').mockImplementation((msg) => {
      errorLogs.push(String(msg));
    });

    try {
      const options: CliOptions = { dryRun: false, startDocker: true };
      const result = await checkDockerPreflight(options, {
        verifyAvailable: async () => false,
        startDesktop: async () => {},
        waitForReady: async (opts) => {
          opts?.onTick?.(2, 60);
          return false;
        },
      });

      expect(result).toBe(false);
      expect(
        errorLogs.some((log) => log.includes('Timed out waiting for Docker Desktop to be ready')),
      ).toBe(true);
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('handles readiness polling timeout gracefully (json mode)', async () => {
    const errorLogs: string[] = [];
    const consoleErrorSpy = spyOn(console, 'error').mockImplementation((msg) => {
      errorLogs.push(String(msg));
    });

    try {
      const options: CliOptions = {
        dryRun: false,
        startDocker: true,
        json: true,
      };
      const result = await checkDockerPreflight(options, {
        verifyAvailable: async () => false,
        startDesktop: async () => {},
        waitForReady: async () => false,
      });

      expect(result).toBe(false);
      expect(
        errorLogs.some((log) => {
          try {
            const parsed = JSON.parse(log);
            return parsed.error.includes('Timed out waiting for Docker Desktop to be ready');
          } catch {
            return false;
          }
        }),
      ).toBe(true);
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('triggers onTick handler during readiness wait when TTY is true', async () => {
    let writeOutput = '';
    const origWrite = process.stdout.write;
    process.stdout.write = ((chunk: any) => {
      writeOutput += String(chunk);
      return true;
    }) as any;

    const origTTY = process.stdout.isTTY;
    process.stdout.isTTY = true;

    try {
      const options: CliOptions = { dryRun: false, startDocker: true };
      const result = await checkDockerPreflight(options, {
        verifyAvailable: async () => false,
        startDesktop: async () => {},
        waitForReady: async (opts) => {
          opts?.onTick?.(4, 60);
          return true;
        },
      });

      expect(result).toBe(true);
      expect(writeOutput).toContain('Waiting for Docker Desktop... (4s / 60s)');
    } finally {
      process.stdout.write = origWrite;
      process.stdout.isTTY = origTTY;
    }
  });
});

describe('CLI Commander Program Configuration', () => {
  it('registers --start-docker option on the root program', () => {
    const prog = createProgram();
    const startDockerOpt = prog.options.find((opt) => opt.attributeName() === 'startDocker');
    expect(startDockerOpt).toBeDefined();
    expect(startDockerOpt?.flags).toContain('--start-docker');
  });

  it('registers --start-docker option on sync, register, and install commands', () => {
    const prog = createProgram();
    for (const cmdName of ['sync', 'register', 'install']) {
      const cmd = prog.commands.find((c) => c.name() === cmdName);
      expect(cmd).toBeDefined();
      const opt = cmd?.options.find((o) => o.attributeName() === 'startDocker');
      expect(opt).toBeDefined();
      expect(opt?.flags).toContain('--start-docker');
    }
  });
});

describe('CLI Subprocess Invocations', () => {
  const cliEntry = './src/cli.ts';

  it('displays --start-docker in global help output', async () => {
    const result = await execa('bun', [cliEntry, '--help']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('--start-docker');
    expect(result.stdout).toContain('Automatically launch Docker Desktop');
  });

  it('displays --start-docker in command help outputs', async () => {
    for (const cmd of ['sync', 'register', 'install']) {
      const result = await execa('bun', [cliEntry, cmd, '--help']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('--start-docker');
    }
  });

  it('runs sync with --dry-run cleanly without needing Docker daemon', async () => {
    const result = await execa('bun', [cliEntry, 'sync', '--dry-run']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Scanning for locally installed printing-press tools');
  });
});

describe('promptUserToStartDocker', () => {
  it('returns true when user presses Enter (empty string / default Y)', async () => {
    const origCreate = readline.createInterface;
    readline.createInterface = (() => ({
      question: async () => '',
      close: () => {},
    })) as any;

    try {
      const res = await promptUserToStartDocker();
      expect(res).toBe(true);
    } finally {
      readline.createInterface = origCreate;
    }
  });

  it('returns true when user answers y or yes', async () => {
    const origCreate = readline.createInterface;
    readline.createInterface = (() => ({
      question: async () => '  Y  ',
      close: () => {},
    })) as any;

    try {
      const res = await promptUserToStartDocker();
      expect(res).toBe(true);
    } finally {
      readline.createInterface = origCreate;
    }
  });

  it('returns false when user answers n or no', async () => {
    const origCreate = readline.createInterface;
    readline.createInterface = (() => ({
      question: async () => 'n',
      close: () => {},
    })) as any;

    try {
      const res = await promptUserToStartDocker();
      expect(res).toBe(false);
    } finally {
      readline.createInterface = origCreate;
    }
  });
});

describe('processTool helper', () => {
  it('processes tool in dry-run mode without errors', async () => {
    const res = await processTool('jules', 'test-profile', { dryRun: true });
    expect(res.status).toBe('success');
  });

  it('handles tool resolution failure gracefully', async () => {
    const errorLogs: string[] = [];
    const consoleErrorSpy = spyOn(console, 'error').mockImplementation((msg) => {
      errorLogs.push(String(msg));
    });
    try {
      await processTool('nonexistent-tool-xyz-123', 'test-profile', { dryRun: true });
      expect(errorLogs.some((l) => l.includes('Error processing'))).toBe(true);
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});

describe('CLI Exit Code Computation', () => {
  it('returns 0 when total is 0 (empty batch)', () => {
    const summary: CliSummary = {
      total: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
    };
    expect(computeExitCode(summary)).toBe(0);
  });

  it('returns 0 when all operations succeed', () => {
    const summary: CliSummary = {
      total: 3,
      succeeded: 3,
      failed: 0,
      skipped: 0,
    };
    expect(computeExitCode(summary)).toBe(0);
  });

  it('returns 1 when all operations fail', () => {
    const summary: CliSummary = {
      total: 2,
      succeeded: 0,
      failed: 2,
      skipped: 0,
    };
    expect(computeExitCode(summary)).toBe(1);
  });

  it('returns 2 when batch partially succeeds and partially fails', () => {
    const summary: CliSummary = {
      total: 3,
      succeeded: 2,
      failed: 1,
      skipped: 0,
    };
    expect(computeExitCode(summary)).toBe(2);
  });
});

describe('CLI Helpers and Suppression', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('suppresses console.log during withJsonSuppression', async () => {
    let logCalled = false;
    await withJsonSuppression(true, async () => {
      console.log('This should not appear in stdout');
      logCalled = true;
    });
    expect(logCalled).toBe(true);
  });

  it('allows console.log when isJson is false', async () => {
    let captured = '';
    const spy = spyOn(console, 'log').mockImplementation((msg?: unknown) => {
      captured += String(msg);
    });
    await withJsonSuppression(false, async () => {
      console.log('human mode log');
    });
    spy.mockRestore();
    expect(captured).toContain('human mode log');
  });

  it('formats decorative banners via printBanner in human mode', () => {
    let output = '';
    const spy = spyOn(console, 'log').mockImplementation((msg?: unknown) => {
      output += `${String(msg)}\n`;
    });
    printBanner('test-tool');
    spy.mockRestore();
    expect(output).toContain('Processing: test-tool');
    expect(output).toContain('======================================================');
  });

  it('prints human batch summary table', () => {
    let output = '';
    const spy = spyOn(console, 'log').mockImplementation((msg?: unknown) => {
      output += `${String(msg)}\n`;
    });
    const summary: CliSummary = {
      total: 2,
      succeeded: 1,
      failed: 1,
      skipped: 0,
    };
    const results: CliToolResult[] = [
      { tool: 'tool-a', status: 'success', imageTag: 'tag-a' },
      { tool: 'tool-b', status: 'failed', error: 'some error' },
    ];
    printHumanSummary(summary, results);
    spy.mockRestore();
    expect(output).toContain('Batch Summary');
    expect(output).toContain('Total: 2 | Succeeded: 1 | Failed: 1 | Skipped: 0');
    expect(output).toContain('tool-a: success [tag-a]');
    expect(output).toContain('tool-b: failed (some error)');
  });

  it('checks preflight returns true for dry-run', async () => {
    const result = await checkDockerPreflight(true, true);
    expect(result).toBe(true);
  });

  it('emits valid json to stdout via emitJson', () => {
    let written = '';
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      written += chunk.toString();
      return true;
    }) as typeof process.stdout.write;

    try {
      const payload: CliJsonOutput = {
        command: 'register',
        profile: 'test-profile',
        dryRun: true,
        results: [
          { tool: 'jules', status: 'success', imageTag: 'printing-press/jules-mcp:latest' },
        ],
        summary: { total: 1, succeeded: 1, failed: 0, skipped: 0 },
      };
      emitJson(payload);
      const parsed = JSON.parse(written.trim());
      expect(parsed.command).toBe('register');
      expect(parsed.profile).toBe('test-profile');
      expect(parsed.results[0].tool).toBe('jules');
      expect(parsed.summary.succeeded).toBe(1);
    } finally {
      process.stdout.write = originalWrite;
    }
  });

  it('processes tool in dry-run mode returning success', async () => {
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
      return new Response(null, { status: 404 });
    }) as typeof fetch;

    const opts: CliOptions = { dryRun: true, json: true };
    const res = await processTool('jules', 'printing-press', opts);
    expect(res.tool).toBe('jules');
    expect(res.status).toBe('success');
    expect(res.imageTag).toBe('printing-press/jules-mcp:latest');
  });

  it('processes tool error returning failed status', async () => {
    globalThis.fetch = (async () => {
      return new Response(null, { status: 404 });
    }) as typeof fetch;

    const opts: CliOptions = { dryRun: true, json: true };
    const res = await processTool('nonexistent-tool-xyz', 'printing-press', opts);
    expect(res.tool).toBe('nonexistent-tool-xyz');
    expect(res.status).toBe('failed');
    expect(res.error).toContain('Could not resolve tool');
  });
});

describe('Commander CLI Program Structure', () => {
  it('creates program instance with global options and commands', () => {
    const prog = createProgram();
    expect(prog.name()).toBe('pp-docker');

    const options = prog.options.map((o) => o.long);
    expect(options).toContain('--profile');
    expect(options).toContain('--dry-run');
    expect(options).toContain('--no-build');
    expect(options).toContain('--json');

    const commands = prog.commands.map((c) => c.name());
    expect(commands).toContain('install');
    expect(commands).toContain('register');
    expect(commands).toContain('sync');
  });
});

describe('E2E CLI Subprocess Execution (--json, --dry-run, exit codes)', () => {
  const cliEntry = './src/cli.ts';
  const runCli = (args: string[]) => execa('bun', [cliEntry, ...args]);

  it('pp-docker sync --dry-run --json emits valid JSON schema and exits 0', async () => {
    const result = await runCli(['sync', '--dry-run', '--json']);
    expect(result.exitCode).toBe(0);

    const parsed: CliJsonOutput = JSON.parse(result.stdout.trim());
    expect(parsed.command).toBe('sync');
    expect(parsed.profile).toBe('printing-press');
    expect(parsed.dryRun).toBe(true);
    expect(Array.isArray(parsed.results)).toBe(true);
    expect(parsed.summary).toBeDefined();
    expect(parsed.summary.total).toBe(parsed.results.length);
    expect(parsed.summary.succeeded).toBe(parsed.results.length);
    expect(parsed.summary.failed).toBe(0);
  });

  it('pp-docker register jules --dry-run --json emits valid JSON and exits 0', async () => {
    const result = await runCli(['register', 'jules', '--dry-run', '--json']);
    expect(result.exitCode).toBe(0);

    const parsed: CliJsonOutput = JSON.parse(result.stdout.trim());
    expect(parsed.command).toBe('register');
    expect(parsed.profile).toBe('printing-press');
    expect(parsed.dryRun).toBe(true);
    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0].tool).toBe('jules');
    expect(parsed.results[0].status).toBe('success');
    expect(parsed.results[0].imageTag).toBe('printing-press/jules-mcp:latest');
    expect(parsed.summary).toEqual({
      total: 1,
      succeeded: 1,
      failed: 0,
      skipped: 0,
    });
  });

  it('pp-docker register with non-existent tool exits 1 on full failure', async () => {
    try {
      await runCli(['register', 'invalidtool_test_99999', '--dry-run', '--json']);
      expect(true).toBe(false); // Should not reach here
    } catch (err: unknown) {
      const execErr = err as { exitCode: number; stdout: string };
      expect(execErr.exitCode).toBe(1);
      const parsed: CliJsonOutput = JSON.parse(execErr.stdout.trim());
      expect(parsed.command).toBe('register');
      expect(parsed.results).toHaveLength(1);
      expect(parsed.results[0].tool).toBe('invalidtool_test_99999');
      expect(parsed.results[0].status).toBe('failed');
      expect(parsed.results[0].error).toContain('Could not resolve tool');
      expect(parsed.summary).toEqual({
        total: 1,
        succeeded: 0,
        failed: 1,
        skipped: 0,
      });
    }
  });

  it('pp-docker register mixed batch exits 2 on partial failure', async () => {
    try {
      await runCli(['register', 'jules', 'invalidtool_test_99999', '--dry-run', '--json']);
      expect(true).toBe(false); // Should not reach here
    } catch (err: unknown) {
      const execErr = err as { exitCode: number; stdout: string };
      expect(execErr.exitCode).toBe(2);
      const parsed: CliJsonOutput = JSON.parse(execErr.stdout.trim());
      expect(parsed.command).toBe('register');
      expect(parsed.results).toHaveLength(2);

      const julesRes = parsed.results.find((r) => r.tool === 'jules');
      expect(julesRes?.status).toBe('success');

      const failRes = parsed.results.find((r) => r.tool === 'invalidtool_test_99999');
      expect(failRes?.status).toBe('failed');

      expect(parsed.summary).toEqual({
        total: 2,
        succeeded: 1,
        failed: 1,
        skipped: 0,
      });
    }
  });

  it('pp-docker install jules --dry-run --json emits valid JSON and exits 0', async () => {
    const result = await runCli(['install', 'jules', '--dry-run', '--json']);
    expect(result.exitCode).toBe(0);

    const parsed: CliJsonOutput = JSON.parse(result.stdout.trim());
    expect(parsed.command).toBe('install');
    expect(parsed.results[0].tool).toBe('jules');
    expect(parsed.results[0].status).toBe('success');
    expect(parsed.summary.succeeded).toBe(1);
  });
});
