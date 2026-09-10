import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'child_process';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import {
  compileHermesByteCode,
  hermesBaseErrorLogPath,
  startHermesBaseSelection,
} from '../src/bundle-runner';
import { getHbcVersion } from '../src/utils/hbcTransform';
import { probeHbcVersion } from '../src/utils/hermes-base';

// Same discovery as hermes-base.test.ts: HERMESC env or the SDK repo's hermesc.
const HERMESC_CANDIDATES = [
  path.resolve(
    __dirname,
    '../../react-native-update/Example/testHotUpdate/node_modules/hermes-compiler/hermesc/osx-bin/hermesc',
  ),
  path.resolve(
    __dirname,
    '../../react-native-update/.e2e-rn077-oldarch/AwesomeProject/node_modules/react-native/sdks/hermesc/osx-bin/hermesc',
  ),
];
const hermesc =
  process.env.HERMESC || HERMESC_CANDIDATES.find((p) => fs.existsSync(p));
const hasHermesc = Boolean(hermesc) && fs.existsSync(hermesc!);

const BASE_SRC = "var s = 'foo'; print(s, 'bar', 'baz'); var t = 'qux';\n";
const NEXT_SRC = `${BASE_SRC}var o = {}; o.foo = 1; o.bar = 2; print(o.foo, o.bar, o.qux, [1, 'new1', 'new2']);\n`;

