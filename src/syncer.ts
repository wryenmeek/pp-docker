import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execa } from 'execa';

/**
 * Discovers currently installed printing-press tools on the host.
 * Checks ~/.local/bin and npm installed tools.
 */
export async function discoverInstalledTools(): Promise<string[]> {
  const tools = new Set<string>();

  // 1. Scan ~/.local/bin for *-pp-cli
  const localBin = path.join(os.homedir(), '.local', 'bin');
  try {
    const files = await fs.readdir(localBin);
    for (const file of files) {
      if (file.endsWith('-pp-cli')) {
        const slug = file.replace(/-pp-cli$/, '');
        tools.add(slug);
      }
    }
  } catch {
    // Directory might not exist yet
  }

  // 2. Query npx printing-press-library list --installed --json if available
  try {
    const { stdout } = await execa(
      'npx',
      ['-y', '@mvanhorn/printing-press-library', 'list', '--installed', '--json'],
      { timeout: 2000 },
    );
    const parsed = JSON.parse(stdout);
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (item.name) tools.add(item.name);
        else if (item.slug) tools.add(item.slug);
      }
    }
  } catch {
    // Ignore if npx command fails or is offline
  }

  return Array.from(tools).sort();
}
