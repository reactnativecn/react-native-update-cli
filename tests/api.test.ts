import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from 'bun:test';
import fs from 'fs';
import {
  closeSession,
  get,
  getApiToken,
  getSession,
  loadSession,
  replaceSession,
  saveSession,
  setApiToken,
} from '../src/api';
import * as runtime from '../src/utils/runtime';

describe('api.ts session management', () => {
  let originalConsoleError: typeof console.error;
  let existsSyncSpy: ReturnType<typeof spyOn>;
  let readFileSyncSpy: ReturnType<typeof spyOn>;
  let writeFileSyncSpy: ReturnType<typeof spyOn>;
  let unlinkSyncSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    originalConsoleError = console.error;
    console.error = mock(() => {});
  });

  afterEach(() => {
    console.error = originalConsoleError;
    existsSyncSpy?.mockRestore();
    readFileSyncSpy?.mockRestore();
    writeFileSyncSpy?.mockRestore();
    unlinkSyncSpy?.mockRestore();
  });

  test('loadSession loads valid session from file', async () => {
    existsSyncSpy = spyOn(fs, 'existsSync').mockReturnValue(true);
    readFileSyncSpy = spyOn(fs, 'readFileSync').mockReturnValue(
      JSON.stringify({ token: 'test-token-123' }),
    );

    await loadSession();
    const session = getSession();

    expect(session).toBeDefined();
    expect(session?.token).toBe('test-token-123');
  });

  test('loadSession handles missing credential file gracefully', async () => {
    existsSyncSpy = spyOn(fs, 'existsSync').mockReturnValue(false);

    await loadSession();
    // Should not throw
  });

  test('loadSession throws on invalid JSON in credential file', async () => {
    existsSyncSpy = spyOn(fs, 'existsSync').mockReturnValue(true);
    readFileSyncSpy = spyOn(fs, 'readFileSync').mockReturnValue(
      '{ invalid json',
    );

    await expect(loadSession()).rejects.toThrow(SyntaxError);
  });

  test('loadSession throws when reading credential file fails', async () => {
    existsSyncSpy = spyOn(fs, 'existsSync').mockReturnValue(true);
    readFileSyncSpy = spyOn(fs, 'readFileSync').mockImplementation(() => {
      throw new Error('Read error');
    });

    await expect(loadSession()).rejects.toThrow('Read error');
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to parse file'),
    );
  });
  test('replaceSession sets session', () => {
    replaceSession({ token: 'new-token' });
    expect(getSession()?.token).toBe('new-token');
  });

  test('saveSession writes to file only when session changed', () => {
    writeFileSyncSpy = spyOn(fs, 'writeFileSync').mockImplementation(() => {});

    // Replace with a new session so it differs from savedSession
    replaceSession({ token: 'changed-token' });
    saveSession();

    expect(writeFileSyncSpy).toHaveBeenCalled();
    const writtenData = writeFileSyncSpy.mock.calls[0][1];
    expect(JSON.parse(writtenData as string).token).toBe('changed-token');
  });

  test('closeSession removes credential file and clears session', () => {
    existsSyncSpy = spyOn(fs, 'existsSync').mockReturnValue(true);
    unlinkSyncSpy = spyOn(fs, 'unlinkSync').mockImplementation(() => {});

    replaceSession({ token: 'to-be-cleared' });
    closeSession();

    expect(unlinkSyncSpy).toHaveBeenCalled();
    expect(getSession()).toBeUndefined();
  });

  test('closeSession handles missing credential file', () => {
    existsSyncSpy = spyOn(fs, 'existsSync').mockReturnValue(false);

    // Should not throw
    closeSession();
    expect(getSession()).toBeUndefined();
  });
});

describe('api.ts token management', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test('setApiToken and getApiToken work correctly', () => {
    setApiToken('my-api-token');
    expect(getApiToken()).toBe('my-api-token');
  });

  test('loadSession picks up PUSHY_API_TOKEN from environment', async () => {
    process.env.PUSHY_API_TOKEN = 'env-token-pushy';
    const existsSyncSpy = spyOn(fs, 'existsSync').mockReturnValue(false);

    await loadSession();

    expect(getApiToken()).toBe('env-token-pushy');
    existsSyncSpy.mockRestore();
  });
});

describe('api.ts query API methods', () => {
  let runtimeFetchSpy: ReturnType<typeof spyOn>;
  let originalConsoleWarn: typeof console.warn;
  let getBaseUrlSpy: ReturnType<typeof spyOn>;
  let _httpHelperBaseUrl: any;

  beforeEach(() => {
    originalConsoleWarn = console.warn;
    console.warn = mock(() => {});
  });

  afterEach(() => {
    console.warn = originalConsoleWarn;
    runtimeFetchSpy?.mockRestore();
    getBaseUrlSpy?.mockRestore();
  });

  test('query throws correctly formatted error on network failure', async () => {
    runtimeFetchSpy = spyOn(runtime, 'runtimeFetch').mockImplementation(
      async () => {
        throw new Error('Network disconnected');
      },
    );

    let error: any;
    try {
      await get('/test-endpoint');
    } catch (e) {
      error = e;
    }

    expect(error).toBeDefined();
    expect(error.message).toContain('Network disconnected');
    expect(error.message).toContain('URL:');
  });

  test('query warns on 200 status with non-JSON body', async () => {
    const nonJsonText = 'Not a JSON response';
    runtimeFetchSpy = spyOn(runtime, 'runtimeFetch').mockImplementation(
      async () =>
        ({
          status: 200,
          statusText: 'OK',
          text: async () => nonJsonText,
        }) as any,
    );

    let _error: any;
    try {
      await get('/test-endpoint');
    } catch (e) {
      _error = e;
    }

    expect(console.warn).toHaveBeenCalled();
    const warnMessage = (console.warn as import('bun:test').Mock<any>).mock
      .calls[0][0];
    expect(warnMessage).toContain(
      'Warning: API returned 200 with non-JSON body',
    );
    expect(warnMessage).toContain(String(nonJsonText.length));
  });

  test('query throws on non-200 HTTP status', async () => {
    runtimeFetchSpy = spyOn(runtime, 'runtimeFetch').mockImplementation(
      async () =>
        ({
          status: 500,
          statusText: 'Internal Server Error',
          text: async () => JSON.stringify({ message: 'Database failure' }),
        }) as any,
    );

    let error: any;
    try {
      await get('/test-endpoint');
    } catch (e) {
      error = e;
    }

    expect(error).toBeDefined();
    expect(error.message).toContain('Database failure');
    expect(error.status).toBe(500);
  });
});