describe.if(hasHermesc)('compileHermesByteCode with a base', () => {
  let dir: string;
  let outputFolder: string;
  let baseHbc: string;
  const previousCache = process.env.PUSHY_CACHE_DIR;
  const bundleName = 'index.bundlejs';

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rnu-hermes-compile-'));
    process.env.PUSHY_CACHE_DIR = path.join(dir, 'cache');
    outputFolder = path.join(dir, 'out');
    fs.ensureDirSync(outputFolder);
    fs.writeFileSync(path.join(outputFolder, bundleName), NEXT_SRC);
    const baseJs = path.join(dir, 'base.js');
    fs.writeFileSync(baseJs, BASE_SRC);
    baseHbc = path.join(dir, 'base.hbc');
    const status = spawnSync(
      hermesc!,
      ['-emit-binary', '-out', baseHbc, baseJs, '-O', '-w'],
      { stdio: 'ignore' },
    ).status;
    expect(status).toBe(0);
  });
  afterEach(() => {
    if (previousCache === undefined) delete process.env.PUSHY_CACHE_DIR;
    else process.env.PUSHY_CACHE_DIR = previousCache;
    fs.removeSync(dir);
  });

  // anything but the bundle and its hermes map is a leftover
  const leftovers = () =>
    fs
      .readdirSync(outputFolder)
      .filter((n) => n !== bundleName && n !== `${bundleName}.map`);

  test('verified base compile: plain compile runs alongside and is discarded', async () => {
    const result = await compileHermesByteCode({
      bundleName,
      outputFolder,
      sourcemapOutput: '',
      shouldCleanSourcemap: true,
      baseRequest: { option: baseHbc, verify: true },
      hermesCommand: hermesc!,
    });
    expect(result.base?.source).toBe('local');
    expect(result.verified).toBe(true);
    expect(result.outcome).toBe('used');
    expect(result.outcomeDetail).toBeUndefined();
    const out = fs.readFileSync(path.join(outputFolder, bundleName));
    expect(getHbcVersion(out)).toBe(result.bytecodeVersion);
    expect(fs.existsSync(path.join(outputFolder, `${bundleName}.map`))).toBe(
      true,
    );
    expect(leftovers()).toEqual([]);
  });

  test('unverified base compile skips the plain compile', async () => {
    const result = await compileHermesByteCode({
      bundleName,
      outputFolder,
      sourcemapOutput: '',
      shouldCleanSourcemap: true,
      baseRequest: { option: baseHbc, verify: false },
      hermesCommand: hermesc!,
    });
    expect(result.base?.source).toBe('local');
    expect(result.verified).toBeUndefined();
    // unverified but shipped with the base: still 'used'
    expect(result.outcome).toBe('used');
    expect(
      getHbcVersion(fs.readFileSync(path.join(outputFolder, bundleName))),
    ).toBe(result.bytecodeVersion);
    expect(leftovers()).toEqual([]);
  });

  test('a base hermesc rejects falls back to the concurrent plain compile', async () => {
    // right HBC version so the base is accepted, garbage after the header so
    // hermesc refuses it
    const version = probeHbcVersion(hermesc!)!;
    const bogus = path.join(dir, 'bogus.hbc');
    const buf = Buffer.alloc(256, 0xaa);
    Buffer.from('c61fbc03c103191f', 'hex').copy(buf, 0);
    buf.writeUInt32LE(version, 8);
    fs.writeFileSync(bogus, buf);
    const result = await compileHermesByteCode({
      bundleName,
      outputFolder,
      sourcemapOutput: '',
      shouldCleanSourcemap: true,
      baseRequest: { option: bogus, verify: true },
      hermesCommand: hermesc!,
    });
    expect(result.base).toBeNull();
    expect(result.verified).toBeUndefined();
    // the base compile itself failed: no base at all, with the reason
    expect(result.outcome).toBe('none');
    expect(result.outcomeDetail).toMatch(/^base compile failed: /);
    const out = fs.readFileSync(path.join(outputFolder, bundleName));
    expect(getHbcVersion(out)).toBe(version);
    // the plain compile's sourcemap took the real bundle's place
    expect(fs.existsSync(path.join(outputFolder, `${bundleName}.map`))).toBe(
      true,
    );
    // the full compiler output lands next to the intermediate dir, never in
    // it: everything inside is packed into the ppk
    const errorLog = hermesBaseErrorLogPath(outputFolder);
    expect(errorLog.startsWith(path.resolve(outputFolder))).toBe(false);
    expect(fs.existsSync(errorLog)).toBe(true);
    expect(leftovers()).toEqual([]);
  });

  test('a failed verification compile drops the base instead of shipping it unverified', async () => {
    // A wrapper that logs every invocation, fails only the plain compile into
    // `plain/` (the one the check needs) and defers everything else to the
    // real hermesc. It sits under a react-native/sdks/hermesc path because
    // the selection gates on the command's location.
    const wrapperDir = path.join(
      dir,
      'node_modules/react-native/sdks/hermesc/linux64-bin',
    );
    fs.ensureDirSync(wrapperDir);
    const wrapper = path.join(wrapperDir, 'hermesc');
    const calls = path.join(dir, 'hermesc-calls.log');
    fs.writeFileSync(
      wrapper,
      `#!/bin/sh
echo "$*" >> "${calls}"
case "$*" in *"/plain/"*) echo "simulated plain compile failure" >&2; exit 3;; esac
exec "${hermesc}" "$@"
`,
      { mode: 0o755 },
    );
    const result = await compileHermesByteCode({
      bundleName,
      outputFolder,
      sourcemapOutput: '',
      shouldCleanSourcemap: true,
      baseRequest: { option: baseHbc, verify: true },
      hermesCommand: wrapper,
    });
    // same policy as a dump that could not be read: base dropped, plain shipped
    expect(result.base).toBeNull();
    expect(result.verified).toBeUndefined();
    expect(result.outcome).toBe('dump-failed');
    expect(result.outcomeDetail).toBe('plain compile failed: exit 3');
    const out = fs.readFileSync(path.join(outputFolder, bundleName));
    expect(getHbcVersion(out)).toBe(probeHbcVersion(hermesc!)!);
    // three compiles: with the base, the failed check compile, and the plain
    // recompile that replaced the base output (no dump ever ran); the HBC
    // version probe compiles too, but into the temp dir
    const compiles = fs
      .readFileSync(calls, 'utf8')
      .trim()
      .split('\n')
      .filter(
        (line) => line.includes('-emit-binary') && line.includes(outputFolder),
      );
    expect(compiles).toHaveLength(3);
    // the first two run concurrently (either order); the recompile is last
    const concurrent = compiles.slice(0, 2);
    expect(concurrent.filter((c) => c.includes('-base-bytecode=')).length).toBe(
      1,
    );
    expect(concurrent.filter((c) => c.includes('/plain/')).length).toBe(1);
    expect(compiles[2]).not.toContain('-base-bytecode=');
    expect(compiles[2]).not.toContain('/plain/');
    expect(fs.readFileSync(calls, 'utf8')).not.toContain('-dump-bytecode');
    expect(leftovers()).toEqual([]);
  });

  test('a selection started ahead of time is consumed by the compile', async () => {
    const pending = startHermesBaseSelection({
      option: baseHbc,
      verify: true,
    }).then((selection) => ({ ...selection, commandUnavailable: false }));
    // the runner resolves hermesc from the project; here that fails, so the
    // compile must fall back to selecting again with the injected command
    const unavailable = await startHermesBaseSelection({
      option: baseHbc,
      verify: true,
    });
    expect(unavailable.commandUnavailable).toBe(true);
    const result = await compileHermesByteCode({
      bundleName,
      outputFolder,
      sourcemapOutput: '',
      shouldCleanSourcemap: true,
      baseRequest: { option: baseHbc, verify: true },
      pendingBase: Promise.resolve(unavailable),
      hermesCommand: hermesc!,
    });
    expect(result.base?.source).toBe('local');
    expect(result.verified).toBe(true);
    expect(result.outcome).toBe('used');
    await pending;
  });
});

describe('hermesBaseDumpPaths', () => {
  test('is off unless PUSHY_HERMES_BASE_DEBUG is set to something truthy', async () => {
    const { hermesBaseDumpPaths } = await import('../src/bundle-runner');
    const out = path.join(os.tmpdir(), 'rnu-dump', 'intermedia', 'android');
    expect(hermesBaseDumpPaths(out, {})).toBeUndefined();
    expect(
      hermesBaseDumpPaths(out, { PUSHY_HERMES_BASE_DEBUG: '0' }),
    ).toBeUndefined();
    expect(
      hermesBaseDumpPaths(out, { PUSHY_HERMES_BASE_DEBUG: 'false' }),
    ).toBeUndefined();
    // next to the intermediate dir, never inside it (its content is packed)
    expect(hermesBaseDumpPaths(out, { PUSHY_HERMES_BASE_DEBUG: '1' })).toEqual({
      withBase: path.join(
        os.tmpdir(),
        'rnu-dump',
        'intermedia',
        'hermes-base-dump-base.txt',
      ),
      plain: path.join(
        os.tmpdir(),
        'rnu-dump',
        'intermedia',
        'hermes-base-dump-plain.txt',
      ),
    });
  });
});
