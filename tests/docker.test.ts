import { describe, expect, it } from 'bun:test';
import { buildContainerImage, generateDockerfile, verifyDockerAvailable } from '#docker.js';
import type { ToolMeta } from '#types.js';

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
    expect(dockerfile).toContain('FROM golang:1.24-alpine AS builder');
    expect(dockerfile).toContain(`go install ${dummyMeta.packagePath}@latest`);
    expect(dockerfile).toContain(
      `COPY --from=builder /go/bin/${dummyMeta.slug}-pp-mcp /usr/local/bin/mcp-server`,
    );
    expect(dockerfile).toContain('ENTRYPOINT ["/usr/local/bin/mcp-server"]');
    expect(dockerfile).toContain('CMD ["--transport", "stdio"]');
  });

  it('handles dry-run builds without invoking docker', async () => {
    // Should resolve without throwing even if docker daemon is not mocked
    await expect(buildContainerImage(dummyMeta, true)).resolves.toBeUndefined();
  });

  it('checks docker availability', async () => {
    const isAvailable = await verifyDockerAvailable();
    expect(typeof isAvailable).toBe('boolean');
  });
});
