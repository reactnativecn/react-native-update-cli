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
  describeNetworkCause,
  get,
  getApiToken,
  getSession,
  isTransientUploadError,
  loadSession,
  redactRequestUrl,
  replaceSession,
  saveSession,
  setApiToken,
  uploadTimeoutMs,
} from '../src/api';
import * as httpHelper from '../src/utils/http-helper';
import { t } from '../src/utils/i18n';
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

  test('loadSession throws on invalid JSON in credential file', async () => {
    existsSyncSpy = spyOn(fs, 'existsSync').mockReturnValue(true);
    readFileSyncSpy = spyOn(fs, 'readFileSync').mockReturnValue(
      '{ invalid json',
    );

    await expect(loadSession()).rejects.toThrow(SyntaxError);
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

  test('saveSession restricts the token file to owner-only permissions', () => {
    writeFileSyncSpy = spyOn(fs, 'writeFileSync').mockImplementation(() => {});
    const chmodSyncSpy = spyOn(fs, 'chmodSync').mockImplementation(() => {});

    try {
      replaceSession({ token: 'perm-token' });
      saveSession();

      expect(writeFileSyncSpy.mock.calls[0][2]).toEqual({
        encoding: 'utf8',
        mode: 0o600,
      });
      expect(chmodSyncSpy).toHaveBeenCalledWith(expect.any(String), 0o600);
    } finally {
      chmodSyncSpy.mockRestore();
    }
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
    expect(error.cause).toBeInstanceOf(Error);
  });

  test('query preserves nested proxy failure causes', async () => {
    const socketError = Object.assign(new Error('connection refused'), {
      code: 'ECONNREFUSED',
    });
    const fetchError = new Error('fetch failed', { cause: socketError });
    runtimeFetchSpy = spyOn(runtime, 'runtimeFetch').mockRejectedValue(
      fetchError,
    );

    let error: any;
    try {
      await get('/test-endpoint');
    } catch (e) {
      error = e;
    }

    expect(error).toBeDefined();
    expect(error.cause).toBeInstanceOf(Error);
    expect(error.cause.cause).toBe(fetchError);
    expect(fetchError.cause).toBe(socketError);
  });

  test('query throws on 200 status with non-JSON body', async () => {
    const nonJsonText = 'Not a JSON response';
    runtimeFetchSpy = spyOn(runtime, 'runtimeFetch').mockImplementation(
      async () =>
        ({
          status: 200,
          statusText: 'OK',
          text: async () => nonJsonText,
        }) as any,
    );

    let error: any;
    try {
      await get('/test-endpoint');
    } catch (e) {
      error = e;
    }

    expect(error).toBeDefined();
    expect(error.message).toContain('API returned 200 with non-JSON body');
    expect(error.message).toContain(String(nonJsonText.length));
    expect(error.status).toBe(200);
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

describe('api.ts error helpers', () => {
  test('redacts signed query strings and URL credentials', () => {
    const redacted = redactRequestUrl(
      'https://alice:secret@example.com/upload?X-Amz-Signature=top-secret#fragment',
    );
    expect(redacted).toBe('https://example.com/upload?<redacted>');
    expect(redacted).not.toContain('secret');
    expect(redacted).not.toContain('alice');
  });

  test('treats an upload deadline as transient', () => {
    expect(
      isTransientUploadError({
        name: 'UploadTimeoutError',
        code: 'ETIMEDOUT',
        message: 'Upload timed out',
      }),
    ).toBe(true);
  });
  test('upload deadline allows 5 s per MB on a 30 s base, at least 60 s', () => {
    const mb = 1048576;
    expect(uploadTimeoutMs(0)).toBe(60_000);
    expect(uploadTimeoutMs(5 * mb)).toBe(60_000);
    expect(uploadTimeoutMs(10 * mb)).toBe(80_000);
    expect(uploadTimeoutMs(100 * mb)).toBe(530_000);
    // a partial megabyte counts as a whole one
    expect(uploadTimeoutMs(100 * mb + 1)).toBe(535_000);
  });
});

describe('network failure diagnostics', () => {
  let runtimeFetchSpy: ReturnType<typeof spyOn> | undefined;
  let fallbackSpy: ReturnType<typeof spyOn> | undefined;

  afterEach(() => {
    runtimeFetchSpy?.mockRestore();
    fallbackSpy?.mockRestore();
  });

  const coded = (message: string, code: string, name = 'Error') =>
    Object.assign(new Error(message), { code, name });

  test('describeNetworkCause surfaces the code hidden behind "fetch failed"', () => {
    const dns = coded('getaddrinfo ENOTFOUND 1.rnupdate.online', 'ENOTFOUND');
    expect(
      describeNetworkCause(new Error('fetch failed', { cause: dns })),
    ).toBe('getaddrinfo ENOTFOUND 1.rnupdate.online');

    const tls = coded(
      'unable to get local issuer certificate',
      'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
    );
    expect(
      describeNetworkCause(new Error('fetch failed', { cause: tls })),
    ).toBe(
      'UNABLE_TO_GET_ISSUER_CERT_LOCALLY: unable to get local issuer certificate',
    );
  });

  test('describeNetworkCause reads the first error of an AggregateError', () => {
    const aggregate = new AggregateError(
      [coded('connect ECONNREFUSED 1.2.3.4:443', 'ECONNREFUSED')],
      '',
    );
    expect(
      describeNetworkCause(new Error('fetch failed', { cause: aggregate })),
    ).toBe('connect ECONNREFUSED 1.2.3.4:443');
  });

  test('describeNetworkCause returns undefined without a useful cause', () => {
    expect(describeNetworkCause(new Error('boom'))).toBeUndefined();
    expect(
      describeNetworkCause(
        new Error('fetch failed', { cause: new Error('fetch failed') }),
      ),
    ).toBeUndefined();
  });

  async function failingGet(cause: Error, unreachable: boolean) {
    runtimeFetchSpy = spyOn(runtime, 'runtimeFetch').mockRejectedValue(
      new Error('fetch failed', { cause }),
    );
    fallbackSpy = spyOn(
      httpHelper,
      'isBaseUrlUnreachableFallback',
    ).mockReturnValue(unreachable);
    try {
      await get('/user/login');
    } catch (e) {
      return e as Error;
    }
    throw new Error('expected get to fail');
  }

  test('connect timeouts get the cause and the network hints', async () => {
    const error = await failingGet(
      coded(
        'Connect Timeout Error (attempted address: 1.rnupdate.online:443, timeout: 10000ms)',
        'UND_ERR_CONNECT_TIMEOUT',
        'ConnectTimeoutError',
      ),
      false,
    );
    expect(error.message).toContain(
      'fetch failed (UND_ERR_CONNECT_TIMEOUT: Connect Timeout Error',
    );
    expect(error.message).toContain(t('proxyNetworkError'));
    expect(error.message).not.toContain(
      t('allEndpointsUnreachable', { example: '' }).slice(0, 10),
    );
  });

  test('says so when no endpoint answered the ping', async () => {
    const error = await failingGet(
      coded('getaddrinfo ENOTFOUND 1.rnupdate.online', 'ENOTFOUND'),
      true,
    );
    expect(error.message).toContain('RNU_API=');
    expect(error.message).toContain(
      t('allEndpointsUnreachable', { example: '' }).slice(0, 10),
    );
  });
});
