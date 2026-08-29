import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import fs from 'fs';
import * as api from '../src/api';
import {
  createAppTargetResolver,
  getAppCommands,
  getSelectedApp,
  resolveAppTarget,
} from '../src/app';
import {
  createPublishBundleRequest,
  normalizeBundleOptions,
} from '../src/bundle';

describe('bundle target context', () => {
  test('preserves appId and config in the publish request', () => {
    const normalized = normalizeBundleOptions(
      {
        appId: '42',
        config: 'configs/release.update.json',
      },
      'ios',
    );

    expect(normalized.appId).toBe('42');
    expect(normalized.config).toBe('configs/release.update.json');
    expect(
      createPublishBundleRequest('dist/ios.ppk', 'ios', {
        appId: normalized.appId,
        config: normalized.config,
        name: 'v1',
      }),
    ).toEqual({
      args: ['dist/ios.ppk'],
      options: {
        platform: 'ios',
        appId: '42',
        config: 'configs/release.update.json',
        name: 'v1',
      },
    });
  });

  test('reuses one selected app for Hermes lookup and publishing', async () => {
    const readFileSpy = spyOn(fs.promises, 'readFile')
      .mockResolvedValueOnce(
        JSON.stringify({ ios: { appId: 42, appKey: 'key-42' } }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({ ios: { appId: 99, appKey: 'key-99' } }),
      );

    try {
      const resolveTarget = createAppTargetResolver('ios', {
        config: 'configs/release.update.json',
      });
      const hermesTarget = await resolveTarget();
      const publishTarget = await resolveTarget();

      expect(hermesTarget).toEqual(publishTarget);
      expect(publishTarget.appId).toBe('42');
      expect(readFileSpy).toHaveBeenCalledTimes(1);
      expect(
        createPublishBundleRequest('dist/ios.ppk', 'ios', {
          appId: publishTarget.appId,
          config: publishTarget.configPath,
          name: 'v1',
        }),
      ).toEqual({
        args: ['dist/ios.ppk'],
        options: {
          platform: 'ios',
          appId: '42',
          config: 'configs/release.update.json',
          name: 'v1',
        },
      });
    } finally {
      readFileSpy.mockRestore();
    }
  });

  test('retries selection after a failed best-effort lookup', async () => {
    const enoentError = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    const readFileSpy = spyOn(fs.promises, 'readFile')
      .mockRejectedValueOnce(enoentError)
      .mockResolvedValueOnce(
        JSON.stringify({ ios: { appId: 42, appKey: 'key-42' } }),
      );

    try {
      const resolveTarget = createAppTargetResolver('ios', {
        config: 'configs/release.update.json',
      });

      await expect(resolveTarget()).rejects.toThrow();
      await expect(resolveTarget()).resolves.toEqual({
        appId: '42',
        appKey: 'key-42',
        platform: 'ios',
        configPath: 'configs/release.update.json',
      });
      expect(readFileSpy).toHaveBeenCalledTimes(2);
    } finally {
      readFileSpy.mockRestore();
    }
  });
});

describe('app config target', () => {
  let postSpy: ReturnType<typeof spyOn>;
  let getSpy: ReturnType<typeof spyOn>;
  let readFileSpy: ReturnType<typeof spyOn>;
  let writeFileSpy: ReturnType<typeof spyOn>;
  let consoleLogSpy: ReturnType<typeof spyOn>;

  afterEach(() => {
    postSpy?.mockRestore();
    getSpy?.mockRestore();
    readFileSpy?.mockRestore();
    writeFileSpy?.mockRestore();
    consoleLogSpy?.mockRestore();
  });

  test('getSelectedApp reads the explicit config path', async () => {
    readFileSpy = spyOn(fs.promises, 'readFile').mockResolvedValue(
      JSON.stringify({ ios: { appId: 42, appKey: 'key-42' } }),
    );

    await expect(
      getSelectedApp('ios', 'configs/release.update.json'),
    ).resolves.toEqual({
      appId: '42',
      appKey: 'key-42',
      platform: 'ios',
    });
    expect(readFileSpy).toHaveBeenCalledWith(
      'configs/release.update.json',
      'utf8',
    );
  });

  test('explicit appId does not read the selected-app config', async () => {
    readFileSpy = spyOn(fs.promises, 'readFile').mockRejectedValue(
      new Error('config should not be read'),
    );

    await expect(
      resolveAppTarget('android', {
        appId: '777',
        config: 'configs/release.update.json',
      }),
    ).resolves.toEqual({
      appId: '777',
      platform: 'android',
      configPath: 'configs/release.update.json',
    });
    expect(readFileSpy).not.toHaveBeenCalled();
  });

  test('createApp selects the new app in the explicit config file', async () => {
    postSpy = spyOn(api, 'post').mockResolvedValue({ id: 10 });
    getSpy = spyOn(api, 'get').mockResolvedValue({ appKey: 'key-ios-10' });
    const enoentError = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    readFileSpy = spyOn(fs.promises, 'readFile').mockRejectedValue(enoentError);
    writeFileSpy = spyOn(fs.promises, 'writeFile').mockResolvedValue();
    consoleLogSpy = spyOn(console, 'log').mockImplementation(() => {});

    await getAppCommands().createApp({
      options: {
        name: 'SmallWOD',
        downloadUrl: '',
        platform: 'ios',
        config: 'configs/release.update.json',
      },
    });

    expect(readFileSpy).toHaveBeenCalledWith(
      'configs/release.update.json',
      'utf8',
    );
    expect(writeFileSpy).toHaveBeenCalledWith(
      'configs/release.update.json',
      JSON.stringify(
        {
          ios: {
            appId: 10,
            appKey: 'key-ios-10',
          },
        },
        null,
        4,
      ),
      'utf8',
    );
  });
});
