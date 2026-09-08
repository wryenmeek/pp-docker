import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execa } from 'execa';
import YAML from 'yaml';
import type { DockerMcpServerSpec, ToolMeta } from './types.js';

/**
 * Builds the Docker MCP Server specification object.
 */
export function createServerSpec(meta: ToolMeta): DockerMcpServerSpec {
  const spec: DockerMcpServerSpec = {
    name: `${meta.slug}-pp-mcp`,
    title: meta.title,
    type: 'server',
    image: meta.imageTag,
    description: meta.description,
    longLived: false,
    volumes: [`${meta.slug}-data:/data`],
  };

  if (meta.requiresAuth) {
    spec.secrets = [
      {
        name: `${meta.slug}-pp-mcp.api_key`,
        env: meta.envKey,
        example: `your_${meta.slug}_api_key`,
      },
    ];
  }

  return spec;
}

/**
 * Ensures that the requested Docker MCP profile exists.
 */
export async function ensureProfileExists(profile: string): Promise<void> {
  try {
    const listRes = await execa('docker', ['mcp', 'profile', 'list', '--format', 'json']);
    if (!listRes.stdout.includes(`"${profile}"`)) {
      console.log(`==> Creating profile '${profile}'...`);
      await execa('docker', ['mcp', 'profile', 'create', '--name', profile, '--id', profile]);
    }
  } catch {
    try {
      await execa('docker', ['mcp', 'profile', 'create', '--name', profile, '--id', profile]);
    } catch {
      // Profile likely already exists
    }
  }
}

/**
 * Writes the server YAML spec to ~/.docker/mcp/catalogs/<slug>-pp-mcp.yaml
 * and registers it with the specified Docker MCP profile.
 */
export async function registerServer(
  meta: ToolMeta,
  profile: string = 'printing-press',
  dryRun: boolean = false,
): Promise<{ yamlPath: string }> {
  const catalogsDir = path.join(os.homedir(), '.docker', 'mcp', 'catalogs');
  const yamlFileName = `${meta.slug}-pp-mcp.yaml`;
  const yamlPath = path.join(catalogsDir, yamlFileName);

  const spec = createServerSpec(meta);
  const yamlContent = YAML.stringify(spec);

  if (dryRun) {
    console.log(`[dry-run] Would write server YAML to: ${yamlPath}`);
    console.log(`[dry-run] Content:\n${yamlContent}`);
    console.log(`[dry-run] Would register with profile: ${profile}`);
    return { yamlPath };
  }

  // 1. Write YAML spec file into ~/.docker/mcp/catalogs/
  await fs.mkdir(catalogsDir, { recursive: true });
  await fs.writeFile(yamlPath, yamlContent, 'utf-8');
  console.log(`==> Server spec written to: ${yamlPath}`);

  // 2. Ensure profile exists
  await ensureProfileExists(profile);

  // 3. Register server in profile
  console.log(`==> Registering '${meta.slug}-pp-mcp' in profile '${profile}'...`);
  await execa('docker', [
    'mcp',
    'profile',
    'server',
    'add',
    profile,
    '--server',
    `file://${yamlFileName}`,
  ]);

  return { yamlPath };
}
