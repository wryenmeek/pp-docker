import { execa } from 'execa';
import type { CommandExecutor, ToolMeta } from './types.js';

/**
 * Checks if the Docker daemon is accessible.
 */
export async function verifyDockerAvailable(executor: CommandExecutor = execa): Promise<boolean> {
  try {
    await executor('docker', ['info', '--format', '{{.ServerVersion}}']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Generates the Dockerfile content for an on-demand MCP server.
 */
export function generateDockerfile(meta: ToolMeta): string {
  return `FROM golang:alpine AS builder
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
export async function buildContainerImage(
  meta: ToolMeta,
  dryRun: boolean = false,
  executor: CommandExecutor = execa,
): Promise<void> {
  const dockerfileContent = generateDockerfile(meta);

  if (dryRun) {
    console.log(`[dry-run] Would build image: ${meta.imageTag}`);
    console.log(`[dry-run] Dockerfile:\n${dockerfileContent}`);
    return;
  }

  const isAvailable = await verifyDockerAvailable(executor);
  if (!isAvailable) {
    throw new Error('Docker daemon is not running. Please launch Docker Desktop and try again.');
  }

  console.log(`==> Building container image '${meta.imageTag}'...`);

  const buildProcess = executor('docker', ['build', '-t', meta.imageTag, '-'], {
    input: dockerfileContent,
  });

  // Stream output if verbose or let it finish
  await buildProcess;
  console.log(`✅ Built image '${meta.imageTag}' successfully.`);
}

/**
 * Starts Docker Desktop depending on host operating system.
 */
export async function startDockerDesktop(
  executor: CommandExecutor = execa,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  if (platform === 'darwin') {
    await executor('open', ['-a', 'Docker']);
  } else if (platform === 'win32') {
    await executor('cmd', ['/c', 'start', '', 'Docker Desktop']);
  } else if (platform === 'linux') {
    try {
      await executor('systemctl', ['--user', 'start', 'docker-desktop']);
    } catch {
      await executor('sudo', ['systemctl', 'start', 'docker']);
    }
  } else {
    throw new Error(`Unsupported platform for Docker auto-start: ${platform}`);
  }
}

export interface WaitForDockerOptions {
  timeoutMs?: number;
  intervalMs?: number;
  executor?: CommandExecutor;
  onTick?: (elapsedSeconds: number, maxSeconds: number) => void;
}

/**
 * Polls verifyDockerAvailable at intervalMs until available or timeoutMs elapsed.
 */
export async function waitForDockerReady(options: WaitForDockerOptions = {}): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const intervalMs = options.intervalMs ?? 2_000;
  const executor = options.executor;
  const startTime = Date.now();
  const maxSeconds = Math.round(timeoutMs / 1000);

  if (await verifyDockerAvailable(executor)) {
    return true;
  }

  while (Date.now() - startTime < timeoutMs) {
    const elapsedSeconds = Math.round((Date.now() - startTime) / 1000);
    options.onTick?.(elapsedSeconds, maxSeconds);

    const remainingMs = timeoutMs - (Date.now() - startTime);
    if (remainingMs <= 0) break;
    const waitMs = Math.min(intervalMs, remainingMs);
    await new Promise((resolve) => setTimeout(resolve, waitMs));

    if (await verifyDockerAvailable(executor)) {
      return true;
    }
  }

  return false;
}
