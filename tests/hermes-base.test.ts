import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'child_process';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { ZipFile } from 'yazl';
import {
  cacheDir,
  cacheLookup,
  cachePut,
  cacheStats,
  classifyHermesCommand,
  cleanCache,
  cleanStaleTmp,
  enforceCacheLimits,
  extractBundleFromArchive,
  hermesBaseMeta,
  hermescArgsWithBase,
  normalizeDisassemblyLine,
  probeHbcVersion,
  resolveHermesBase,
  sha256Hex,
  tmpDir,
  verifyHermesBaseEquivalence,
} from '../src/utils/hermes-base';

// A real hermesc when the workspace has one (Example app of the SDK repo);
// the compile-dependent tests are skipped otherwise.
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

function mkTemp(prefix: string) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

async function writeZip(zipPath: string, entries: Record<string, Buffer>) {
  const zip = new ZipFile();
  for (const [name, data] of Object.entries(entries)) {
    zip.addBuffer(data, name);
  }
  zip.end();
  await new Promise<void>((resolve, reject) => {
    zip.outputStream
      .pipe(fs.createWriteStream(zipPath))
      .on('close', () => resolve())
      .on('error', reject);
  });
}

function fakeHbc(version: number, payload = 'x'): Buffer {
  // magic (8) + version (4) + rest; enough for getHbcVersion
  const buf = Buffer.alloc(128 + payload.length);
  Buffer.from('c61fbc03c103191f', 'hex').copy(buf, 0);
  buf.writeUInt32LE(version, 8);
  buf.write(payload, 128);
  return buf;
}

describe('classifyHermesCommand', () => {
  let root: string;
  beforeEach(() => {
    root = mkTemp('rnu-hermes-gate-');
  });
  afterEach(() => {
    fs.removeSync(root);
  });

  test('classic hermesc locations are allowed', () => {
    expect(
      classifyHermesCommand(
        '/p/node_modules/react-native/sdks/hermesc/osx-bin/hermesc',
      ).allowed,
    ).toBe(true);
    expect(
      classifyHermesCommand('/p/node_modules/hermes-engine/osx-bin/hermesc')
        .allowed,
    ).toBe(true);
  });

  test('hermes-compiler builds are gated by version', () => {
    const cases: [string, boolean][] = [
      ['250829098.0.16', true],
      ['260318099.0.1', true],
      ['250601097.0.0', false],
      ['0.14.0-commitly-202509161340-d0d04cfaa', true],
      ['0.13.0-commitly-202507011340-abcdef123', false],
      ['0.17.0', true],
      ['0.12.0', false],
      ['weird', false],
    ];
    for (const [version, allowed] of cases) {
      const pkg = path.join(root, version, 'node_modules', 'hermes-compiler');
      fs.ensureDirSync(path.join(pkg, 'hermesc', 'osx-bin'));
      fs.writeJsonSync(path.join(pkg, 'package.json'), {
        name: 'hermes-compiler',
        version,
      });
      const result = classifyHermesCommand(
        path.join(pkg, 'hermesc', 'osx-bin', 'hermesc'),
      );
      expect([version, result.allowed]).toEqual([version, allowed]);
      expect(result.kind).toBe('hermes-compiler');
    }
  });

  test('unknown locations are refused', () => {
    expect(classifyHermesCommand('/usr/local/bin/hermesc').allowed).toBe(false);
  });
});

