// Hermes `-base-bytecode` (delta optimizing mode) support.
//
// Hermes re-sorts its string table by identifier frequency on every compile, so
// any source change renumbers most string IDs and the bytecode diff explodes
// (see hermes-base-bytecode-方案.md). Compiling with the previous HBC of the
// same app as `-base-bytecode` keeps old IDs stable and shrinks patches 5-30×.
// This module resolves that base: gating by hermesc build, HBC version probe,
// server lookup, a sha256-named local cache, download + verification, and the
// optional disassembly equivalence check. Every failure degrades to the plain
// compile — nothing here may block a release.
import { spawn, spawnSync } from 'child_process';
import { createHash } from 'crypto';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { pipeline } from 'stream/promises';
import { tempDir } from './constants';
import { getHbcVersion } from './hbcTransform';
import { t } from './i18n';
import { enumZipEntries, readEntry } from './zip-entries';

export type HermesBaseOption = 'auto' | 'none' | string;

export interface HermesBaseSelection {
  /** path of the bundle (HBC) handed to hermesc as -base-bytecode */
  path: string;
  bytecodeVersion: number;
  bundleHash: string;
  /** server version id when the base came from the server */
  versionId?: number;
  /** server object key of the base ppk when known */
  hash?: string;
  source: 'cache' | 'download' | 'local' | 'latest-version';
}

/** Metadata attached to version/create so the server can track the chain. */
export interface HermesBaseMeta {
  bytecodeVersion: number | null;
  baseVersionId: number | null;
  baseHash: string | null;
}

// ---------------------------------------------------------------------------
// hermesc gating
// ---------------------------------------------------------------------------

/**
 * Hermes V1 (static_h) builds before 2025-07-11 carried a delta-mode bug when a
 * delta-produced base is reused; every released `hermes-compiler` is newer, and
 * classic hermesc (HBC ≤96, react-native/sdks or hermes-engine) upgrades kinds
 * in place and was never affected. Anything else is refused.
 */
export const MIN_HERMES_COMPILER_BUILD = 250829098;
export const MIN_HERMES_COMPILER_COMMITLY_DATE = 20250901;

export function classifyHermesCommand(hermesCommand: string): {
  allowed: boolean;
  kind: 'classic' | 'hermes-compiler' | 'unknown';
  version?: string;
  reason?: string;
} {
  const normalized = hermesCommand.split(path.sep).join('/');
  if (
    /\/react-native\/sdks\/hermesc\//.test(normalized) ||
    /\/hermes-engine\//.test(normalized)
  ) {
    return { allowed: true, kind: 'classic' };
  }
  const match = /\/hermes-compiler\//.exec(normalized);
  if (match) {
    const packageRoot = normalized.slice(0, match.index + match[0].length);
    let version = '';
    try {
      version = String(
        JSON.parse(
          fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'),
        ).version ?? '',
      );
    } catch {
      return {
        allowed: false,
        kind: 'hermes-compiler',
        reason: 'unreadable hermes-compiler version',
      };
    }
    const build = /^(\d{9})\./.exec(version);
    if (build) {
      const ok = Number(build[1]) >= MIN_HERMES_COMPILER_BUILD;
      return {
        allowed: ok,
        kind: 'hermes-compiler',
        version,
        reason: ok
          ? undefined
          : `hermes-compiler ${version} predates the delta-mode fix`,
      };
    }
    const commitly = /^0\.(\d+)\.\d+-commitly-(\d{8})/.exec(version);
    if (commitly) {
      const ok =
        Number(commitly[1]) >= 14 &&
        Number(commitly[2]) >= MIN_HERMES_COMPILER_COMMITLY_DATE;
      return {
        allowed: ok,
        kind: 'hermes-compiler',
        version,
        reason: ok
          ? undefined
          : `hermes-compiler ${version} predates the delta-mode fix`,
      };
    }
    const stable = /^0\.(\d+)\.\d+$/.exec(version);
    if (stable) {
      const ok = Number(stable[1]) >= 14;
      return {
        allowed: ok,
        kind: 'hermes-compiler',
        version,
        reason: ok
          ? undefined
          : `hermes-compiler ${version} predates the delta-mode fix`,
      };
    }
    return {
      allowed: false,
      kind: 'hermes-compiler',
      version,
      reason: `unrecognized hermes-compiler version ${version}`,
    };
  }
  return {
    allowed: false,
    kind: 'unknown',
    reason: 'hermesc location not recognized',
  };
}

