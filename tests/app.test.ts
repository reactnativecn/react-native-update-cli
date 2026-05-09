import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import fs from 'fs';
import * as api from '../src/api';
import { appCommands, assertPlatform, getSelectedApp } from '../src/app';

describe('assertPlatform', () => {
  test('accepts ios', () => {
    expect(assertPlatform('ios')).toBe('ios');
  });

  test('accepts android', () => {
    expect(assertPlatform('android')).toBe('android');
  });

  test('accepts harmony', () => {
    expect(assertPlatform('harmony')).toBe('harmony');
  });

  test('throws on invalid platform string', () => {
    expect(() => assertPlatform('windows')).toThrow(
      /windows|unsupportedPlatform/,
    );
  });

  test('throws on empty string', () => {
    expect(() => assertPlatform('')).toThrow();
  });
});

describe('getSelectedApp', () => {
  let readFileSpy: ReturnType<typeof spyOn>;

  afterEach(() => {
    readFileSpy?.mockRestore();
  });

  test('returns appId and appKey from update.json for ios', async () => {
    const updateJson = {
      ios: { appId: 42, appKey: 'key-ios-abc' },
      android: { appId: 99, appKey: 'key-android-xyz' },
    };
    readFileSpy = spyOn(fs.promises, 'readFile').mockResolvedValue(
      JSON.stringify(updateJson),
    );

    const result = await getSelectedApp('ios');

    expect(result).toEqual({
      appId: '42',
      appKey: 'key-ios-abc',
      platform: 'ios',
    });
  });

  test('returns appId and appKey from update.json for android', async () => {
    const updateJson = {
      android: { appId: 7, appKey: 'key-android' },
    };
    readFileSpy = spyOn(fs.promises, 'readFile').mockResolvedValue(
      JSON.stringify(updateJson),
    );

    const result = await getSelectedApp('android');

    expect(result).toEqual({
      appId: '7',
      appKey: 'key-android',
      platform: 'android',
    });
  });

  test('throws when update.json does not exist (ENOENT)', async () => {
    const enoentError = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    readFileSpy = spyOn(fs.promises, 'readFile').mockRejectedValue(enoentError);

    await expect(getSelectedApp('ios')).rejects.toThrow(
      /selectApp|appNotSelected/,
    );
  });

  test('throws original error for non-ENOENT read failures', async () => {
    const permError = Object.assign(new Error('Permission denied'), {
      code: 'EACCES',
    });
    readFileSpy = spyOn(fs.promises, 'readFile').mockRejectedValue(permError);

    await expect(getSelectedApp('ios')).rejects.toThrow('Permission denied');
  });

  test('throws when platform key is missing from update.json', async () => {
    readFileSpy = spyOn(fs.promises, 'readFile').mockResolvedValue(
      JSON.stringify({ android: { appId: 1, appKey: 'k' } }),
    );

    await expect(getSelectedApp('ios')).rejects.toThrow(
      /selectApp|appNotSelected/,
    );
  });

  test('converts appId to string', async () => {
    readFileSpy = spyOn(fs.promises, 'readFile').mockResolvedValue(
      JSON.stringify({
        harmony: { appId: 12345, appKey: 'harmony-key' },
      }),
    );

    const result = await getSelectedApp('harmony');
    expect(result.appId).toBe('12345');
    expect(typeof result.appId).toBe('string');
  });
});

describe('appCommands.createApp', () => {
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

  test('selects the created app when invoked without appCommands as this', async () => {
    postSpy = spyOn(api, 'post').mockResolvedValue({ id: 10 });
    getSpy = spyOn(api, 'get').mockResolvedValue({ appKey: 'key-ios-10' });
    const enoentError = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    readFileSpy = spyOn(fs.promises, 'readFile').mockRejectedValue(enoentError);
    writeFileSpy = spyOn(fs.promises, 'writeFile').mockResolvedValue();
    consoleLogSpy = spyOn(console, 'log').mockImplementation(() => {});

    const createApp = appCommands.createApp;
    await createApp({
      options: {
        name: 'SmallWOD',
        downloadUrl: '',
        platform: 'ios',
      },
    });

    expect(postSpy).toHaveBeenCalledWith('/app/create', {
      name: 'SmallWOD',
      platform: 'ios',
      downloadUrl: '',
    });
    expect(getSpy).toHaveBeenCalledWith('/app/10');
    expect(writeFileSpy).toHaveBeenCalledWith(
      'update.json',
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
