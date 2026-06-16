import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  buildSentrySourcemapsUploadArgs,
  hasProjectDependency,
  prepareSentryUploadArtifacts,
  readSourcemapDebugId,
  resolveExpoCli,
  resolveHermesCommand,
  resolveSentryUploadMode,
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
  test('uses Debug ID references for current Sentry CLI versions', () => {
    const args = buildSentrySourcemapsUploadArgs({
      sentryCliPath: '/bin/sentry-cli',
      bundlePath: path.join('build/intermedia', 'index.android.bundle'),
      sourcemapPath: path.join('build/intermedia', 'index.android.bundle.map'),
      debugIdReference: true,
    });

    expect(args).toEqual([
      '/bin/sentry-cli',
      'sourcemaps',
      'upload',
      '--debug-id-reference',
      '--strip-prefix',
      process.cwd(),
      path.join('build/intermedia', 'index.android.bundle'),
      path.join('build/intermedia', 'index.android.bundle.map'),
    ]);
    expect(args).not.toContain('--release');
    expect(args).not.toContain('--dist');
  });

  test('keeps explicit release and dist for legacy upload fallback', () => {
    const args = buildSentrySourcemapsUploadArgs({
      sentryCliPath: '/bin/sentry-cli',
      bundlePath: path.join('build/intermedia', 'index.android.bundle'),
      sourcemapPath: path.join('build/intermedia', 'index.android.bundle.map'),
      release: 'com.example@1.0.0+10+pushy:hash',
      dist: 'pushy:hash',
    });

    expect(args).toEqual([
      '/bin/sentry-cli',
      'sourcemaps',
      'upload',
      '--release',
      'com.example@1.0.0+10+pushy:hash',
      '--dist',
      'pushy:hash',
      '--strip-prefix',
      process.cwd(),
      path.join('build/intermedia', 'index.android.bundle'),
      path.join('build/intermedia', 'index.android.bundle.map'),
    ]);
    expect(args).not.toContain('files');
    expect(args).not.toContain('upload-sourcemaps');
  });

  test('keeps the legacy releases files command for old Sentry CLI versions', () => {
    const args = buildSentrySourcemapsUploadArgs({
      sentryCliPath: '/bin/sentry-cli',
      bundlePath: path.join('build/intermedia', 'index.android.bundle'),
      sourcemapPath: path.join('build/intermedia', 'index.android.bundle.map'),
      release: 'com.example@1.0.0+10+pushy:hash',
      dist: 'pushy:hash',
      useStandaloneSourcemapsCommand: false,
    });

    expect(args).toEqual([
      '/bin/sentry-cli',
      'releases',
      'files',
      'com.example@1.0.0+10+pushy:hash',
      'upload-sourcemaps',
      '--dist',
      'pushy:hash',
      '--strip-prefix',
      process.cwd(),
      path.join('build/intermedia', 'index.android.bundle'),
      path.join('build/intermedia', 'index.android.bundle.map'),
    ]);
  });
});

