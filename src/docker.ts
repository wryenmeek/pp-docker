import { execa } from 'execa';
import type { ToolMeta } from './types.js';

/**
 * Checks if the Docker daemon is accessible.
 */
export async function verifyDockerAvailable(): Promise<boolean> {
  try {
    await execa('docker', ['info', '--format', '{{.ServerVersion}}']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Generates the Dockerfile content for an on-demand MCP server.
 */
export function generateDockerfile(meta: ToolMeta): string {
  return `FROM golang:1.24-alpine AS builder
WORKDIR /src
RUN apk add --no-cache git
RUN go install ${meta.packagePath}@latest

FROM alpine:latest
RUN apk add --no-cache ca-certificates tzdata
COPY --from=builder /go/bin/${meta.slug}-pp-mcp /usr/local/bin/mcp-server

ENV XDG_DATA_HOME=/data
VOLUME ["/data"]

ENTRYPOINT ["/usr/local/bin/mcp-server"]
CMD ["--transport", "stdio"]
`;
}

/**
 * Builds the container image using stdin Dockerfile.
 */
export async function buildContainerImage(meta: ToolMeta, dryRun: boolean = false): Promise<void> {
  const dockerfileContent = generateDockerfile(meta);

  if (dryRun) {
    console.log(`[dry-run] Would build image: ${meta.imageTag}`);
    console.log(`[dry-run] Dockerfile:\n${dockerfileContent}`);
    return;
  }

  const isAvailable = await verifyDockerAvailable();
  if (!isAvailable) {
    throw new Error('Docker daemon is not running. Please launch Docker Desktop and try again.');
  }

  console.log(`==> Building container image '${meta.imageTag}'...`);

  const buildProcess = execa('docker', ['build', '-t', meta.imageTag, '-'], {
    input: dockerfileContent,
  });

  // Stream output if verbose or let it finish
  await buildProcess;
  console.log(`✅ Built image '${meta.imageTag}' successfully.`);
}
