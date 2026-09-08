#!/usr/bin/env node

import { Command } from 'commander';
import { execa } from 'execa';
import { buildContainerImage, verifyDockerAvailable } from './docker.js';
import { ensureProfileExists, registerServer } from './registrar.js';
import { resolveTool } from './resolver.js';
import { discoverInstalledTools } from './syncer.js';
import type { CliJsonOutput, CliOptions, CliSummary, CliToolResult } from './types.js';

/**
 * Compute CLI exit code according to Milestone 1 specifications:
 * - 0: All requested tool operations succeeded (or no tools to process).
 * - 1: Total failure (e.g. fatal error, preflight failure, or all tools failed).
 * - 2: Partial failure (at least 1 succeeded and at least 1 failed).
 */
export function computeExitCode(summary: CliSummary): number {
  if (summary.failed === 0) {
    return 0;
  }
  if (summary.succeeded === 0) {
    return 1;
  }
  return 2;
}

/**
 * Print decorative banner for a tool being processed in human mode.
 */
export function printBanner(input: string): void {
  console.log('\n======================================================');
  console.log(`==> Processing: ${input}`);
  console.log('======================================================');
}

/**
 * Emit strictly valid, machine-parseable JSON payload to stdout.
 */
export function emitJson(output: CliJsonOutput): void {
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

/**
 * Executes an asynchronous action while suppressing console.log if JSON mode is active.
 */
export async function withJsonSuppression<T>(
  isJson: boolean,
  action: () => Promise<T>,
): Promise<T> {
  if (!isJson) {
    return action();
  }
  const originalLog = console.log;
  console.log = () => {};
  try {
    return await action();
  } finally {
    console.log = originalLog;
  }
}

/**
 * Print human-readable summary for batch operations in non-JSON mode.
 */
export function printHumanSummary(summary: CliSummary, results: CliToolResult[]): void {
  console.log('\n--- Batch Summary ---');
  console.log(
    `Total: ${summary.total} | Succeeded: ${summary.succeeded} | Failed: ${summary.failed} | Skipped: ${summary.skipped}`,
  );
  for (const r of results) {
    const icon = r.status === 'success' ? '✔' : r.status === 'skipped' ? '⊘' : '❌';
    const detail = r.error ? ` (${r.error})` : r.imageTag ? ` [${r.imageTag}]` : '';
    console.log(`  ${icon} ${r.tool}: ${r.status}${detail}`);
  }
}

/**
 * Pre-flight check to verify Docker availability unless dry-run.
 */
export async function checkDockerPreflight(dryRun: boolean, isJson: boolean): Promise<boolean> {
  if (dryRun) return true;
  const isAvailable = await verifyDockerAvailable();
  if (!isAvailable) {
    if (!isJson) {
      console.error('❌ Docker daemon is not running. Please launch Docker Desktop and try again.');
    }
    return false;
  }
  return true;
}

/**
 * Helper to process a single tool/URL and return structured result.
 */
export async function processTool(
  input: string,
  profile: string,
  options: CliOptions,
): Promise<CliToolResult> {
  if (!options.json) {
    printBanner(input);
  }

  try {
    const meta = await resolveTool(input);
    if (!options.json) {
      console.log(`✔ Found component: ${meta.category}`);
      console.log(`✔ Go Package: ${meta.packagePath}`);
    }

    const noBuild = options.noBuild === true || (options as { build?: boolean }).build === false;
    if (!noBuild) {
      await buildContainerImage(meta, Boolean(options.dryRun));
    } else {
      if (!options.json) {
        console.log('==> Skipping Docker build (--no-build specified).');
      }
    }

    await registerServer(meta, profile, Boolean(options.dryRun));

    if (!options.json) {
      console.log(`\n🎉 Successfully registered '${meta.slug}-pp-mcp' into profile '${profile}'!`);
      if (meta.requiresAuth) {
        console.log(`👉 Secret required: ${meta.envKey}`);
        console.log(
          `   Set it in Docker Desktop or run: docker mcp secret set ${meta.slug}-pp-mcp.api_key="<YOUR_KEY>"`,
        );
      }
    }

    return {
      tool: input,
      status: 'success',
      imageTag: meta.imageTag,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!options.json) {
      console.error(`❌ Error processing '${input}': ${msg}`);
    }
    return {
      tool: input,
      status: 'failed',
      error: msg,
    };
  }
}

/**
 * Create and configure the Commander program instance.
 */
export function createProgram(): Command {
  const program = new Command();

  program
    .name('pp-docker')
    .description(
      'Auto-containerize and register printing-press-library MCP servers into Docker Desktop',
    )
    .version('0.1.0')
    .option(
      '-p, --profile <name>',
      'Target Docker MCP profile name',
      process.env.MCP_PROFILE || 'printing-press',
    )
    .option('--dry-run', 'Preview actions without building or modifying Docker', false)
    .option('--no-build', 'Skip building the Docker image, only register the YAML spec')
    .option('--json', 'Emit structured, machine-parseable JSON on stdout', false);

  // 1. Command: install
  program
    .command('install')
    .description('Install tool(s) via printing-press-library and register into Docker MCP')
    .argument('<tools...>', 'One or more tool names or release URLs')
    .option('--no-npm', 'Skip running upstream npm installer for native skill/cli', false)
    .option('--json', 'Emit structured, machine-parseable JSON on stdout', false)
    .action(async (tools: string[], _cmdOpts, cmd: Command) => {
      const opts = cmd.optsWithGlobals<CliOptions & { npm?: boolean }>();
      const profile = opts.profile || 'printing-press';
      const isJson = Boolean(opts.json);

      await withJsonSuppression(isJson, async () => {
        const noBuild = opts.noBuild === true || (opts as { build?: boolean }).build === false;
        if (!noBuild && !(await checkDockerPreflight(Boolean(opts.dryRun), isJson))) {
          if (isJson) {
            const results: CliToolResult[] = tools.map((tool) => ({
              tool,
              status: 'failed',
              error: 'Docker daemon is not running. Please launch Docker Desktop and try again.',
            }));
            const summary: CliSummary = {
              total: tools.length,
              succeeded: 0,
              failed: tools.length,
              skipped: 0,
            };
            emitJson({
              command: 'install',
              profile,
              dryRun: Boolean(opts.dryRun),
              results,
              summary,
            });
          }
          process.exitCode = 1;
          return;
        }

        const results: CliToolResult[] = [];
        for (const tool of tools) {
          if (opts.npm && !opts.dryRun) {
            if (!isJson) {
              console.log(`\n==> Installing native CLI/skill for '${tool}' via npx...`);
            }
            try {
              await execa('npx', ['-y', '@mvanhorn/printing-press-library', 'install', tool], {
                stdio: isJson ? 'ignore' : 'inherit',
              });
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              if (!isJson) {
                console.warn(`⚠️ Upstream installer warning for '${tool}': ${msg}`);
              }
            }
          }

          const res = await processTool(tool, profile, opts);
          results.push(res);
        }

        const summary: CliSummary = {
          total: results.length,
          succeeded: results.filter((r) => r.status === 'success').length,
          failed: results.filter((r) => r.status === 'failed').length,
          skipped: results.filter((r) => r.status === 'skipped').length,
        };

        const exitCode = computeExitCode(summary);

        if (isJson) {
          emitJson({
            command: 'install',
            profile,
            dryRun: Boolean(opts.dryRun),
            results,
            summary,
          });
        } else if (results.length > 1 || summary.failed > 0) {
          printHumanSummary(summary, results);
        }

        process.exitCode = exitCode;
      });
    });

  // 2. Command: register
  program
    .command('register')
    .description(
      'Register a tool or release URL directly to Docker MCP without installing native CLI',
    )
    .argument('<tools...>', 'One or more tool names, tags, or release URLs')
    .option('--json', 'Emit structured, machine-parseable JSON on stdout', false)
    .action(async (tools: string[], _cmdOpts, cmd: Command) => {
      const opts = cmd.optsWithGlobals<CliOptions>();
      const profile = opts.profile || 'printing-press';
      const isJson = Boolean(opts.json);

      await withJsonSuppression(isJson, async () => {
        const noBuild = opts.noBuild === true || (opts as { build?: boolean }).build === false;
        if (!noBuild && !(await checkDockerPreflight(Boolean(opts.dryRun), isJson))) {
          if (isJson) {
            const results: CliToolResult[] = tools.map((tool) => ({
              tool,
              status: 'failed',
              error: 'Docker daemon is not running. Please launch Docker Desktop and try again.',
            }));
            const summary: CliSummary = {
              total: tools.length,
              succeeded: 0,
              failed: tools.length,
              skipped: 0,
            };
            emitJson({
              command: 'register',
              profile,
              dryRun: Boolean(opts.dryRun),
              results,
              summary,
            });
          }
          process.exitCode = 1;
          return;
        }

        const results: CliToolResult[] = [];
        for (const tool of tools) {
          const res = await processTool(tool, profile, opts);
          results.push(res);
        }

        const summary: CliSummary = {
          total: results.length,
          succeeded: results.filter((r) => r.status === 'success').length,
          failed: results.filter((r) => r.status === 'failed').length,
          skipped: results.filter((r) => r.status === 'skipped').length,
        };

        const exitCode = computeExitCode(summary);

        if (isJson) {
          emitJson({
            command: 'register',
            profile,
            dryRun: Boolean(opts.dryRun),
            results,
            summary,
          });
        } else if (results.length > 1 || summary.failed > 0) {
          printHumanSummary(summary, results);
        }

        process.exitCode = exitCode;
      });
    });

  // 3. Command: sync
  program
    .command('sync')
    .description('Scan all installed printing-press CLIs and register missing ones into Docker MCP')
    .option('--json', 'Emit structured, machine-parseable JSON on stdout', false)
    .action(async (_cmdOpts, cmd: Command) => {
      const opts = cmd.optsWithGlobals<CliOptions>();
      const profile = opts.profile || 'printing-press';
      const isJson = Boolean(opts.json);

      await withJsonSuppression(isJson, async () => {
        if (!isJson) {
          console.log('==> Scanning for locally installed printing-press tools...');
        }
        const installed = await discoverInstalledTools();

        if (installed.length === 0) {
          if (isJson) {
            emitJson({
              command: 'sync',
              profile,
              dryRun: Boolean(opts.dryRun),
              results: [],
              summary: { total: 0, succeeded: 0, failed: 0, skipped: 0 },
            });
          } else {
            console.log('No printing-press tools detected in ~/.local/bin or via npm.');
            console.log('Install one using: pp-docker install <tool>');
          }
          process.exitCode = 0;
          return;
        }

        const noBuild = opts.noBuild === true || (opts as { build?: boolean }).build === false;
        if (!noBuild && !(await checkDockerPreflight(Boolean(opts.dryRun), isJson))) {
          if (isJson) {
            const results: CliToolResult[] = installed.map((tool) => ({
              tool,
              status: 'failed',
              error: 'Docker daemon is not running. Please launch Docker Desktop and try again.',
            }));
            const summary: CliSummary = {
              total: installed.length,
              succeeded: 0,
              failed: installed.length,
              skipped: 0,
            };
            emitJson({
              command: 'sync',
              profile,
              dryRun: Boolean(opts.dryRun),
              results,
              summary,
            });
          }
          process.exitCode = 1;
          return;
        }

        if (!opts.dryRun) {
          try {
            await ensureProfileExists(profile);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (isJson) {
              const results: CliToolResult[] = installed.map((tool) => ({
                tool,
                status: 'failed',
                error: `Failed to ensure profile '${profile}': ${msg}`,
              }));
              const summary: CliSummary = {
                total: installed.length,
                succeeded: 0,
                failed: installed.length,
                skipped: 0,
              };
              emitJson({
                command: 'sync',
                profile,
                dryRun: false,
                results,
                summary,
              });
            } else {
              console.error(`❌ Failed to ensure profile '${profile}': ${msg}`);
            }
            process.exitCode = 1;
            return;
          }
        }

        if (!isJson) {
          console.log(`Found ${installed.length} tool(s): ${installed.join(', ')}`);
        }

        const results: CliToolResult[] = [];
        for (const tool of installed) {
          const res = await processTool(tool, profile, opts);
          results.push(res);
        }

        const summary: CliSummary = {
          total: results.length,
          succeeded: results.filter((r) => r.status === 'success').length,
          failed: results.filter((r) => r.status === 'failed').length,
          skipped: results.filter((r) => r.status === 'skipped').length,
        };

        if (!isJson) {
          console.log(`\n✔ Sync complete across profile '${profile}'!`);
          if (!opts.dryRun) {
            try {
              await execa('docker', ['mcp', 'profile', 'show', profile], {
                stdio: 'inherit',
              });
            } catch {}
          }
          if (results.length > 1 || summary.failed > 0) {
            printHumanSummary(summary, results);
          }
        } else {
          emitJson({
            command: 'sync',
            profile,
            dryRun: Boolean(opts.dryRun),
            results,
            summary,
          });
        }

        const exitCode = computeExitCode(summary);
        process.exitCode = exitCode;
      });
    });

  return program;
}

const program = createProgram();

const isDirectRun =
  Boolean(import.meta.main) ||
  (process.argv[1]
    ? process.argv[1].endsWith('/cli.js') || process.argv[1].endsWith('/cli.ts')
    : false);

if (isDirectRun) {
  program.parseAsync(process.argv).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { program };
