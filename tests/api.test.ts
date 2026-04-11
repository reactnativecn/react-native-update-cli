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
  getApiToken,
  getSession,
  loadSession,
  replaceSession,
  saveSession,
  setApiToken,
} from '../src/api';

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
