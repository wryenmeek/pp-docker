import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import readline from 'node:readline/promises';
import { execa } from 'execa';
import { checkDockerPreflight, createProgram, processTool, promptUserToStartDocker } from '#cli.js';
import type { CliOptions } from '#types.js';

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
    await expect(processTool('jules', 'test-profile', { dryRun: true })).resolves.toBeUndefined();
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
