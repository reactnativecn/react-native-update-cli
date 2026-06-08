import { describe, expect, test } from 'bun:test';
import i18next from 'i18next';
import { t } from '../src/utils/i18n';

describe('i18n t()', () => {
  test('returns a non-empty translated string for a known key in English', () => {
    i18next.changeLanguage('en');
    const result = t('cancelled');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    expect(result).toBe('Cancelled');
  });

  test('returns a non-empty translated string for a known key in Chinese', () => {
    i18next.changeLanguage('zh');
    const result = t('cancelled');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    expect(result).toBe('已取消');
  });

  test('returns a translated string for a key with interpolation in English', () => {
    i18next.changeLanguage('en');
    const result = t('createAppSuccess', { id: '12345' });
    expect(typeof result).toBe('string');
    expect(result).toContain('12345');
  });

  test('returns a translated string for a key with interpolation in Chinese', () => {
    i18next.changeLanguage('zh');
    const result = t('createAppSuccess', { id: '67890' });
    expect(typeof result).toBe('string');
    expect(result).toContain('67890');
  });

  test('handles multiple interpolation options', () => {
    i18next.changeLanguage('en');
    const result = t('versionBind', {
      version: '1.0.0',
      nativeVersion: '2.0',
      id: 'abc',
    });
    expect(result).toContain('1.0.0');
    expect(result).toContain('2.0');
    expect(result).toContain('abc');
  });

  test('returns the key itself or a fallback for an unknown key', () => {
    i18next.changeLanguage('en');
    const result = t('this_key_does_not_exist_at_all');
    // i18next returns the key string when a key is missing
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  test('returns different strings for en and zh for the same key', () => {
    i18next.changeLanguage('en');
    const enResult = t('packing');
    i18next.changeLanguage('zh');
    const zhResult = t('packing');
    // Both should be non-empty strings
    expect(enResult.length).toBeGreaterThan(0);
    expect(zhResult.length).toBeGreaterThan(0);
    // They should differ (different languages)
    expect(enResult).not.toBe(zhResult);
  });
});