// ---------------------------------------------------------------------------
// HBC helpers
// ---------------------------------------------------------------------------

export function sha256Hex(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Compile an empty file to learn which HBC version this hermesc emits. */
export function probeHbcVersion(hermesCommand: string): number | null {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rnu-hermes-probe-'));
  try {
    const input = path.join(dir, 'probe.js');
    const output = path.join(dir, 'probe.hbc');
    fs.writeFileSync(input, '');
    const result = spawnSync(
      hermesCommand,
      ['-emit-binary', '-out', output, input, '-O', '-w'],
      { stdio: 'ignore' },
    );
    if (result.status !== 0 || !fs.existsSync(output)) {
      return null;
    }
    const header = Buffer.alloc(128);
    const fd = fs.openSync(output, 'r');
    try {
      fs.readSync(fd, header, 0, 128, 0);
    } finally {
      fs.closeSync(fd);
    }
    return getHbcVersion(header);
  } catch {
    return null;
  } finally {
    fs.removeSync(dir);
  }
}

export const BUNDLE_ENTRY_NAMES = [
  'index.bundlejs',
  'main.jsbundle',
  'bundle.harmony.js',
];
const APK_BUNDLE = /^assets\/index\.android\.bundle$/;
const IPA_BUNDLE = /^payload\/[^/]+\.app\/main\.jsbundle$/i;

/**
 * Extract the JS/HBC bundle from a local artifact: a raw bundle file, a ppk,
 * or a native package (apk / ipa / harmony app). Returns null when not found.
 */
export async function extractBundleFromArchive(
  filePath: string,
): Promise<Buffer | null> {
  const ext = path.extname(filePath).toLowerCase();
  if (
    ext === '.hbc' ||
    ext === '.bundle' ||
    ext === '.jsbundle' ||
    ext === '.bundlejs' ||
    ext === '.js'
  ) {
    return fs.readFile(filePath);
  }
  if (ext === '.ppk') {
    return readFirstZipEntry(filePath, (name) =>
      BUNDLE_ENTRY_NAMES.includes(name),
    );
  }
  if (ext === '.apk') {
    return readFirstZipEntry(filePath, (name) => APK_BUNDLE.test(name));
  }
  if (ext === '.ipa') {
    return readFirstZipEntry(filePath, (name) =>
      IPA_BUNDLE.test(name.toLowerCase()),
    );
  }
  if (ext === '.app') {
    // harmony .app wraps .hap archives; reuse the existing parser
    const { default: AppInfoParser } = await import('./app-info-parser');
    const parser = new AppInfoParser(filePath);
    const [bundle] = await parser.parser.getEntriesFromHarmonyApp([
      /^resources\/rawfile\/bundle\.harmony\.js$/,
    ]);
    return bundle ?? null;
  }
  // unknown extension: try as zip, then as raw file
  const fromZip = await readFirstZipEntry(filePath, (name) =>
    BUNDLE_ENTRY_NAMES.includes(name),
  ).catch(() => null);
  return fromZip ?? fs.readFile(filePath);
}

async function readFirstZipEntry(
  zipPath: string,
  matches: (name: string) => boolean,
): Promise<Buffer | null> {
  let found: Buffer | null = null;
  await enumZipEntries(zipPath, async (entry, zipFile) => {
    if (!found && matches(entry.fileName)) {
      found = await readEntry(entry, zipFile);
    }
  });
  return found;
}

// ---------------------------------------------------------------------------
// cache (sha256-named bundles)
// ---------------------------------------------------------------------------

export const DEFAULT_CACHE_MAX_BYTES = 500 * 1024 * 1024;
export const DEFAULT_CACHE_MAX_FILES = 20;

export function cacheDir(): string {
  return process.env.PUSHY_CACHE_DIR || path.join(tempDir, 'cache');
}

export function tmpDir(): string {
  return path.join(tempDir, 'tmp');
}

export function cacheLimits(overrideMaxMb?: number) {
  const envMb = Number(process.env.PUSHY_CACHE_MAX_MB);
  const maxBytes =
    overrideMaxMb && overrideMaxMb > 0
      ? overrideMaxMb * 1024 * 1024
      : Number.isFinite(envMb) && envMb > 0
        ? envMb * 1024 * 1024
        : DEFAULT_CACHE_MAX_BYTES;
  return { maxBytes, maxFiles: DEFAULT_CACHE_MAX_FILES };
}

/** Returns the cached bundle path when present and its sha256 still matches. */
export async function cacheLookup(bundleHash: string): Promise<string | null> {
  if (!/^[0-9a-f]{64}$/.test(bundleHash)) return null;
  const file = path.join(cacheDir(), bundleHash);
  if (!(await fs.pathExists(file))) return null;
  const data = await fs.readFile(file);
  if (sha256Hex(data) !== bundleHash) {
    // corrupt entry: never trust cache content
    await fs.remove(file).catch(() => {});
    return null;
  }
  const now = new Date();
  await fs.utimes(file, now, now).catch(() => {});
  return file;
}

/** Store a bundle under its sha256 (LRU-evicting to the configured limits). */
export async function cachePut(
  bundle: Buffer,
  maxMb?: number,
): Promise<{ path: string; bundleHash: string }> {
  const bundleHash = sha256Hex(bundle);
  const dir = cacheDir();
  await fs.ensureDir(dir);
  const file = path.join(dir, bundleHash);
  if (!(await fs.pathExists(file))) {
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, bundle);
    await fs.rename(tmp, file);
  } else {
    const now = new Date();
    await fs.utimes(file, now, now).catch(() => {});
  }
  await enforceCacheLimits(maxMb, bundleHash);
  return { path: file, bundleHash };
}