describe('bundle cache', () => {
  let dir: string;
  const previous = {
    cache: process.env.PUSHY_CACHE_DIR,
    max: process.env.PUSHY_CACHE_MAX_MB,
  };
  beforeEach(() => {
    dir = mkTemp('rnu-hermes-cache-');
    process.env.PUSHY_CACHE_DIR = dir;
    delete process.env.PUSHY_CACHE_MAX_MB;
  });
  afterEach(() => {
    if (previous.cache === undefined) delete process.env.PUSHY_CACHE_DIR;
    else process.env.PUSHY_CACHE_DIR = previous.cache;
    if (previous.max === undefined) delete process.env.PUSHY_CACHE_MAX_MB;
    else process.env.PUSHY_CACHE_MAX_MB = previous.max;
    fs.removeSync(dir);
  });

  test('put/lookup round-trips by sha256 and rejects corrupted content', async () => {
    expect(cacheDir()).toBe(dir);
    const bundle = Buffer.from('hello bundle');
    const { path: file, bundleHash } = await cachePut(bundle);
    expect(bundleHash).toBe(sha256Hex(bundle));
    expect(path.basename(file)).toBe(bundleHash);
    expect(await cacheLookup(bundleHash)).toBe(file);
    fs.writeFileSync(file, 'corrupted');
    expect(await cacheLookup(bundleHash)).toBeNull();
    expect(fs.existsSync(file)).toBe(false);
    expect(await cacheLookup('not-a-hash')).toBeNull();
  });

  test('evicts least recently used entries beyond the size limit', async () => {
    const a = await cachePut(Buffer.alloc(600 * 1024, 1), 1); // 1 MB limit
    await new Promise((r) => setTimeout(r, 20));
    const b = await cachePut(Buffer.alloc(600 * 1024, 2), 1);
    expect(fs.existsSync(b.path)).toBe(true);
    expect(fs.existsSync(a.path)).toBe(false);
    const stats = await cacheStats();
    expect(stats.files).toBe(1);
    await enforceCacheLimits(1);
    expect(await cleanCache()).toBe(1);
    expect((await cacheStats()).files).toBe(0);
  });

  test('cleanStaleTmp removes only old leftovers', async () => {
    const tmp = tmpDir();
    fs.ensureDirSync(tmp);
    const old = path.join(tmp, 'old.ppk');
    const fresh = path.join(tmp, 'fresh.ppk');
    fs.writeFileSync(old, 'x');
    fs.writeFileSync(fresh, 'y');
    const past = new Date(Date.now() - 2 * 24 * 3600 * 1000);
    fs.utimesSync(old, past, past);
    await cleanStaleTmp();
    expect(fs.existsSync(old)).toBe(false);
    expect(fs.existsSync(fresh)).toBe(true);
    fs.removeSync(tmp);
  });
});

describe('extractBundleFromArchive', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkTemp('rnu-hermes-extract-');
  });
  afterEach(() => {
    fs.removeSync(dir);
  });

  test('reads the bundle entry of a ppk and an apk', async () => {
    const bundle = fakeHbc(98, 'ppk');
    const ppk = path.join(dir, 'a.ppk');
    await writeZip(ppk, {
      'index.bundlejs': bundle,
      '__diff.json': Buffer.from('{}'),
    });
    expect((await extractBundleFromArchive(ppk))?.equals(bundle)).toBe(true);

    const apk = path.join(dir, 'a.apk');
    await writeZip(apk, {
      'assets/index.android.bundle': bundle,
      'AndroidManifest.xml': Buffer.from(''),
    });
    expect((await extractBundleFromArchive(apk))?.equals(bundle)).toBe(true);

    const raw = path.join(dir, 'a.hbc');
    fs.writeFileSync(raw, bundle);
    expect((await extractBundleFromArchive(raw))?.equals(bundle)).toBe(true);
  });

  test('returns null when no bundle entry exists', async () => {
    const ppk = path.join(dir, 'empty.ppk');
    await writeZip(ppk, { 'other.txt': Buffer.from('x') });
    expect(await extractBundleFromArchive(ppk)).toBeNull();
  });
});

