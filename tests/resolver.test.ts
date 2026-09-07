import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { normalizeSlug, resolveTool } from '../src/resolver.js';

describe('normalizeSlug', () => {
  it('handles full GitHub release URLs', () => {
    expect(
      normalizeSlug(
        'https://github.com/mvanhorn/printing-press-library/releases/tag/jules-current'
      )
    ).toBe('jules');
  });

  it('handles release tags ending in -current', () => {
    expect(normalizeSlug('jules-current')).toBe('jules');
    expect(normalizeSlug('espn-current')).toBe('espn');
  });

  it('handles bare slugs', () => {
    expect(normalizeSlug('jules')).toBe('jules');
    expect(normalizeSlug('cal-com')).toBe('cal-com');
  });

  it('strips binary suffixes if provided', () => {
    expect(normalizeSlug('jules-pp-cli')).toBe('jules');
    expect(normalizeSlug('cal-com-pp-mcp')).toBe('cal-com');
  });

  it('handles library category paths', () => {
    expect(normalizeSlug('library/developer-tools/jules')).toBe('jules');
  });
});

describe('resolveTool', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('resolves metadata from GitHub release body', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/releases/tags/jules-current')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              name: 'jules (latest build)',
              body: 'Auto-built artifacts for **developer-tools/jules** at commit 82a35f508.',
            }),
        });
      }
      return Promise.resolve({ ok: false });
    });

    const meta = await resolveTool('jules-current');
    expect(meta.slug).toBe('jules');
    expect(meta.category).toBe('developer-tools/jules');
    expect(meta.packagePath).toBe(
      'github.com/mvanhorn/printing-press-library/library/developer-tools/jules/cmd/jules-pp-mcp'
    );
    expect(meta.imageTag).toBe('printing-press/jules-mcp:latest');
    expect(meta.envKey).toBe('JULES_API_KEY');
    expect(meta.requiresAuth).toBe(true);
  });

  it('falls back to registry.json if release tag fails', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('registry.json')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              entries: [
                {
                  name: 'espn',
                  category: 'media-and-entertainment',
                  path: 'library/media-and-entertainment/espn',
                  description: 'Live scores from ESPN',
                },
              ],
            }),
        });
      }
      // Release tag fails
      return Promise.resolve({ ok: false });
    });

    const meta = await resolveTool('espn');
    expect(meta.slug).toBe('espn');
    expect(meta.category).toBe('media-and-entertainment/espn');
    expect(meta.packagePath).toBe(
      'github.com/mvanhorn/printing-press-library/library/media-and-entertainment/espn/cmd/espn-pp-mcp'
    );
    expect(meta.imageTag).toBe('printing-press/espn-mcp:latest');
    expect(meta.description).toBe('Live scores from ESPN');
  });
});