export async function enforceCacheLimits(
  maxMb?: number,
  keep?: string,
): Promise<void> {
  const dir = cacheDir();
  if (!(await fs.pathExists(dir))) return;
  const { maxBytes, maxFiles } = cacheLimits(maxMb);
  const entries: { name: string; size: number; mtime: number }[] = [];
  for (const name of await fs.readdir(dir)) {
    if (!/^[0-9a-f]{64}$/.test(name)) continue;
    const stat = await fs.stat(path.join(dir, name)).catch(() => null);
    if (stat?.isFile())
      entries.push({ name, size: stat.size, mtime: stat.mtimeMs });
  }
  entries.sort((a, b) => b.mtime - a.mtime); // newest first
  let total = 0;
  let count = 0;
  for (const entry of entries) {
    total += entry.size;
    count += 1;
    if (entry.name !== keep && (total > maxBytes || count > maxFiles)) {
      await fs.remove(path.join(dir, entry.name)).catch(() => {});
    }
  }
}

export async function cleanCache(): Promise<number> {
  const dir = cacheDir();
  if (!(await fs.pathExists(dir))) return 0;
  const names = (await fs.readdir(dir)).filter((n) => /^[0-9a-f]{64}$/.test(n));
  for (const name of names) await fs.remove(path.join(dir, name));
  return names.length;
}

