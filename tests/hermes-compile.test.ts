import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'child_process';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import {
  compileHermesByteCode,
  startHermesBaseSelection,
} from '../src/bundle-runner';
import { getHbcVersion } from '../src/utils/hbcTransform';
import { probeHbcVersion } from '../src/utils/hermes-base';

// Same discovery as hermes-base.test.ts: a real hermesc from the SDK repo.
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
const hermesc = HERMESC_CANDIDATES.find((p) => fs.existsSync(p));
const hasHermesc = Boolean(hermesc) && os.platform() === 'darwin';

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

  const leftovers = () =>
    fs
      .readdirSync(outputFolder)
      .filter((n) => n.endsWith('.bak') || n === '.hermes-plain');

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
    const out = fs.readFileSync(path.join(outputFolder, bundleName));
    expect(getHbcVersion(out)).toBe(version);
    // the plain compile's sourcemap took the real bundle's place
    expect(fs.existsSync(path.join(outputFolder, `${bundleName}.map`))).toBe(
      true,
    );
    expect(
      fs.existsSync(path.join(outputFolder, 'hermes-base-error.log')),
    ).toBe(true);
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
    await pending;
  });
});
