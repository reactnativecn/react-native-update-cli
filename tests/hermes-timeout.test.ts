import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import {
  compareHermesBytecode,
  probeHbcVersion,
} from '../src/utils/hermes-base';
import { hermesTimeout } from '../src/utils/hermes-timeout';

const keys = ['PUSHY_CACHE_DIR', 'PUSHY_HERMES_PROBE_TIMEOUT_MS'] as const;
describe('Hermes deadlines', () => {
  test('invalid or overflowing values cannot turn deadlines into a 1ms timer', () => {
    for (const value of [
      undefined,
      '',
      '0',
      '-1',
      'NaN',
      'Infinity',
      '1.5',
      '2147483648',
    ]) {
      expect(hermesTimeout(value, 2000)).toBe(2000);
    }
    expect(hermesTimeout('50', 2000)).toBe(50);
  });
});

describe.if(process.platform !== 'win32')('Hermes subprocess deadlines', () => {
  let dir: string;
  let hanging: string;
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rnu-hermes-timeout-'));
    process.env.PUSHY_CACHE_DIR = path.join(dir, 'cache');
    hanging = path.join(dir, 'hermesc');
    // exec, not a shell child: the killed process owns stdout and cannot leave
    // an inherited pipe open to prevent close/finish from settling.
    fs.writeFileSync(
      hanging,
      `#!/bin/sh\nexec "${process.execPath}" -e 'setInterval(() => {}, 1000)'\n`,
      { mode: 0o755 },
    );
  });
  afterEach(() => {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    fs.removeSync(dir);
  });

  test('a hung synchronous version probe times out', () => {
    process.env.PUSHY_HERMES_PROBE_TIMEOUT_MS = '50';
    expect(probeHbcVersion(hanging)).toBeNull();
  }, 2000);

  test('hung pretty dumps time out and both children are reaped', async () => {
    const result = await compareHermesBytecode(
      hanging,
      'missing-a',
      'missing-b',
      { timeoutMs: 50 },
    );
    expect(result.status).toBe('dump-failed');
  }, 2000);

  test('external cancellation aborts active dump processes', async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 50);
    try {
      const result = await compareHermesBytecode(
        hanging,
        'missing-a',
        'missing-b',
        {
          signal: controller.signal,
          timeoutMs: 1000,
        },
      );
      expect(result.status).toBe('dump-failed');
    } finally {
      clearTimeout(timer);
    }
  }, 2000);

  test('an already-aborted request fails without an unhandled spawn error', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await compareHermesBytecode(
      hanging,
      'missing-a',
      'missing-b',
      {
        signal: controller.signal,
        timeoutMs: 500,
      },
    );
    expect(result.status).toBe('dump-failed');
  }, 2000);
});