export async function cacheStats(): Promise<{
  dir: string;
  files: number;
  bytes: number;
}> {
  const dir = cacheDir();
  let files = 0;
  let bytes = 0;
  if (await fs.pathExists(dir)) {
    for (const name of await fs.readdir(dir)) {
      if (!/^[0-9a-f]{64}$/.test(name)) continue;
      const stat = await fs.stat(path.join(dir, name)).catch(() => null);
      if (stat?.isFile()) {
        files += 1;
        bytes += stat.size;
      }
    }
  }
  return { dir, files, bytes };
}

/** Remove leftovers of interrupted runs (older than 24h) from the tmp dir. */
export async function cleanStaleTmp(
  maxAgeMs = 24 * 60 * 60 * 1000,
): Promise<void> {
  const dir = tmpDir();
  if (!(await fs.pathExists(dir))) return;
  const cutoff = Date.now() - maxAgeMs;
  for (const name of await fs.readdir(dir)) {
    const file = path.join(dir, name);
    const stat = await fs.stat(file).catch(() => null);
    if (stat && stat.mtimeMs < cutoff) await fs.remove(file).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// download
// ---------------------------------------------------------------------------

export async function downloadToFile(
  url: string,
  destination: string,
): Promise<void> {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`download failed: HTTP ${response.status} ${url}`);
  }
  await fs.ensureDir(path.dirname(destination));
  const { Readable } = await import('stream');
  await pipeline(
    Readable.fromWeb(response.body as any),
    fs.createWriteStream(destination),
  );
}

// ---------------------------------------------------------------------------
// resolution
// ---------------------------------------------------------------------------

export interface HermesBaseServerRecord {
  versionId: number;
  hash: string;
  bundleHash?: string | null;
  bytecodeVersion?: number | null;
  url: string;
}

export interface ResolveHermesBaseParams {
  option: HermesBaseOption;
  hermesCommand: string;
  bytecodeVersion: number;
  appId?: string;
  cacheMaxMb?: number;
  /**
   * server lookup; returns null when the app has no usable base. The server
   * itself falls back to the newest version when the epoch is still unknown
   * (its bytecodeVersion is then null and verified here after download).
   */
  fetchBase: (
    appId: string,
    bytecodeVersion: number,
  ) => Promise<HermesBaseServerRecord | null>;
  log?: (message: string) => void;
}

/**
 * Pick and materialize the base bundle for this compile. Returns null (with
 * the reason logged) whenever a base cannot be used; callers then compile
 * without one.
 */