describe('resolveHermesBase', () => {
  let dir: string;
  const previousCache = process.env.PUSHY_CACHE_DIR;
  const logs: string[] = [];
  beforeEach(() => {
    dir = mkTemp('rnu-hermes-resolve-');
    process.env.PUSHY_CACHE_DIR = path.join(dir, 'cache');
    logs.length = 0;
  });
  afterEach(() => {
    if (previousCache === undefined) delete process.env.PUSHY_CACHE_DIR;
    else process.env.PUSHY_CACHE_DIR = previousCache;
    fs.removeSync(dir);
  });
  const common = {
    hermesCommand: 'hermesc',
    bytecodeVersion: 98,
    log: (m: string) => logs.push(m),
  };

  test("'none' and missing app skip the base", async () => {
    expect(
      await resolveHermesBase({
        ...common,
        option: 'none',
        fetchBase: async () => null,
      }),
    ).toBeNull();
    expect(
      await resolveHermesBase({
        ...common,
        option: 'auto',
        fetchBase: async () => null,
      }),
    ).toBeNull();
    expect(logs.length).toBe(2);
  });

  test('explicit local ppk is used when its HBC version matches', async () => {
    const ppk = path.join(dir, 'base.ppk');
    const bundle = fakeHbc(98, 'local');
    await writeZip(ppk, { 'index.bundlejs': bundle });
    const selected = await resolveHermesBase({
      ...common,
      option: ppk,
      fetchBase: async () => null,
    });
    expect(selected?.source).toBe('local');
    expect(selected?.bundleHash).toBe(sha256Hex(bundle));
    expect(fs.readFileSync(selected!.path).equals(bundle)).toBe(true);
    // wrong version → refused
    const ppk96 = path.join(dir, 'base96.ppk');
    await writeZip(ppk96, { 'index.bundlejs': fakeHbc(96) });
    expect(
      await resolveHermesBase({
        ...common,
        option: ppk96,
        fetchBase: async () => null,
      }),
    ).toBeNull();
  });

  test('server record: cache hit, then download + verify + cache, mismatching hash refused', async () => {
    const bundle = fakeHbc(98, 'server');
    const bundleHash = sha256Hex(bundle);
    const ppk = path.join(dir, 'server.ppk');
    await writeZip(ppk, { 'main.jsbundle': bundle });
    const server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        if (new URL(req.url).pathname === '/good.ppk')
          return new Response(Bun.file(ppk));
        return new Response('nope', { status: 404 });
      },
    });
    try {
      const record = {
        versionId: 7,
        hash: 'objkey123',
        bundleHash,
        bytecodeVersion: 98,
        url: `http://127.0.0.1:${server.port}/good.ppk`,
      };
      const first = await resolveHermesBase({
        ...common,
        option: 'auto',
        appId: '1',
        fetchBase: async () => record,
      });
      expect(first?.source).toBe('download');
      expect(first?.versionId).toBe(7);
      expect(first?.bundleHash).toBe(bundleHash);
      const second = await resolveHermesBase({
        ...common,
        option: 'auto',
        appId: '1',
        fetchBase: async () => record,
      });
      expect(second?.source).toBe('cache');
      // hash mismatch → no base
      const bad = { ...record, bundleHash: 'f'.repeat(64) };
      await cleanCache();
      expect(
        await resolveHermesBase({
          ...common,
          option: 'auto',
          appId: '1',
          fetchBase: async () => bad,
        }),
      ).toBeNull();
      // epoch unknown (bytecodeVersion null) → verified after download
      const legacy = { ...record, bundleHash: null, bytecodeVersion: null };
      const fromLatest = await resolveHermesBase({
        ...common,
        option: 'auto',
        appId: '1',
        fetchBase: async () => legacy,
      });
      expect(fromLatest?.source).toBe('latest-version');
      // server has a different epoch → no base
      expect(
        await resolveHermesBase({
          ...common,
          option: 'auto',
          appId: '1',
          fetchBase: async () => ({ ...record, bytecodeVersion: 96 }),
        }),
      ).toBeNull();
      // download failure → no base (cache emptied first, a hit would short-circuit)
      await cleanCache();
      expect(
        await resolveHermesBase({
          ...common,
          option: 'auto',
          appId: '1',
          fetchBase: async () => ({
            ...record,
            url: `http://127.0.0.1:${server.port}/missing.ppk`,
          }),
        }),
      ).toBeNull();
    } finally {
      server.stop(true);
    }
  });
});

