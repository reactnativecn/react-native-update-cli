
import { describe, expect, test, beforeEach, afterEach, mock } from 'bun:test';

const runtimeFetchMock = mock(() => Promise.resolve({ status: 200 }));
mock.module('../src/utils/runtime', () => ({
  runtimeFetch: runtimeFetchMock,
}));

import { promiseAny, testUrls } from '../src/utils/http-helper';

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

describe('testUrls edge cases', () => {
  afterEach(() => {
    runtimeFetchMock.mockReset();
  });

  test('Happy Path: returns successful URL', async () => {
    runtimeFetchMock.mockImplementation((url: string) => {
      if (url === 'http://success.local') {
        return Promise.resolve({ status: 200 });
      }
      return Promise.reject(new Error('fail'));
    });

    const result = await testUrls(['http://fail.local', 'http://success.local']);
    expect(result).toBe('http://success.local');
  });

  test('Fastest Response: returns the URL that resolves first', async () => {
    runtimeFetchMock.mockImplementation((url: string) => {
      if (url === 'http://fast.local') {
        return new Promise((resolve) => setTimeout(() => resolve({ status: 200 }), 10));
      }
      if (url === 'http://slow.local') {
        return new Promise((resolve) => setTimeout(() => resolve({ status: 200 }), 50));
      }
      return Promise.reject(new Error('fail'));
    });

    const result = await testUrls(['http://slow.local', 'http://fast.local']);
    expect(result).toBe('http://fast.local');
  });

  test('All Failures (Fallback): returns urls[0] without throwing', async () => {
    runtimeFetchMock.mockImplementation(() => {
      return Promise.resolve({ status: 500 });
    });

    const result = await testUrls(['http://fail1.local', 'http://fail2.local']);
    expect(result).toBe('http://fail1.local');
  });
});
