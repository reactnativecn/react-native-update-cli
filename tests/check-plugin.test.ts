import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { checkPlugins } from '../src/utils/check-plugin';

describe('checkPlugins', () => {
  let tmpDir: string;
  let origCwd: string;
  let logSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-plugin-test-'));
    origCwd = process.cwd();
    process.chdir(tmpDir);
    logSpy = spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    process.chdir(origCwd);
    logSpy.mockRestore();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const writeProperties = (platform: string) => {
    fs.mkdirSync(path.join(tmpDir, platform), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, platform, 'sentry.properties'),
      'defaults.org=test\n',
    );
  };

  test('nothing is enabled without sentry.properties', async () => {
    expect(await checkPlugins()).toEqual({ sentry: false, sourcemap: false });
    expect(logSpy).not.toHaveBeenCalled();
  });

  for (const platform of ['ios', 'android']) {
    test(`${platform}/sentry.properties enables sentry and source maps`, async () => {
      writeProperties(platform);
      expect(await checkPlugins()).toEqual({ sentry: true, sourcemap: true });
      expect(logSpy).toHaveBeenCalledTimes(1);
    });
  }
});