describe('helpers', () => {
  test('hermescArgsWithBase appends the base flag', () => {
    expect(hermescArgsWithBase(['-emit-binary'], '/b.hbc')).toEqual([
      '-emit-binary',
      '-base-bytecode=/b.hbc',
    ]);
    expect(hermescArgsWithBase(['-emit-binary'], null)).toEqual([
      '-emit-binary',
    ]);
  });

  test('hermesBaseMeta reports the chain fields', () => {
    expect(hermesBaseMeta(null, 98)).toEqual({
      bytecodeVersion: 98,
      baseVersionId: null,
      baseHash: null,
    });
    expect(
      hermesBaseMeta(
        {
          path: 'x',
          bytecodeVersion: 98,
          bundleHash: 'h',
          versionId: 3,
          hash: 'k',
          source: 'cache',
        },
        98,
      ),
    ).toEqual({ bytecodeVersion: 98, baseVersionId: 3, baseHash: 'k' });
  });

  test('normalizeDisassemblyLine hides representation-only differences', () => {
    const strings = new Map([[11591, 'foo']]);
    expect(
      normalizeDisassemblyLine('    NewArrayWithBuffer r5, 1, 1, 632', strings),
    ).toBe('    NewArrayWithBuffer r5 sizes=1');
    expect(
      normalizeDisassemblyLine(
        '    NewObjectWithBufferLong r5, 386, 9000',
        strings,
      ),
    ).toBe('    NewObjectWithBuffer r5 sizes=386');
    expect(
      normalizeDisassemblyLine('    JStrictEqualLong L12, r1, r2', strings),
    ).toBe('    JStrictEqual <tgt>, r1, r2');
    expect(
      normalizeDisassemblyLine('    DefineOwnById r7, r8, 2, 11591', strings),
    ).toBe('    DefineOwnById r7, r8, 2, "foo"');
    expect(
      normalizeDisassemblyLine('Offset in debug table: source 0x0000', strings),
    ).toBeNull();
    // operand-width variants and padding fold together (foreign base → wide ids)
    expect(
      normalizeDisassemblyLine(
        '    GetByIdShort      r1, r1, 4, "process"',
        strings,
      ),
    ).toBe(
      normalizeDisassemblyLine(
        '    GetById           r1, r1, 4, "process"',
        strings,
      ),
    );
    expect(
      normalizeDisassemblyLine('    LoadConstStringLongIndex r0, "x"', strings),
    ).toBe('    LoadConstString r0, "x"');
    expect(
      normalizeDisassemblyLine(
        '    StringSwitchImm   r13, 2, 4024, L146, 150',
        strings,
      ),
    ).toBe('    StringSwitchImm r13, 2, <jt>, L146, 150');
    expect(normalizeDisassemblyLine('  offset 4024', strings)).toBe(
      '  offset <jt>',
    );
    expect(
      normalizeDisassemblyLine('    GetByIdShort r3, r0, 2, "s"', strings),
    ).toBe('    GetById r3, r0, 2, "s"');
  });
});

describe.if(hasHermesc)('with a real hermesc', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkTemp('rnu-hermes-real-');
  });
  afterEach(() => {
    fs.removeSync(dir);
  });

  test('probeHbcVersion returns the bytecode version', () => {
    const version = probeHbcVersion(hermesc!);
    expect(version).toBeGreaterThanOrEqual(90);
  });

  test('base compile is disassembly-equivalent to a plain compile; a different program is not', async () => {
    const base = path.join(dir, 'base.js');
    const next = path.join(dir, 'next.js');
    const other = path.join(dir, 'other.js');
    fs.writeFileSync(
      base,
      "var s = 'foo'; print(s, 'bar', 'baz'); var t = 'qux';\n",
    );
    fs.writeFileSync(
      next,
      `${fs.readFileSync(base, 'utf8')}var o = {}; o.foo = 1; o.bar = 2; print(o.foo, o.bar, o.qux, [1, 'new1', 'new2']);\n`,
    );
    fs.writeFileSync(other, "print('completely different');\n");
    const compile = (input: string, out: string, extra: string[] = []) =>
      spawnSync(
        hermesc!,
        ['-emit-binary', '-out', out, input, '-O', '-w', ...extra],
        { stdio: 'ignore' },
      ).status;
    const baseHbc = path.join(dir, 'base.hbc');
    const plainHbc = path.join(dir, 'next.plain.hbc');
    const deltaHbc = path.join(dir, 'next.delta.hbc');
    const otherHbc = path.join(dir, 'other.hbc');
    expect(compile(base, baseHbc)).toBe(0);
    expect(compile(next, plainHbc)).toBe(0);
    expect(compile(next, deltaHbc, [`-base-bytecode=${baseHbc}`])).toBe(0);
    expect(compile(other, otherHbc)).toBe(0);
    expect(
      await verifyHermesBaseEquivalence(hermesc!, deltaHbc, plainHbc),
    ).toBe(true);
    expect(
      await verifyHermesBaseEquivalence(hermesc!, otherHbc, plainHbc),
    ).toBe(false);
    // the bundle inside a ppk has no .hbc extension; hermesc must still read
    // it as bytecode (-b)
    const noExt = path.join(dir, 'index.bundlejs');
    fs.copyFileSync(deltaHbc, noExt);
    expect(await verifyHermesBaseEquivalence(hermesc!, noExt, plainHbc)).toBe(
      true,
    );
  });
});
