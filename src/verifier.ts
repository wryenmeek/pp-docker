import { execa } from 'execa';
import { resolveTool } from './resolver.js';
import type {
  CommandExecutor,
  SecretDefinition,
  SecretStatus,
  ToolMeta,
  ToolVerificationResult,
} from './types.js';

export interface KeystoreCheckResult {
  required: boolean;
  allConfigured: boolean;
  secrets: SecretStatus[];
  rawList?: string;
  error?: string;
}

export interface ContainerRuntimeCheckResult {
  imageAvailable: boolean;
  containerStarted: boolean;
  protocolVersion?: string;
  serverName?: string;
  serverVersion?: string;
  toolsCount?: number;
  error?: string;
}

/**
 * Checks if the required secrets exist in Docker's keystore (via docker pass ls).
 */
export async function checkKeystore(
  secrets: SecretDefinition[],
  executor: CommandExecutor = execa,
): Promise<KeystoreCheckResult> {
  if (!secrets || secrets.length === 0) {
    return {
      required: false,
      allConfigured: true,
      secrets: [],
    };
  }

  let stdout = '';
  try {
    const res = await executor('docker', ['pass', 'ls']);
    stdout = typeof res === 'string' ? res : res?.stdout || '';
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      required: true,
      allConfigured: false,
      secrets: secrets.map((s) => ({
        name: s.name,
        env: s.env,
        configured: false,
      })),
      error: `Failed to query Docker keystore: ${msg}`,
    };
  }

  const existingEntries = new Set(
    stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
  );

  const statuses: SecretStatus[] = secrets.map((secret) => {
    // Docker MCP stores secrets as docker/mcp/<secret_name>
    const fullKey = `docker/mcp/${secret.name}`;
    const configured = existingEntries.has(fullKey) || existingEntries.has(secret.name);
    return {
      name: secret.name,
      env: secret.env,
      configured,
    };
  });

  const allConfigured = statuses.every((s) => s.configured);

  return {
    required: true,
    allConfigured,
    secrets: statuses,
    rawList: stdout,
  };
}

/**
 * Validates container runtime and MCP protocol handshake via stdio.
 */
export async function verifyMcpContainer(
  meta: ToolMeta,
  executor: CommandExecutor = execa,
  timeoutMs: number = 10_000,
): Promise<ContainerRuntimeCheckResult> {
  // 1. Verify image exists
  try {
    await executor('docker', ['image', 'inspect', meta.imageTag]);
  } catch {
    return {
      imageAvailable: false,
      containerStarted: false,
      error: `Container image '${meta.imageTag}' not found locally. Build it using: pp-docker register ${meta.slug}`,
    };
  }

  // 2. Prepare JSON-RPC handshake payload
  const rpcRequests = [
    JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'pp-docker-verifier', version: '0.1.0' },
      },
    }),
    JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    }),
  ].join('\n');

  try {
    const runResult = await executor('docker', ['run', '-i', '--rm', meta.imageTag], {
      input: `${rpcRequests}\n`,
      timeout: timeoutMs,
    });

    const outputStr = typeof runResult === 'string' ? runResult : runResult?.stdout || '';

    // Parse line-by-line JSON-RPC responses
    const lines = outputStr
      .split('\n')
      .map((l: string) => l.trim())
      .filter(Boolean);

    let protocolVersion: string | undefined;
    let serverName: string | undefined;
    let serverVersion: string | undefined;
    let toolsCount: number | undefined;

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (parsed.id === 1 && parsed.result) {
          protocolVersion = parsed.result.protocolVersion;
          if (parsed.result.serverInfo) {
            serverName = parsed.result.serverInfo.name;
            serverVersion = parsed.result.serverInfo.version;
          }
        } else if (parsed.id === 2 && parsed.result?.tools) {
          toolsCount = Array.isArray(parsed.result.tools) ? parsed.result.tools.length : undefined;
        }
      } catch {
        // Non-JSON log line (e.g. server banner on stdout)
      }
    }

    if (!protocolVersion && !serverName) {
      return {
        imageAvailable: true,
        containerStarted: true,
        error: 'Container started but did not respond with valid MCP initialize JSON-RPC handshake',
      };
    }

    return {
      imageAvailable: true,
      containerStarted: true,
      protocolVersion,
      serverName,
      serverVersion,
      toolsCount,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      imageAvailable: true,
      containerStarted: false,
      error: `Failed to execute MCP container: ${msg}`,
    };
  }
}

/**
 * End-to-end tool verification: resolves tool, tests keystore, and checks container runtime.
 */
export async function verifyTool(
  input: string,
  dryRun: boolean = false,
  executor: CommandExecutor = execa,
): Promise<ToolVerificationResult> {
  let meta: ToolMeta;
  try {
    meta = await resolveTool(input);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      tool: input,
      slug: input,
      status: 'failed',
      keystore: { required: false, allConfigured: false, secrets: [] },
      runtime: { imageAvailable: false, containerStarted: false },
      error: `Resolution failed: ${msg}`,
    };
  }

  if (dryRun) {
    return {
      tool: input,
      slug: meta.slug,
      status: 'verified',
      keystore: {
        required: meta.secrets.length > 0,
        allConfigured: true,
        secrets: meta.secrets.map((s) => ({
          name: s.name,
          env: s.env,
          configured: true,
        })),
      },
      runtime: {
        imageAvailable: true,
        containerStarted: true,
        serverName: meta.title,
        toolsCount: meta.mcpMeta?.toolCount ?? 5,
      },
    };
  }

  // 1. Keystore Check
  const keystoreResult = await checkKeystore(meta.secrets, executor);

  if (keystoreResult.required && !keystoreResult.allConfigured) {
    const missing = keystoreResult.secrets.filter((s) => !s.configured).map((s) => s.name);
    return {
      tool: input,
      slug: meta.slug,
      status: 'failed',
      keystore: keystoreResult,
      runtime: { imageAvailable: false, containerStarted: false },
      error: `Missing required secret(s) in Docker keystore: ${missing.join(', ')}`,
    };
  }

  // 2. Container Runtime Check
  const runtimeResult = await verifyMcpContainer(meta, executor);

  let status: 'verified' | 'failed' | 'warning' = 'verified';
  let errorMsg: string | undefined;

  if (!runtimeResult.containerStarted) {
    status = 'failed';
    errorMsg = runtimeResult.error;
  } else if (runtimeResult.toolsCount !== undefined && runtimeResult.toolsCount === 0) {
    status = 'warning';
    errorMsg = 'MCP server returned 0 tools';
  }

  return {
    tool: input,
    slug: meta.slug,
    status,
    keystore: keystoreResult,
    runtime: runtimeResult,
    error: errorMsg,
  };
}
