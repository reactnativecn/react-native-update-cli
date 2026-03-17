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
import { loadSession } from '../src/api';

describe('api.ts loadSession', () => {
  let originalConsoleError: any;
  let existsSyncSpy: any;
  let readFileSyncSpy: any;

  beforeEach(() => {
    originalConsoleError = console.error;
    console.error = mock(() => {});

    // Use spyOn to mock specific fs methods
    existsSyncSpy = spyOn(fs, 'existsSync').mockReturnValue(true);
    readFileSyncSpy = spyOn(fs, 'readFileSync').mockReturnValue(
      '{ "invalid": json ',
    );
  });

  afterEach(() => {
    console.error = originalConsoleError;
    existsSyncSpy.mockRestore();
    readFileSyncSpy.mockRestore();
  });

  test('loadSession throws error on JSON parse failure', async () => {
    // Assert that the Promise rejects with a SyntaxError (JSON parse error)
    await expect(loadSession()).rejects.toThrow(SyntaxError);
    // Verify that console.error was called
    expect(console.error).toHaveBeenCalled();
  });
});