export async function resolveHermesBase(
  params: ResolveHermesBaseParams,
): Promise<HermesBaseSelection | null> {
  const log = params.log ?? (() => {});
  const { option, bytecodeVersion } = params;
  if (option === 'none') {
    log(t('hermesBaseNone', { reason: 'disabled by option' }));
    return null;
  }
  if (option !== 'auto') {
    // explicit local artifact
    try {
      const bundle = await extractBundleFromArchive(option);
      if (!bundle) throw new Error('bundle entry not found');
      const version = getHbcVersion(bundle);
      if (version !== bytecodeVersion) {
        throw new Error(
          `HBC version ${version ?? 'n/a'} != ${bytecodeVersion}`,
        );
      }
      const cached = await cachePut(bundle, params.cacheMaxMb);
      log(t('hermesBaseUsing', { source: option, version: bytecodeVersion }));
      return {
        path: cached.path,
        bytecodeVersion,
        bundleHash: cached.bundleHash,
        source: 'local',
      };
    } catch (error: any) {
      log(
        t('hermesBaseNone', {
          reason: `${option}: ${error?.message ?? error}`,
        }),
      );
      return null;
    }
  }
  if (!params.appId) {
    log(t('hermesBaseNone', { reason: 'app not selected' }));
    return null;
  }
  let record: HermesBaseServerRecord | null = null;
  try {
    record = await params.fetchBase(params.appId, bytecodeVersion);
  } catch (error: any) {
    log(
      t('hermesBaseNone', {
        reason: `server lookup failed: ${error?.message ?? error}`,
      }),
    );
    return null;
  }
  const source: HermesBaseSelection['source'] =
    record?.bytecodeVersion == null ? 'latest-version' : 'download';
  if (!record) {
    log(t('hermesBaseNone', { reason: 'no published version yet' }));
    return null;
  }
  if (
    record.bytecodeVersion != null &&
    record.bytecodeVersion !== bytecodeVersion
  ) {
    log(
      t('hermesBaseNone', {
        reason: `server base is HBC ${record.bytecodeVersion}, need ${bytecodeVersion}`,
      }),
    );
    return null;
  }
  // 1. cache by bundleHash
  if (record.bundleHash) {
    const hit = await cacheLookup(record.bundleHash);
    if (hit) {
      log(
        t('hermesBaseUsing', {
          source: `cache ${record.bundleHash.slice(0, 12)} (version ${record.versionId})`,
          version: bytecodeVersion,
        }),
      );
      return {
        path: hit,
        bytecodeVersion,
        bundleHash: record.bundleHash,
        versionId: record.versionId,
        hash: record.hash,
        source: 'cache',
      };
    }
  }
  // 2. download, extract, verify, cache — up to two attempts
  for (let attempt = 1; attempt <= 2; attempt++) {
    const dir = tmpDir();
    await fs.ensureDir(dir);
    const archive = path.join(
      dir,
      `base-${process.pid}-${Date.now()}-${attempt}.ppk`,
    );
    try {
      log(t('hermesBaseDownloading', { url: record.url }));
      await downloadToFile(record.url, archive);
      const bundle = await extractBundleFromArchive(archive);
      if (!bundle)
        throw new Error('bundle entry not found in downloaded package');
      const actualHash = sha256Hex(bundle);
      if (record.bundleHash && actualHash !== record.bundleHash) {
        throw new Error(
          `bundleHash mismatch (${actualHash.slice(0, 12)} != ${record.bundleHash.slice(0, 12)})`,
        );
      }
      const version = getHbcVersion(bundle);
      if (version !== bytecodeVersion) {
        log(
          t('hermesBaseNone', {
            reason: `downloaded base is HBC ${version ?? 'n/a'}, need ${bytecodeVersion}`,
          }),
        );
        return null;
      }
      const cached = await cachePut(bundle, params.cacheMaxMb);
      log(
        t('hermesBaseUsing', {
          source: `version ${record.versionId} ${record.hash.slice(0, 8)}`,
          version: bytecodeVersion,
        }),
      );
      return {
        path: cached.path,
        bytecodeVersion,
        bundleHash: cached.bundleHash,
        versionId: record.versionId,
        hash: record.hash,
        source,
      };
    } catch (error: any) {
      if (attempt === 2) {
        log(
          t('hermesBaseNone', {
            reason: `download/verify failed: ${error?.message ?? error}`,
          }),
        );
        return null;
      }
    } finally {
      await fs.remove(archive).catch(() => {});
    }
  }
  return null;
}

export function hermescArgsWithBase(
  baseArgs: string[],
  basePath: string | null,
): string[] {
  return basePath ? [...baseArgs, `-base-bytecode=${basePath}`] : baseArgs;
}

export function hermesBaseMeta(
  selection: HermesBaseSelection | null,
  bytecodeVersion: number | null,
): HermesBaseMeta {
  return {
    bytecodeVersion,
    baseVersionId: selection?.versionId ?? null,
    baseHash: selection?.hash ?? null,
  };
}

// ---------------------------------------------------------------------------
// equivalence check (streams two `-dump-bytecode` outputs, never writes them)
// ---------------------------------------------------------------------------

