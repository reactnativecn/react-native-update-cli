import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  buildSentrySourcemapsUploadArgs,
  hasProjectDependency,
  resolveExpoCli,
  resolveHermesCommand,
} from '../src/bundle-runner';

function mkTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function _writeFile(filePath: string, content = ''): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function hermesOSBin(): string {
  if (os.platform() === 'win32') return 'win64-bin';
  if (os.platform() === 'darwin') return 'osx-bin';
  return 'linux64-bin';
}

function hermesExecutableName(): string {
  return os.platform() === 'win32' ? 'hermesc.exe' : 'hermesc';
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

describe('resolveHermesCommand', () => {
  let tempRoot = '';

  beforeEach(() => {
    tempRoot = mkTempDir('rn-update-hermes-');
  });

  afterEach(() => {
    if (tempRoot && fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('resolves hermes-compiler path used by React Native 0.85', () => {
    const hermesCommand = path.join(
      tempRoot,
      'node_modules',
      'hermes-compiler',
      'hermesc',
      hermesOSBin(),
      hermesExecutableName(),
    );
    writeJson(
      path.join(tempRoot, 'node_modules/hermes-compiler/package.json'),
      {
        name: 'hermes-compiler',
        version: '250829098.0.10',
      },
    );
    _writeFile(hermesCommand);

    expect(resolveHermesCommand(tempRoot)).toBe(hermesCommand);
  });

  test('keeps compatibility with legacy react-native sdks hermesc path', () => {
    const hermesCommand = path.join(
      tempRoot,
      'node_modules',
      'react-native',
      'sdks',
      'hermesc',
      hermesOSBin(),
      hermesExecutableName(),
    );
    writeJson(path.join(tempRoot, 'node_modules/react-native/package.json'), {
      name: 'react-native',
      version: '0.69.0',
    });
    _writeFile(hermesCommand);

    expect(resolveHermesCommand(tempRoot)).toBe(hermesCommand);
  });

  test('keeps compatibility with legacy hermes-engine package path', () => {
    const hermesCommand = path.join(
      tempRoot,
      'node_modules',
      'hermes-engine',
      hermesOSBin(),
      hermesExecutableName(),
    );
    writeJson(path.join(tempRoot, 'node_modules/hermes-engine/package.json'), {
      name: 'hermes-engine',
      version: '0.11.0',
    });
    _writeFile(hermesCommand);

    expect(resolveHermesCommand(tempRoot)).toBe(hermesCommand);
  });
});

describe('buildSentrySourcemapsUploadArgs', () => {
  test('uses the Sentry sourcemaps command supported by current CLI versions', () => {
    const args = buildSentrySourcemapsUploadArgs(
      '/bin/sentry-cli',
      'index.android.bundle',
      'build/intermedia',
      '1.0.0',
    );

    expect(args).toEqual([
      '/bin/sentry-cli',
      'sourcemaps',
      'upload',
      '--release',
      '1.0.0',
      '--strip-prefix',
      path.join(process.cwd(), 'build/intermedia'),
      path.join('build/intermedia', 'index.android.bundle'),
      path.join('build/intermedia', 'index.android.bundle.map'),
    ]);
    expect(args).not.toContain('files');
    expect(args).not.toContain('upload-sourcemaps');
  });

  test('keeps the legacy releases files command for old Sentry CLI versions', () => {
    const args = buildSentrySourcemapsUploadArgs(
      '/bin/sentry-cli',
      'index.android.bundle',
      'build/intermedia',
      '1.0.0',
      false,
    );

    expect(args).toEqual([
      '/bin/sentry-cli',
      'releases',
      'files',
      '1.0.0',
      'upload-sourcemaps',
      '--strip-prefix',
      path.join(process.cwd(), 'build/intermedia'),
      path.join('build/intermedia', 'index.android.bundle'),
      path.join('build/intermedia', 'index.android.bundle.map'),
    ]);
  });
});
