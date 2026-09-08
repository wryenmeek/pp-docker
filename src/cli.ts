#!/usr/bin/env node

import { Command } from 'commander';
import { execa } from 'execa';
import { buildContainerImage, verifyDockerAvailable } from './docker.js';
import { ensureProfileExists, registerServer } from './registrar.js';
import { resolveTool } from './resolver.js';
import { discoverInstalledTools } from './syncer.js';
import type { CliOptions } from './types.js';

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
  .option('--no-build', 'Skip building the Docker image, only register the YAML spec', false);

/**
 * Pre-flight check to verify Docker availability unless dry-run.
 */
async function checkDockerPreflight(dryRun: boolean): Promise<boolean> {
  if (dryRun) return true;
  const isAvailable = await verifyDockerAvailable();
  if (!isAvailable) {
    console.error('❌ Docker daemon is not running. Please launch Docker Desktop and try again.');
    return false;
  }
  return true;
}

/**
 * Helper to process a single tool/URL
 */
async function processTool(input: string, profile: string, options: CliOptions) {
  console.log(`\n======================================================`);
  console.log(`==> Processing: ${input}`);
  console.log(`======================================================`);

  try {
    const meta = await resolveTool(input);
    console.log(`✔ Found component: ${meta.category}`);
    console.log(`✔ Go Package: ${meta.packagePath}`);

    if (!options.noBuild) {
      await buildContainerImage(meta, options.dryRun);
    } else {
      console.log(`==> Skipping Docker build (--no-build specified).`);
    }

    await registerServer(meta, profile, options.dryRun);

    console.log(`\n🎉 Successfully registered '${meta.slug}-pp-mcp' into profile '${profile}'!`);
    if (meta.requiresAuth) {
      console.log(`👉 Secret required: ${meta.envKey}`);
      console.log(
        `   Set it in Docker Desktop or run: docker mcp secret set ${meta.slug}-pp-mcp.api_key="<YOUR_KEY>"`,
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`❌ Error processing '${input}': ${msg}`);
  }
}

// 1. Command: install
program
  .command('install')
  .description('Install tool(s) via printing-press-library and register into Docker MCP')
  .argument('<tools...>', 'One or more tool names or release URLs')
  .option('--no-npm', 'Skip running upstream npm installer for native skill/cli', false)
  .action(async (tools: string[], cmdOptions) => {
    const opts = program.opts();
    const profile = opts.profile;

    if (!opts.noBuild && !(await checkDockerPreflight(opts.dryRun))) {
      process.exit(1);
    }

    for (const tool of tools) {
      // 1. Run upstream installer if not disabled
      if (cmdOptions.npm && !opts.dryRun) {
        console.log(`\n==> Installing native CLI/skill for '${tool}' via npx...`);
        try {
          await execa('npx', ['-y', '@mvanhorn/printing-press-library', 'install', tool], {
            stdio: 'inherit',
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`⚠️ Upstream installer warning for '${tool}': ${msg}`);
        }
      }

      // 2. Build & register with Docker MCP
      await processTool(tool, profile, opts);
    }
  });

// 2. Command: register
program
  .command('register')
  .description(
    'Register a tool or release URL directly to Docker MCP without installing native CLI',
  )
  .argument('<tools...>', 'One or more tool names, tags, or release URLs')
  .action(async (tools: string[]) => {
    const opts = program.opts();
    const profile = opts.profile;

    if (!opts.noBuild && !(await checkDockerPreflight(opts.dryRun))) {
      process.exit(1);
    }

    for (const tool of tools) {
      await processTool(tool, profile, opts);
    }
  });

// 3. Command: sync
program
  .command('sync')
  .description('Scan all installed printing-press CLIs and register missing ones into Docker MCP')
  .action(async () => {
    const opts = program.opts();
    const profile = opts.profile;

    console.log('==> Scanning for locally installed printing-press tools...');
    const installed = await discoverInstalledTools();

    if (installed.length === 0) {
      console.log('No printing-press tools detected in ~/.local/bin or via npm.');
      console.log('Install one using: pp-docker install <tool>');
      return;
    }

    if (!opts.noBuild && !(await checkDockerPreflight(opts.dryRun))) {
      process.exit(1);
    }

    if (!opts.dryRun) {
      await ensureProfileExists(profile);
    }

    console.log(`Found ${installed.length} tool(s): ${installed.join(', ')}`);

    for (const tool of installed) {
      await processTool(tool, profile, opts);
    }

    console.log(`\n✔ Sync complete across profile '${profile}'!`);
    if (!opts.dryRun) {
      try {
        await execa('docker', ['mcp', 'profile', 'show', profile], { stdio: 'inherit' });
      } catch {}
    }
  });

program.parse(process.argv);
