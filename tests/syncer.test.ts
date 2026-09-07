import { describe, expect, it } from 'bun:test';
import { discoverInstalledTools } from '../src/syncer.js';

describe('syncer module', () => {
  it('discovers installed tools or returns empty array gracefully', async () => {
    const tools = await discoverInstalledTools();
    expect(Array.isArray(tools)).toBe(true);
  });
});
