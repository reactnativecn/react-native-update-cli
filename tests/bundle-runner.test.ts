import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { resolveExpoCli } from '../src/bundle-runner';

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

describe('bundle-runner expo cli detection', () => {
  let originalCwd = '';
  let tempRoot = '';

  beforeEach(() => {
    originalCwd = process.cwd();
    tempRoot = mkTempDir('rn-update-bundle-runner-');
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (tempRoot && fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('skips expo cli when project package.json does not depend on expo', () => {
    writeJson(path.join(tempRoot, 'package.json'), {
      name: 'plain-rn-app',
      dependencies: {
        'react-native': '0.82.1',
      },
    });
    writeJson(path.join(tempRoot, 'node_modules/@expo/cli/package.json'), {
      name: '@expo/cli',
      version: '0.10.17',
      main: 'build/index.js',
    });
    writeFile(path.join(tempRoot, 'node_modules/@expo/cli/build/index.js'));

    const resolved = resolveExpoCli(tempRoot);

    expect(resolved).toEqual({
      cliPath: '',
      usingExpo: false,
    });
  });

  test('uses expo cli when project package.json declares expo dependency', () => {
    writeJson(path.join(tempRoot, 'package.json'), {
      name: 'expo-app',
      dependencies: {
        expo: '^54.0.0',
      },
    });
    writeJson(path.join(tempRoot, 'node_modules/expo/package.json'), {
      name: 'expo',
      version: '54.0.0',
    });
    writeJson(path.join(tempRoot, 'node_modules/@expo/cli/package.json'), {
      name: '@expo/cli',
      version: '0.10.17',
      main: 'build/index.js',
    });
    writeFile(path.join(tempRoot, 'node_modules/@expo/cli/build/index.js'));

    const resolved = resolveExpoCli(tempRoot);

    expect(resolved.usingExpo).toBe(true);
    expect(fs.realpathSync(resolved.cliPath)).toBe(
      fs.realpathSync(
        path.join(tempRoot, 'node_modules/@expo/cli/build/index.js'),
      ),
    );
  });
});
