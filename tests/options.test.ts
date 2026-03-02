import { describe, expect, test } from 'bun:test';
import {
  getBooleanOption,
  getOptionalStringOption,
  getStringOption,
  toObjectState,
} from '../src/utils/options';

describe('utils/options', () => {
  test('getBooleanOption handles boolean/string/number and fallback', () => {
    expect(getBooleanOption({ enabled: true }, 'enabled', false)).toBe(true);
    expect(getBooleanOption({ enabled: 'true' }, 'enabled', false)).toBe(true);
    expect(getBooleanOption({ enabled: 'TRUE' }, 'enabled', false)).toBe(true);
    expect(getBooleanOption({ enabled: 'false' }, 'enabled', true)).toBe(false);
    expect(getBooleanOption({ enabled: 1 }, 'enabled', false)).toBe(true);
    expect(getBooleanOption({ enabled: 0 }, 'enabled', true)).toBe(false);
    expect(getBooleanOption({}, 'enabled', true)).toBe(true);
  });

  test('getStringOption returns stringified primitive or fallback', () => {
    expect(getStringOption({ name: 'pushy' }, 'name', 'default')).toBe('pushy');
    expect(getStringOption({ name: 100 }, 'name', 'default')).toBe('100');
    expect(getStringOption({ name: false }, 'name', 'default')).toBe('false');
    expect(getStringOption({ name: null }, 'name', 'default')).toBe('default');
  });

  test('getOptionalStringOption returns undefined for empty or invalid values', () => {
    expect(getOptionalStringOption({ key: 'value' }, 'key')).toBe('value');
    expect(getOptionalStringOption({ key: 42 }, 'key')).toBe('42');
    expect(getOptionalStringOption({ key: true }, 'key')).toBe('true');
    expect(getOptionalStringOption({ key: '' }, 'key')).toBeUndefined();
    expect(getOptionalStringOption({ key: null }, 'key')).toBeUndefined();
    expect(getOptionalStringOption({}, 'key')).toBeUndefined();
  });

  test('toObjectState returns object value or fallback', () => {
    const fallback = { ok: true };
    const source = { name: 'app' };

    expect(toObjectState(source, fallback)).toEqual(source);
    expect(toObjectState(null, fallback)).toEqual(fallback);
    expect(toObjectState('invalid', fallback)).toEqual(fallback);
  });
});
