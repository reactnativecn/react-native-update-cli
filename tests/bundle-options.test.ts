import { describe, expect, test } from 'bun:test';
import { normalizeBundleOptions } from '../src/bundle';
import { tempDir } from '../src/utils/constants';

describe('normalizeBundleOptions', () => {
  test('applies defaults for android', () => {
    const normalized = normalizeBundleOptions({}, 'android');
    expect(normalized.bundleName).toBe('index.bundlejs');
    expect(normalized.entryFile).toBe('index.js');
    expect(normalized.intermediaDir).toBe(`${tempDir}/intermedia/android`);
    expect(normalized.output).toBe(`${tempDir}/output/android.\${time}.ppk`);
    expect(normalized.dev).toBe('false');
    expect(normalized.sourcemap).toBe(false);
    expect(normalized.dryRun).toBe(false);
  });

  test('forces harmony bundleName regardless of the option', () => {
    const normalized = normalizeBundleOptions(
      { bundleName: 'custom.bundle' },
      'harmony',
    );
    expect(normalized.bundleName).toBe('bundle.harmony.js');
  });

  test('respects custom bundleName on other platforms', () => {
    const normalized = normalizeBundleOptions(
      { bundleName: 'custom.bundle' },
      'ios',
    );
    expect(normalized.bundleName).toBe('custom.bundle');
  });

  test('accepts both sentry option spellings', () => {
    expect(
      normalizeBundleOptions({ 'sentry-release': 'r1' }, 'ios').sentryRelease,
    ).toBe('r1');
    expect(
      normalizeBundleOptions({ sentryRelease: 'r2' }, 'ios').sentryRelease,
    ).toBe('r2');
    expect(
      normalizeBundleOptions({ 'sentry-dist': 'd1' }, 'ios').sentryDist,
    ).toBe('d1');
    expect(normalizeBundleOptions({ sentryDist: 'd2' }, 'ios').sentryDist).toBe(
      'd2',
    );
  });

  test('normalizes dev flag to a string', () => {
    expect(normalizeBundleOptions({ dev: true }, 'android').dev).toBe('true');
    expect(normalizeBundleOptions({ dev: false }, 'android').dev).toBe('false');
  });
});
