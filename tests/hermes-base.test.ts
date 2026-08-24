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
import { locateZipEntry } from '../src/utils/zip-range';

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
    const nativeBundle = fakeHbc(98, 'native');
    const apk = path.join(dir, 'native.apk');
    await writeZip(apk, { 'assets/index.android.bundle': nativeBundle });
    const server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        if (new URL(req.url).pathname === '/good.ppk')
          return new Response(Bun.file(ppk));
        if (new URL(req.url).pathname === '/native.apk')
          return new Response(Bun.file(apk));
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
      await cleanCache();
      const fromNativePackage = await resolveHermesBase({
        ...common,
        option: 'auto',
        appId: '1',
        fetchBase: async () => ({
          versionId: null,
          hash: 'nativekey',
          artifactType: 'apk',
          bundleHash: sha256Hex(nativeBundle),
          bytecodeVersion: null,
          url: `http://127.0.0.1:${server.port}/native.apk`,
        }),
      });
      expect(fromNativePackage?.source).toBe('native-package');
      expect(fromNativePackage?.versionId).toBeUndefined();
      expect(fromNativePackage?.hash).toBe('nativekey');
      expect(
        fs.readFileSync(fromNativePackage!.path).equals(nativeBundle),
      ).toBe(true);
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

describe('resolveHermesBase over HTTP Range', () => {
  test('a located ppk bundle is fetched with one Range request', async () => {
    const dir = mkTemp('rnu-hermes-range-');
    process.env.PUSHY_CACHE_DIR = path.join(dir, 'cache');
    const bundle = fakeHbc(98, 'ranged');
    const ppk = path.join(dir, 'server.ppk');
    await writeZip(ppk, {
      'assets/a.bin': Buffer.alloc(200 * 1024, 1),
      'index.bundlejs': bundle,
    });
    const file = fs.readFileSync(ppk);
    const requests: string[] = [];
    const server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        const range = req.headers.get('range') ?? 'full';
        requests.push(range);
        const match = /^bytes=(\d+)-(\d+)$/.exec(range);
        if (!match) return new Response(file);
        const [start, end] = [Number(match[1]), Number(match[2])];
        return new Response(file.subarray(start, end + 1), {
          status: 206,
          headers: { 'Content-Range': `bytes ${start}-${end}/${file.length}` },
        });
      },
    });
    const messages: string[] = [];
    try {
      const location = (await locateZipEntry(
        ppk,
        (n) => n === 'index.bundlejs',
      ))!;
      const selection = await resolveHermesBase({
        option: 'auto',
        hermesCommand:
          '/x/node_modules/react-native/sdks/hermesc/osx-bin/hermesc',
        bytecodeVersion: 98,
        appId: '1',
        log: (m) => messages.push(m),
        fetchBase: async () => ({
          versionId: 9,
          hash: 'objkey',
          bundleHash: sha256Hex(bundle),
          bytecodeVersion: 98,
          url: `http://127.0.0.1:${server.port}/server.ppk`,
          bundleOffset: location.dataOffset,
          bundleCompressedSize: location.compressedSize,
          bundleCompression: location.compressionMethod,
        }),
      });
      expect(selection?.source).toBe('download');
      expect(selection?.versionId).toBe(9);
      expect(fs.readFileSync(selection!.path).equals(bundle)).toBe(true);
      expect(requests).toEqual([
        `bytes=${location.dataOffset}-${location.dataOffset + location.compressedSize - 1}`,
      ]);
      expect(messages.some((m) => m.includes('HTTP Range'))).toBe(true);
    } finally {
      server.stop(true);
      delete process.env.PUSHY_CACHE_DIR;
      fs.removeSync(dir);
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
    // UIntSwitchImm carries the jump-table offset one operand earlier
    expect(
      normalizeDisassemblyLine(
        '    UIntSwitchImm     r40, 5937, L3, 0, 31',
        strings,
      ),
    ).toBe('    UIntSwitchImm r40, <jt>, L3, 0, 31');
    expect(
      normalizeDisassemblyLine(
        '    UIntSwitchImm     r40, 5938, L3, 0, 31',
        strings,
      ),
    ).toBe('    UIntSwitchImm r40, <jt>, L3, 0, 31');
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
  const previousCache = process.env.PUSHY_CACHE_DIR;
  beforeEach(() => {
    dir = mkTemp('rnu-hermes-real-');
    process.env.PUSHY_CACHE_DIR = path.join(dir, 'cache');
  });
  afterEach(() => {
    if (previousCache === undefined) delete process.env.PUSHY_CACHE_DIR;
    else process.env.PUSHY_CACHE_DIR = previousCache;
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

describe('publish metadata never sends JSON null', () => {
  test('describePpkBundle omits unknown chain fields', async () => {
    const { describePpkBundleForTests } = await import('../src/versions');
    const dir = mkTemp('rnu-publish-meta-');
    try {
      const ppk = path.join(dir, 'v.ppk');
      await writeZip(ppk, { 'index.bundlejs': fakeHbc(98, 'meta') });
      const noBase = await describePpkBundleForTests(ppk, undefined);
      expect(noBase.bundleHash).toBe(sha256Hex(fakeHbc(98, 'meta')));
      expect(noBase.bytecodeVersion).toBe(98);
      // bundle location inside the ppk for single-Range base downloads
      const location = await locateZipEntry(ppk, (n) => n === 'index.bundlejs');
      expect(noBase.bundleOffset).toBe(location!.dataOffset);
      expect(noBase.bundleCompressedSize).toBe(location!.compressedSize);
      expect(noBase.bundleCompression).toBe(location!.compressionMethod);
      expect('baseVersionId' in noBase).toBe(false);
      expect('baseHash' in noBase).toBe(false);
      expect(Object.values(noBase).some((v) => v === null)).toBe(false);
      const withBase = await describePpkBundleForTests(ppk, {
        bytecodeVersion: 98,
        baseVersionId: 7,
        baseHash: 'objkey',
      });
      expect(withBase.baseVersionId).toBe(7);
      expect(withBase.baseHash).toBe('objkey');
      // plain JS bundle: no bytecodeVersion at all rather than null
      const js = path.join(dir, 'js.ppk');
      await writeZip(js, { 'index.bundlejs': Buffer.from('var a = 1;') });
      const plain = await describePpkBundleForTests(js, undefined);
      expect('bytecodeVersion' in plain).toBe(false);
    } finally {
      fs.removeSync(dir);
    }
  });
});

/** the regex-per-line implementation the fast path replaced; must agree */
function legacyNormalize(
  line: string,
  strings: Map<number, string>,
): string | null {
  if (/^Offset in debug table/.test(line)) return null;
  let m =
    /^(\s*New(?:Array|Object)WithBuffer)(?:Long)?(?:AndParent)?\s+(r\d+)(.*)$/.exec(
      line,
    );
  if (m) {
    const nums = m[3].match(/\d+/g) ?? [];
    return `${m[1]} ${m[2]} sizes=${nums.slice(0, 1).join(',')}`;
  }
  m = /^(\s*J[A-Za-z]+?)(Long)?\s+(L\d+|\d+)(.*)$/.exec(line);
  if (m) return `${m[1]} <tgt>${m[4]}`;
  m = /^(\s*DefineOwnById\w*\s+r\d+, r\d+, \d+, )(\d+)$/.exec(line);
  if (m) line = `${m[1]}"${strings.get(Number(m[2])) ?? `?${m[2]}`}"`;
  m = /^(\s*)([A-Za-z]+?)(?:LongIndex|Long|Short)?(\s+.*|)$/.exec(line);
  if (m) line = `${m[1]}${m[2]}${m[3].replace(/\s+/g, ' ')}`;
  m = /^(\s*StringSwitchImm r\d+, \d+, )\d+(, L\d+, \d+)$/.exec(line);
  if (m) line = `${m[1]}<jt>${m[2]}`;
  m = /^(\s*UIntSwitchImm r\d+, )\d+(, L\d+, \d+, \d+)$/.exec(line);
  if (m) line = `${m[1]}<jt>${m[2]}`;
  if (/^\s*offset \d+$/.test(line)) line = line.replace(/\d+$/, '<jt>');
  return line;
}

describe('normalizeDisassemblyLine fast path', () => {
  test('agrees with the regex-only implementation on representative lines', () => {
    const strings = new Map([
      [3, 'foo'],
      [42, 'bar'],
    ]);
    const corpus = [
      'Offset in debug table: source 0x0, lexical 0x0',
      '    NewArrayWithBuffer r1, 3, 3, 12',
      '    NewArrayWithBufferLong r1, 300, 300, 65540',
      '    NewObjectWithBuffer r2, 2, 2, 0, 0',
      '    NewObjectWithBufferLong r2, 2, 2, 70000, 70000',
      '    NewObjectWithBufferAndParent r2, r3, 2, 2, 0, 0',
      '    Jmp L5',
      '    JmpLong L5',
      '    JNotEqual L3, r1, r2',
      '    JmpTrue 12, r4',
      '    JStrictEqualLong L9, r0, r1',
      '    DefineOwnById r0, r1, 1, 3',
      '    DefineOwnByIdLong r0, r1, 1, 42',
      '    DefineOwnByIdShort r0, r1, 1, 7',
      '    GetByIdShort   r1, r0, 1, "foo"',
      '    GetById        r1, r0, 1, "foo"',
      '    GetByIdLong    r1, r0, 1, "foo"',
      '    LoadConstString r3, "x"',
      '    LoadConstStringLongIndex r3, "x"',
      '    Mov     r1,\tr2',
      '    Ret r0',
      '    Long r1',
      '    Short',
      '    LongLong r2',
      '    ShortLong r2',
      '    XLongIndexLong r2',
      '    StringSwitchImm r1, 5, 120, L2, 3',
      '    StringSwitchImm r1, 5, 120, L2, 3, 9',
      '    UIntSwitchImm r1, 96, L4, 0, 5',
      '    UIntSwitchImm r1, 96, L4, 0, 5, 1',
      '  offset 96',
      '    offset 12 ',
      'offset abc',
      'Function<global>(1 params, 12 registers, 0 symbols):',
      'Function<foo>(2 params, 3 registers):',
      'L1:',
      '  L2:',
      '',
      '   ',
      '\tRet\tr0',
      'Exception Handlers:',
      '  0: start = L1, end = L2, target = L3',
      '    ; comment-like',
      'i5[ASCII, 0..2]: foo',
      's0[UTF-16, 3..5] #ABCD: bar',
      'CJSModuleTable:',
      '    Debugger',
      '    Debugger ',
      '    CreateClosureLongIndex r1, r0, Function<bar>',
      '    Call r1, r2, 3',
      '    NewArray r1, 0',
      '    Newarrays r1',
      '    New r1',
      '    JmpUndefined',
      '    J',
      'Jmp L1',
      'NewArrayWithBuffer r1, 3, 3, 12',
    ];
    for (const line of corpus) {
      expect(normalizeDisassemblyLine(line, strings)).toBe(
        legacyNormalize(line, strings),
      );
    }
  });
});

describe('probeHbcVersion cache', () => {
  let dir: string;
  const previous = process.env.PUSHY_CACHE_DIR;
  beforeEach(() => {
    dir = mkTemp('rnu-hermes-probe-cache-');
    process.env.PUSHY_CACHE_DIR = path.join(dir, 'cache');
  });
  afterEach(() => {
    if (previous === undefined) delete process.env.PUSHY_CACHE_DIR;
    else process.env.PUSHY_CACHE_DIR = previous;
    fs.removeSync(dir);
  });

  test.if(os.platform() !== 'win32')(
    'compiles once per hermesc binary and again when the binary changes',
    () => {
      const fixture = path.join(dir, 'probe.hbc');
      fs.writeFileSync(fixture, fakeHbc(96));
      const calls = path.join(dir, 'calls.log');
      const script = path.join(dir, 'hermesc');
      const write = (marker: string) =>
        fs.writeFileSync(
          script,
          `#!/bin/sh\n# ${marker}\necho run >> "${calls}"\nwhile [ $# -gt 0 ]; do if [ "$1" = "-out" ]; then cp "${fixture}" "$2"; shift; fi; shift; done\n`,
          { mode: 0o755 },
        );
      write('v1');
      expect(probeHbcVersion(script)).toBe(96);
      expect(probeHbcVersion(script)).toBe(96);
      expect(fs.readFileSync(calls, 'utf8').trim().split('\n')).toHaveLength(1);
      expect(fs.existsSync(path.join(cacheDir(), 'hbc-versions.json'))).toBe(
        true,
      );
      // a different binary (size changes) is probed again
      write('v2-longer');
      expect(probeHbcVersion(script)).toBe(96);
      expect(fs.readFileSync(calls, 'utf8').trim().split('\n')).toHaveLength(2);
      // the sha256-named bundle cache ignores the probe file
      expect(fs.readdirSync(cacheDir())).toEqual(['hbc-versions.json']);
    },
  );
});
