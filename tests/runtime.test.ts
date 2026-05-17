import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'fs';
import { createServer } from 'net';
import os from 'os';
import path from 'path';
import {
  detectPackageManager,
  getInstallCommand,
  getJavaScriptRuntime,
  isBunRuntime,
  measureTcpLatency,
} from '../src/utils/runtime';

function mkTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('runtime package manager detection', () => {
  let tempRoot = '';

  beforeEach(() => {
    tempRoot = mkTempDir('rn-update-runtime-');
  });

  afterEach(() => {
    if (tempRoot && fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('uses bun when npm user agent is bun', () => {
    expect(
      detectPackageManager(tempRoot, {
        npm_config_user_agent: 'bun/1.3.0 npm/? node/v24',
      }),
    ).toBe('bun');
  });

  test('uses lockfile when no package manager user agent is present', () => {
    fs.writeFileSync(path.join(tempRoot, 'pnpm-lock.yaml'), '');

    expect(detectPackageManager(tempRoot, {})).toBe('pnpm');
  });

  test('prefers project lockfile over current process user agent', () => {
    fs.writeFileSync(path.join(tempRoot, 'package-lock.json'), '');

    expect(
      detectPackageManager(tempRoot, {
        npm_config_user_agent: 'bun/1.3.0 npm/? node/v24',
      }),
    ).toBe('npm');
  });

  test('builds bun add command for bun projects', () => {
    fs.writeFileSync(path.join(tempRoot, 'bun.lock'), '');

    expect(getInstallCommand(['node-hdiffpatch'], tempRoot)).toEqual({
      command: 'bun',
      args: ['add', 'node-hdiffpatch'],
    });
  });

  test('builds npm install command for npm projects', () => {
    fs.writeFileSync(path.join(tempRoot, 'package-lock.json'), '');

    expect(getInstallCommand(['node-hdiffpatch'], tempRoot)).toEqual({
      command: 'npm',
      args: ['install', 'node-hdiffpatch'],
    });
  });
});

describe('runtime JavaScript runner selection', () => {
  test('defaults project scripts to node', () => {
    expect(getJavaScriptRuntime({})).toBe('node');
  });

  test('can explicitly run project scripts with bun', () => {
    expect(getJavaScriptRuntime({ RNU_JS_RUNTIME: 'bun' })).toBe('bun');
  });

  test('can auto-select bun only under bun runtime', () => {
    expect(getJavaScriptRuntime({ RNU_JS_RUNTIME: 'auto' })).toBe(
      isBunRuntime ? 'bun' : 'node',
    );
  });
});

describe('runtime TCP latency measurement', () => {
  test('measures latency with native net sockets', async () => {
    const server = createServer((socket) => {
      socket.end();
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Unable to bind local TCP server');
    }

    try {
      const latency = await measureTcpLatency(
        `http://127.0.0.1:${address.port}/upload`,
        {
          attempts: 2,
          timeout: 1000,
        },
      );
      expect(Number.isFinite(latency)).toBe(true);
    } finally {
      server.close();
    }
  });
});
