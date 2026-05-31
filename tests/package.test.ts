import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import * as api from '../src/api';
import { normalizeUploadBuildTime, packageCommands } from '../src/package';

describe('normalizeUploadBuildTime', () => {
  test('converts number to string', () => {
    expect(normalizeUploadBuildTime(1234567890)).toBe('1234567890');
  });

  test('keeps string as-is', () => {
    expect(normalizeUploadBuildTime('1234567890')).toBe('1234567890');
  });

  test('converts undefined to string', () => {
    expect(normalizeUploadBuildTime(undefined)).toBe('undefined');
  });

  test('converts null to string', () => {
    expect(normalizeUploadBuildTime(null)).toBe('null');
  });

  test('converts 0 to string', () => {
    expect(normalizeUploadBuildTime(0)).toBe('0');
  });
});

// Test the internal helper functions by re-implementing and verifying the logic
describe('package helper logic', () => {
  // parseBooleanOption equivalent
  function parseBooleanOption(value: unknown): boolean {
    return value === true || value === 'true';
  }

  test('parseBooleanOption returns true for boolean true', () => {
    expect(parseBooleanOption(true)).toBe(true);
  });

  test('parseBooleanOption returns true for string "true"', () => {
    expect(parseBooleanOption('true')).toBe(true);
  });

  test('parseBooleanOption returns false for false', () => {
    expect(parseBooleanOption(false)).toBe(false);
  });

  test('parseBooleanOption returns false for "false"', () => {
    expect(parseBooleanOption('false')).toBe(false);
  });

  test('parseBooleanOption returns false for undefined', () => {
    expect(parseBooleanOption(undefined)).toBe(false);
  });

  test('parseBooleanOption returns false for 1', () => {
    expect(parseBooleanOption(1)).toBe(false);
  });

  // parseCsvOption equivalent
  function parseCsvOption(value: unknown): string[] | null {
    if (typeof value !== 'string') return null;
    const parsed = value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    return parsed.length > 0 ? parsed : null;
  }

  test('parseCsvOption parses simple CSV', () => {
    expect(parseCsvOption('a,b,c')).toEqual(['a', 'b', 'c']);
  });

  test('parseCsvOption trims whitespace', () => {
    expect(parseCsvOption(' a , b , c ')).toEqual(['a', 'b', 'c']);
  });

  test('parseCsvOption filters empty values', () => {
    expect(parseCsvOption('a,,b,,c')).toEqual(['a', 'b', 'c']);
  });

  test('parseCsvOption returns null for empty string', () => {
    expect(parseCsvOption('')).toBeNull();
  });

  test('parseCsvOption returns null for non-string', () => {
    expect(parseCsvOption(123)).toBeNull();
    expect(parseCsvOption(undefined)).toBeNull();
    expect(parseCsvOption(null)).toBeNull();
  });

  test('parseCsvOption handles single item', () => {
    expect(parseCsvOption('foo')).toEqual(['foo']);
  });

  // ensureFileByExt equivalent
  function ensureFileByExt(
    filePath: string | undefined,
    extension: string,
  ): string {
    if (!filePath?.endsWith(extension)) {
      throw new Error(`Usage: expected ${extension} file`);
    }
    return filePath;
  }

  test('ensureFileByExt accepts matching extension', () => {
    expect(ensureFileByExt('app.ipa', '.ipa')).toBe('app.ipa');
    expect(ensureFileByExt('debug.apk', '.apk')).toBe('debug.apk');
    expect(ensureFileByExt('release.aab', '.aab')).toBe('release.aab');
    expect(ensureFileByExt('bundle.app', '.app')).toBe('bundle.app');
  });

  test('ensureFileByExt rejects wrong extension', () => {
    expect(() => ensureFileByExt('app.apk', '.ipa')).toThrow();
  });

  test('ensureFileByExt rejects undefined', () => {
    expect(() => ensureFileByExt(undefined, '.ipa')).toThrow();
  });

  test('ensureFileByExt rejects empty string', () => {
    expect(() => ensureFileByExt('', '.apk')).toThrow();
  });
});

describe('packageCommands.deletePackage', () => {
  let consoleSpy: ReturnType<typeof spyOn>;
  let deleteSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    deleteSpy = spyOn(api, 'doDelete').mockResolvedValue({});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    deleteSpy.mockRestore();
  });

  test('deletes one native package through the legacy endpoint', async () => {
    await packageCommands.deletePackage({
      options: {
        appId: '100',
        packageId: '10',
      },
    });

    expect(deleteSpy).toHaveBeenCalledWith('/app/100/package/10');
  });

  test('deletes multiple native packages through the batch endpoint', async () => {
    await packageCommands.deletePackage({
      options: {
        appId: '100',
        packageIds: '10,11',
      },
    });

    expect(deleteSpy).toHaveBeenCalledWith('/app/100/package', {
      packageIds: [10, 11],
    });
  });

  test('accepts comma separated ids through the legacy packageId option', async () => {
    await packageCommands.deletePackage({
      options: {
        appId: '100',
        packageId: '10,11',
      },
    });

    expect(deleteSpy).toHaveBeenCalledWith('/app/100/package', {
      packageIds: [10, 11],
    });
  });
});