describe('Sentry Debug ID upload mode', () => {
  let tempRoot = '';
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    tempRoot = mkTempDir('rn-update-sentry-debug-id-');
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
    if (tempRoot && fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('reads debugId from source maps', () => {
    const sourcemapPath = path.join(tempRoot, 'index.bundlejs.map');
    writeJson(sourcemapPath, {
      version: 3,
      debugId: '85314830-023f-4cf1-a267-535f4e37bb17',
    });

    expect(readSourcemapDebugId(sourcemapPath)).toBe(
      '85314830-023f-4cf1-a267-535f4e37bb17',
    );
  });

  test('prefers Debug ID upload when the source map has a Debug ID', () => {
    const sourcemapPath = path.join(tempRoot, 'index.bundlejs.map');
    writeJson(sourcemapPath, {
      version: 3,
      debug_id: '85314830-023f-4cf1-a267-535f4e37bb17',
    });

    expect(resolveSentryUploadMode(sourcemapPath)).toEqual({
      type: 'debug-id',
      debugId: '85314830-023f-4cf1-a267-535f4e37bb17',
    });
  });

  test('uses explicit release and dist before Debug ID for legacy self-hosted fallback', () => {
    const sourcemapPath = path.join(tempRoot, 'index.bundlejs.map');
    writeJson(sourcemapPath, {
      version: 3,
      debug_id: '85314830-023f-4cf1-a267-535f4e37bb17',
    });

    expect(
      resolveSentryUploadMode(sourcemapPath, {
        sentryRelease: 'com.example@1.0.0+10+pushy:4.1',
        sentryDist: 'pushy:4.1',
      }),
    ).toEqual({
      type: 'release',
      release: 'com.example@1.0.0+10+pushy:4.1',
      dist: 'pushy:4.1',
    });
  });

  test('falls back to explicit release and dist when no Debug ID exists', () => {
    const sourcemapPath = path.join(tempRoot, 'index.bundlejs.map');
    writeJson(sourcemapPath, {
      version: 3,
    });

    expect(
      resolveSentryUploadMode(sourcemapPath, {
        sentryRelease: 'com.example@1.0.0+10+pushy:hash',
        sentryDist: 'pushy:hash',
      }),
    ).toEqual({
      type: 'release',
      release: 'com.example@1.0.0+10+pushy:hash',
      dist: 'pushy:hash',
    });
  });

  test('uses SENTRY_RELEASE and SENTRY_DIST for legacy fallback', () => {
    process.env.SENTRY_RELEASE = 'com.example@1.0.0+10+pushy:hash';
    process.env.SENTRY_DIST = 'pushy:hash';
    const sourcemapPath = path.join(tempRoot, 'index.bundlejs.map');
    writeJson(sourcemapPath, {
      version: 3,
    });

    expect(resolveSentryUploadMode(sourcemapPath)).toEqual({
      type: 'release',
      release: 'com.example@1.0.0+10+pushy:hash',
      dist: 'pushy:hash',
    });
  });

  test('fails loudly when neither Debug ID nor explicit release is available', () => {
    const sourcemapPath = path.join(tempRoot, 'index.bundlejs.map');
    writeJson(sourcemapPath, {
      version: 3,
    });

    expect(() => resolveSentryUploadMode(sourcemapPath)).toThrow(
      'Generated source map does not contain a Debug ID',
    );
  });
});

describe('prepareSentryUploadArtifacts', () => {
  let tempRoot = '';

  beforeEach(() => {
    tempRoot = mkTempDir('rn-update-sentry-artifacts-');
  });

  afterEach(() => {
    if (tempRoot && fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('aliases Android OTA bundles to the default Android bundle name', () => {
    _writeFile(path.join(tempRoot, 'index.bundlejs'), 'bundle');
    writeJson(path.join(tempRoot, 'index.bundlejs.map'), {
      version: 3,
      file: 'index.bundlejs',
      sources: ['src/App.tsx'],
    });

    const artifacts = prepareSentryUploadArtifacts(
      'index.bundlejs',
      tempRoot,
      'android',
    );

    expect(artifacts).toEqual({
      bundlePath: path.join(tempRoot, 'index.android.bundle'),
      sourcemapPath: path.join(tempRoot, 'index.android.bundle.map'),
    });
    expect(fs.readFileSync(artifacts.bundlePath, 'utf8')).toBe('bundle');
    expect(
      JSON.parse(fs.readFileSync(artifacts.sourcemapPath, 'utf8')),
    ).toEqual({
      version: 3,
      file: 'index.android.bundle',
      sources: ['src/App.tsx'],
    });
  });

  test('keeps non-Android artifacts unchanged', () => {
    const artifacts = prepareSentryUploadArtifacts(
      'index.bundlejs',
      tempRoot,
      'ios',
    );

    expect(artifacts).toEqual({
      bundlePath: path.join(tempRoot, 'index.bundlejs'),
      sourcemapPath: path.join(tempRoot, 'index.bundlejs.map'),
    });
  });
});
