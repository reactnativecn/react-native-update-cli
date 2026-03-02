import { describe, expect, test } from 'bun:test';
import { normalizeUploadBuildTime } from '../src/package';

describe('package buildTime normalization', () => {
  test('converts number to string', () => {
    expect(normalizeUploadBuildTime(29538230)).toBe('29538230');
    expect(normalizeUploadBuildTime(0)).toBe('0');
  });

  test('keeps string value', () => {
    expect(normalizeUploadBuildTime('29538230')).toBe('29538230');
    expect(normalizeUploadBuildTime('  29538230  ')).toBe('  29538230  ');
  });

  test('always returns a string for any input', () => {
    expect(normalizeUploadBuildTime(undefined)).toBe('undefined');
    expect(normalizeUploadBuildTime(null)).toBe('null');
    expect(normalizeUploadBuildTime(Number.NaN)).toBe('NaN');
    expect(normalizeUploadBuildTime(Number.POSITIVE_INFINITY)).toBe('Infinity');
    expect(normalizeUploadBuildTime(Number.NEGATIVE_INFINITY)).toBe(
      '-Infinity',
    );
  });
});
