import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';

import { plugins } from '../src/utils/plugin-config';

describe('plugin-config - sentry plugin', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'plugin-config-test-'));
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  const sentryPlugin = plugins.find((p) => p.name === 'sentry')!;

  test('sentry plugin exists in the plugins array', () => {
    expect(sentryPlugin).toBeDefined();
  });

  test('sentry bundleParams are { sentry: true, sourcemap: true }', () => {
    expect(sentryPlugin.bundleParams).toEqual({
      sentry: true,
      sourcemap: true,
    });
  });

  describe('sentry detect', () => {
    test('returns false when no sentry.properties exists', async () => {
      const origCwd = process.cwd();
      process.chdir(tmpDir);
      try {
        const result = await sentryPlugin.detect();
        expect(result).toBe(false);
      } finally {
        process.chdir(origCwd);
      }
    });

    test('returns true when ios/sentry.properties exists', async () => {
      await fs.ensureDir(path.join(tmpDir, 'ios'));
      await fs.writeFile(
        path.join(tmpDir, 'ios', 'sentry.properties'),
        'defaults.org=test\n',
      );

      const origCwd = process.cwd();
      process.chdir(tmpDir);
      try {
        const result = await sentryPlugin.detect();
        expect(result).toBe(true);
      } finally {
        process.chdir(origCwd);
      }
    });

    test('returns true when android/sentry.properties exists', async () => {
      await fs.ensureDir(path.join(tmpDir, 'android'));
      await fs.writeFile(
        path.join(tmpDir, 'android', 'sentry.properties'),
        'defaults.org=test\n',
      );

      const origCwd = process.cwd();
      process.chdir(tmpDir);
      try {
        const result = await sentryPlugin.detect();
        expect(result).toBe(true);
      } finally {
        process.chdir(origCwd);
      }
    });

    test('returns true when both ios and android sentry.properties exist', async () => {
      await fs.ensureDir(path.join(tmpDir, 'ios'));
      await fs.ensureDir(path.join(tmpDir, 'android'));
      await fs.writeFile(
        path.join(tmpDir, 'ios', 'sentry.properties'),
        'defaults.org=test\n',
      );
      await fs.writeFile(
        path.join(tmpDir, 'android', 'sentry.properties'),
        'defaults.org=test\n',
      );

      const origCwd = process.cwd();
      process.chdir(tmpDir);
      try {
        const result = await sentryPlugin.detect();
        expect(result).toBe(true);
      } finally {
        process.chdir(origCwd);
      }
    });
  });
});
