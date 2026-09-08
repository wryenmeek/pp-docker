import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { execa } from 'execa';
import {
  checkDockerPreflight,
  computeExitCode,
  createProgram,
  emitJson,
  printBanner,
  printHumanSummary,
  processTool,
  withJsonSuppression,
} from '#cli.js';
import type { CliJsonOutput, CliOptions, CliSummary, CliToolResult } from '#types.js';

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
    expect(parsed.summary.succeeded).toBe(0);
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