const STRING_TABLE_LINE = /^\s*[is](\d+)\[[^\]]*\](?: #[0-9A-F]+)?: (.*)$/;

/**
 * Normalize one disassembly line so that a delta-mode compile and a plain
 * compile of the same source compare equal: string IDs are renumbered, literal
 * buffers are laid out differently (offsets, short/long variants), and jump
 * distances follow instruction widths. Everything else must match exactly.
 */
export function normalizeDisassemblyLine(
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
  // Operand-width variants of one instruction (GetByIdShort/GetById/GetByIdLong,
  // LoadConstString/LoadConstStringLongIndex, ...) only differ by how wide a
  // string/function id or offset is encoded — a foreign base hands the new
  // code's hot strings large ids, so the delta build legitimately picks the
  // wider form. Fold the suffix and the column padding that follows it.
  m = /^(\s*)([A-Za-z]+?)(?:LongIndex|Long|Short)?(\s+.*|)$/.exec(line);
  if (m) line = `${m[1]}${m[2]}${m[3].replace(/\s+/g, ' ')}`;
  // switch jump tables sit after the instructions; their relative offset (and
  // the table header hermesc prints for them) moves with instruction widths
  m = /^(\s*(?:String|UInt)?SwitchImm r\d+, \d+, )\d+(, .*)$/.exec(line);
  if (m) line = `${m[1]}<jt>${m[2]}`;
  if (/^\s*offset \d+$/.test(line)) line = line.replace(/\d+$/, '<jt>');
  return line;
}

/** Split a readable stream into lines without readline (Bun's readline async iterator misbehaves when pulled manually). */
async function* streamLines(
  stream: NodeJS.ReadableStream,
): AsyncGenerator<string> {
  let rest = '';
  for await (const chunk of stream as AsyncIterable<Buffer | string>) {
    rest += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    let index = rest.indexOf('\n');
    while (index >= 0) {
      yield rest.slice(0, index);
      rest = rest.slice(index + 1);
      index = rest.indexOf('\n');
    }
  }
  if (rest) yield rest;
}

class DumpReader {
  private iterator: AsyncIterator<string>;
  readonly strings = new Map<number, string>();
  private inFunctions = false;
  private finished = false;
  constructor(readonly proc: ReturnType<typeof spawn>) {
    this.iterator = streamLines(proc.stdout!);
  }
  /** next normalized function-body line, or null at end */
  async next(): Promise<string | null> {
    if (this.finished) return null;
    for (;;) {
      const { value, done } = await this.iterator.next();
      if (done) {
        this.finished = true;
        return null;
      }
      const line = value as string;
      if (!this.inFunctions) {
        if (line.startsWith('Function<')) {
          this.inFunctions = true;
        } else {
          const m = STRING_TABLE_LINE.exec(line);
          if (m) this.strings.set(Number(m[1]), m[2]);
          continue;
        }
      }
      if (line.trim() === '') continue;
      const normalized = normalizeDisassemblyLine(line, this.strings);
      if (normalized !== null) return normalized;
    }
  }
}

/**
 * Compare two HBC files by disassembly (see normalizeDisassemblyLine). `-b`
 * forces hermesc to treat inputs as bytecode whatever their extension. Both
 * hermesc dumps are consumed as streams so the ~100 MB of text never touches
 * the disk. Resolves true when equivalent.
 */
export async function verifyHermesBaseEquivalence(
  hermesCommand: string,
  withBase: string,
  plain: string,
): Promise<boolean> {
  const spawnDump = (file: string) =>
    spawn(
      hermesCommand,
      ['-b', '-dump-bytecode', '-pretty-disassemble', file],
      {
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    );
  const a = new DumpReader(spawnDump(withBase));
  const b = new DumpReader(spawnDump(plain));
  let equal = true;
  let lines = 0;
  try {
    for (;;) {
      const [la, lb] = await Promise.all([a.next(), b.next()]);
      if (la === null && lb === null) break;
      if (la !== lb) {
        equal = false;
        break;
      }
      lines++;
    }
  } finally {
    a.proc.kill();
    b.proc.kill();
  }
  return equal && lines > 0;
}
