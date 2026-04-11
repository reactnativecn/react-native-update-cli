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
import os from 'os';
import path from 'path';
import { hasProjectDependency, resolveExpoCli } from '../src/bundle-runner';

function mkTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function writeFile(filePath: string, content = ''): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

describe('hasProjectDependency', () => {
  let tempRoot = '';

  beforeEach(() => {
    tempRoot = mkTempDir('rn-update-has-dep-');
  });

  afterEach(() => {
    if (tempRoot && fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('returns true when dependency is in dependencies', () => {
    writeJson(path.join(tempRoot, 'package.json'), {
      dependencies: { expo: '^54.0.0' },
    });
    expect(hasProjectDependency('expo', tempRoot)).toBe(true);
  });

  test('returns true when dependency is in devDependencies', () => {
    writeJson(path.join(tempRoot, 'package.json'), {
      devDependencies: { jest: '^30.0.0' },
    });
    expect(hasProjectDependency('jest', tempRoot)).toBe(true);
  });

  test('returns true when dependency is in peerDependencies', () => {
    writeJson(path.join(tempRoot, 'package.json'), {
      peerDependencies: { react: '>=18.0.0' },
    });
    expect(hasProjectDependency('react', tempRoot)).toBe(true);
  });

  test('returns true when dependency is in optionalDependencies', () => {
    writeJson(path.join(tempRoot, 'package.json'), {
      optionalDependencies: { fsevents: '^2.0.0' },
    });
    expect(hasProjectDependency('fsevents', tempRoot)).toBe(true);
  });

  test('returns false when dependency is not present anywhere', () => {
    writeJson(path.join(tempRoot, 'package.json'), {
      dependencies: { 'react-native': '0.82.0' },
    });
    expect(hasProjectDependency('expo', tempRoot)).toBe(false);
  });

  test('returns false when package.json does not exist', () => {
    expect(hasProjectDependency('expo', tempRoot)).toBe(false);
  });

  test('returns false when package.json has no dependency fields', () => {
    writeJson(path.join(tempRoot, 'package.json'), {
      name: 'test-app',
      version: '1.0.0',
    });
    expect(hasProjectDependency('expo', tempRoot)).toBe(false);
  });

  test('returns false when dependency field is null', () => {
    writeJson(path.join(tempRoot, 'package.json'), {
      dependencies: null,
      devDependencies: null,
    });
    expect(hasProjectDependency('expo', tempRoot)).toBe(false);
  });
});

describe('resolveExpoCli edge cases', () => {
  let originalCwd = '';
  let tempRoot = '';

  beforeEach(() => {
    originalCwd = process.cwd();
    tempRoot = mkTempDir('rn-update-expo-');
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (tempRoot && fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('returns empty when no package.json exists', () => {
    const resolved = resolveExpoCli(tempRoot);
    expect(resolved).toEqual({ cliPath: '', usingExpo: false });
  });

  test('returns empty when expo is in deps but @expo/cli not installed', () => {
    writeJson(path.join(tempRoot, 'package.json'), {
      dependencies: { expo: '^54.0.0' },
    });
    // No @expo/cli in node_modules

    const resolved = resolveExpoCli(tempRoot);
    expect(resolved.usingExpo).toBe(false);
  });
});
