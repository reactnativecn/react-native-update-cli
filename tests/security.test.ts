import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from 'bun:test';

// Mock missing dependencies BEFORE any imports
// We only mock what is absolutely necessary for loading modules in this environment
// to avoid interfering with other tests in CI where these modules are present.
mock.module('tty-table', () => ({
  __esModule: true,
  default: class Table {
    render() { return 'mocked table'; }
  },
}));

import fs from 'fs';
import { saveSession, replaceSession } from '../src/api';
import { appCommands } from '../src/app';
import { credentialFile } from '../src/utils/constants';

// Mock the get function in api.ts
mock.module('../src/api', () => {
  const original = require('../src/api');
  return {
    ...original,
    get: mock(async () => ({ appKey: 'test-app-key' })),
  };
});

describe('Security: File Permissions', () => {
  const testFiles = [credentialFile, 'update.json', 'cresc.config.json'];

  beforeEach(() => {
    // Clean up any existing files
    for (const file of testFiles) {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    }
  });

  afterEach(() => {
    // Clean up
    for (const file of testFiles) {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    }
  });

  test('saveSession should create credentialFile with 0o600 permissions', () => {
    replaceSession({ token: 'test-token' });
    saveSession();

    expect(fs.existsSync(credentialFile)).toBe(true);
    const stats = fs.statSync(credentialFile);
    expect(stats.mode & 0o777).toBe(0o600);
  });

  test('selectApp should create update.json with 0o600 permissions', async () => {
    await appCommands.selectApp({
      args: ['123'],
      options: { platform: 'ios' },
    });

    const targetFile = 'update.json';
    expect(fs.existsSync(targetFile)).toBe(true);
    const stats = fs.statSync(targetFile);
    expect(stats.mode & 0o777).toBe(0o600);
  });
});
