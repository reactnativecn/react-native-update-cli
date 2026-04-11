import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from 'bun:test';
import { ping, promiseAny, testUrls } from '../src/utils/http-helper';

describe('promiseAny', () => {
  test('resolves with the first resolved promise', async () => {
    const result = await promiseAny([
      new Promise((_, reject) => setTimeout(() => reject('slow'), 50)),
      Promise.resolve('fast'),
      new Promise((resolve) => setTimeout(() => resolve('medium'), 30)),
    ]);
    expect(result).toBe('fast');
  });

  test('rejects when all promises reject', async () => {
    await expect(
      promiseAny([
        Promise.reject(new Error('fail1')),
        Promise.reject(new Error('fail2')),
        Promise.reject(new Error('fail3')),
      ]),
    ).rejects.toThrow('All promises were rejected');
  });

  test('resolves with the first even if others fail', async () => {
    const result = await promiseAny([
      Promise.reject(new Error('fail')),
      Promise.resolve('success'),
    ]);
    expect(result).toBe('success');
  });
});

describe('testUrls', () => {
  test('returns null for empty array', async () => {
    const result = await testUrls([]);
    expect(result).toBeNull();
  });

  test('returns null for undefined', async () => {
    const result = await testUrls(undefined);
    expect(result).toBeNull();
  });
});
