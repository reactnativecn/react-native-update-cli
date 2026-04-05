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
mock.module('tty-table', () => ({
  __esModule: true,
  default: class Table {
    render() { return 'mocked table'; }
  },
}));
mock.module('i18next', () => ({
  __esModule: true,
  default: {
    use: () => ({
      init: () => {},
      t: (key: string) => key,
    }),
    t: (key: string) => key,
  },
  t: (key: string) => key,
}));
mock.module('chalk', () => ({
  __esModule: true,
  default: {
    green: (s: string) => s,
    red: (s: string) => s,
    yellow: (s: string) => s,
    blue: (s: string) => s,
    cyan: (s: string) => s,
    magenta: (s: string) => s,
  },
}));
mock.module('filesize-parser', () => ({
  __esModule: true,
  default: (s: string) => 1024,
}));
mock.module('form-data', () => ({
  __esModule: true,
  default: class FormData {
    append() {}
  },
}));
mock.module('node-fetch', () => ({
  __esModule: true,
  default: mock(async () => ({
    ok: true,
    json: async () => ({}),
  })),
}));
mock.module('progress', () => ({
  __esModule: true,
  default: class ProgressBar {
    tick() {}
  },
}));
mock.module('tcp-ping', () => ({
  __esModule: true,
  ping: (opts: any, cb: any) => cb(null, { avg: 10 }),
}));
mock.module('fs-extra', () => ({
  __esModule: true,
  default: {
    ensureDirSync: () => {},
    readFileSync: (f: string, e: string) => '{}',
    existsSync: () => true,
  },
}));
mock.module('read', () => ({
  __esModule: true,
  read: async () => 'mocked input',
}));
mock.module('compare-versions', () => ({
  __esModule: true,
  satisfies: () => true,
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
