import {
  type ChildProcessWithoutNullStreams,
  type SpawnOptionsWithoutStdio,
  type SpawnSyncOptions,
  spawn,
  spawnSync,
} from 'child_process';
import fs from 'fs';
import { createConnection } from 'net';
import nodeFetch from 'node-fetch';
import path from 'path';

export type RuntimeRequestInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: any;
  signal?: AbortSignal;
};

export type RuntimeResponse = {
  status: number;
  statusText: string;
  text: () => Promise<string>;
};

export type PackageManager = 'bun' | 'npm' | 'pnpm' | 'yarn';
export type JavaScriptRuntime = 'bun' | 'node';

export const isBunRuntime =
  typeof (process.versions as NodeJS.ProcessVersions & { bun?: string }).bun ===
  'string';

export function runtimeFetch(
  url: string,
  options?: RuntimeRequestInit,
): Promise<RuntimeResponse> {
  const fetchImpl =
    typeof globalThis.fetch === 'function'
      ? globalThis.fetch.bind(globalThis)
      : nodeFetch;

  return fetchImpl(url, options as any) as Promise<RuntimeResponse>;
}

function resolveTcpTarget(input: string): { host: string; port: number } {
  try {
    const parsed = new URL(input);
    const port = parsed.port || (parsed.protocol === 'http:' ? '80' : '443');
    return {
      host: parsed.hostname,
      port: Number(port),
    };
  } catch {
    const [host, port] = input.split(':');
    return {
      host,
      port: port ? Number(port) : 443,
    };
  }
}

function measureTcpConnectOnce(
  host: string,
  port: number,
  timeout: number,
): Promise<number> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const socket = createConnection({ host, port });

    const finish = (latency: number) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(latency);
    };

    socket.setTimeout(timeout);
    socket.once('connect', () => {
      finish(Date.now() - startedAt);
    });
    socket.once('timeout', () => {
      finish(Number.POSITIVE_INFINITY);
    });
    socket.once('error', () => {
      finish(Number.POSITIVE_INFINITY);
    });
  });
}

export async function measureTcpLatency(
  input: string,
  {
    attempts = 4,
    timeout = 1000,
  }: {
    attempts?: number;
    timeout?: number;
  } = {},
): Promise<number> {
  const { host, port } = resolveTcpTarget(input);
  const latencies: number[] = [];

  for (let i = 0; i < attempts; i++) {
    const latency = await measureTcpConnectOnce(host, port, timeout);
    if (Number.isFinite(latency)) {
      latencies.push(latency);
    }
  }

  if (latencies.length === 0) {
    return Number.POSITIVE_INFINITY;
  }
  return (
    latencies.reduce((sum, latency) => sum + latency, 0) / latencies.length
  );
}

export function detectPackageManager(
  cwd = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): PackageManager {
  const lockFiles: Array<[string, PackageManager]> = [
    ['bun.lock', 'bun'],
    ['bun.lockb', 'bun'],
    ['pnpm-lock.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'],
    ['package-lock.json', 'npm'],
  ];
  for (const [lockFile, manager] of lockFiles) {
    if (fs.existsSync(path.join(cwd, lockFile))) {
      return manager;
    }
  }

  const userAgent = env.npm_config_user_agent ?? '';
  if (userAgent.startsWith('bun/')) {
    return 'bun';
  }
  if (userAgent.startsWith('pnpm/')) {
    return 'pnpm';
  }
  if (userAgent.startsWith('yarn/')) {
    return 'yarn';
  }
  if (userAgent.startsWith('npm/')) {
    return 'npm';
  }

  return isBunRuntime ? 'bun' : 'npm';
}

export function getInstallCommand(
  installArgs: string[],
  cwd = process.cwd(),
): { command: string; args: string[] } {
  const packageManager = detectPackageManager(cwd);
  if (packageManager === 'npm') {
    return { command: 'npm', args: ['install', ...installArgs] };
  }
  return { command: packageManager, args: ['add', ...installArgs] };
}

export function getJavaScriptRuntime(
  env: NodeJS.ProcessEnv = process.env,
): JavaScriptRuntime {
  const configured = env.RNU_JS_RUNTIME?.toLowerCase();
  if (configured === 'bun') {
    return 'bun';
  }
  if (configured === 'auto') {
    return isBunRuntime ? 'bun' : 'node';
  }
  return 'node';
}

export function spawnJavaScript(
  args: string[],
  options?: SpawnOptionsWithoutStdio,
  env: NodeJS.ProcessEnv = process.env,
): ChildProcessWithoutNullStreams {
  return spawn(getJavaScriptRuntime(env), args, options ?? {});
}

export function spawnJavaScriptSync(
  args: string[],
  options?: SpawnSyncOptions,
  env: NodeJS.ProcessEnv = process.env,
) {
  return spawnSync(getJavaScriptRuntime(env), args, options ?? {});
}
