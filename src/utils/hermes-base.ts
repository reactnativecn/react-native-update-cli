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
import { PassThrough, Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { tempDir } from './constants';
import { getHbcVersion } from './hbcTransform';
import { t } from './i18n';
import { webFetch } from './runtime';
import { enumZipEntries, readEntry } from './zip-entries';
import {
  fetchZipEntryData,
  openRemoteZip,
  RangeUnsupportedError,
  readRemoteZipEntry,
  ZIP_DEFLATED,
  ZIP_STORED,
} from './zip-range';

export type HermesBaseOption = 'auto' | 'none' | string;

/**
 * The base cannot be obtained whatever the transport or how often it is
 * retried (wrong content on the server, no bundle in the package, ...).
 */
export class PermanentBaseError extends Error {}
/** The fetched bundle's sha256 differs from what the server recorded. */
export class BundleHashMismatchError extends PermanentBaseError {
  constructor(actual: string, expected: string) {
    super(
      `bundleHash mismatch (${actual.slice(0, 12)} != ${expected.slice(0, 12)})`,
    );
  }
}

/** time allowed for a response to start (headers) */
const FETCH_HEADERS_TIMEOUT_MS = 30_000;
/** a download that receives nothing for this long is abandoned */
const STREAM_IDLE_TIMEOUT_MS = 60_000;
/** cachePut leftovers (`<hash>.<pid>.tmp`) older than this are evicted */
const STALE_CACHE_TMP_MS = 60 * 60 * 1000;

export interface HermesBaseSelection {
  /** path of the bundle (HBC) handed to hermesc as -base-bytecode */
  path: string;
  bytecodeVersion: number;
  bundleHash: string;
  /** server version id when the base came from the server */
  versionId?: number;
  /** server object key of the base artifact when known */
  hash?: string;
  source: 'cache' | 'download' | 'local' | 'latest-version' | 'native-package';
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

/** sha256 of a file, streamed (a cached base can be tens of MB) */
export async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

/** HBC version from the first bytes of a file, without reading the rest */
export async function readFileHbcVersion(file: string): Promise<number | null> {
  const header = Buffer.alloc(128);
  const fd = await fs.open(file, 'r');
  try {
    const { bytesRead } = await fs.read(fd, header, 0, 128, 0);
    return getHbcVersion(header.subarray(0, bytesRead));
  } catch {
    return null;
  } finally {
    await fs.close(fd);
  }
}

const PROBE_CACHE_FILE = 'hbc-versions.json';
const PROBE_CACHE_ENTRIES = 16;

/** identity of a hermesc binary for the probe cache: path + size + mtime */
function probeCacheKey(hermesCommand: string): string | null {
  try {
    const stat = fs.statSync(hermesCommand);
    return `${path.resolve(hermesCommand)}|${stat.size}|${Math.floor(stat.mtimeMs)}`;
  } catch {
    return null;
  }
}

function readProbeCache(): Record<string, number> {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(path.join(cacheDir(), PROBE_CACHE_FILE), 'utf8'),
    );
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeProbeCache(entries: Record<string, number>): void {
  try {
    const keys = Object.keys(entries);
    // keep the most recently inserted entries only
    const trimmed = Object.fromEntries(
      keys.slice(-PROBE_CACHE_ENTRIES).map((key) => [key, entries[key]]),
    );
    fs.ensureDirSync(cacheDir());
    fs.writeFileSync(
      path.join(cacheDir(), PROBE_CACHE_FILE),
      JSON.stringify(trimmed),
    );
  } catch {
    // the cache is a convenience; probing again next time is fine
  }
}

/**
 * Which HBC version this hermesc emits. The answer is remembered per binary
 * (path, size, mtime) in the cache dir so only the first run of a given
 * hermesc pays for the empty-file compile.
 */
export function probeHbcVersion(hermesCommand: string): number | null {
  const key = probeCacheKey(hermesCommand);
  if (key) {
    const cached = readProbeCache()[key];
    if (Number.isInteger(cached) && cached > 0) return cached;
  }
  const version = compileProbe(hermesCommand);
  if (key && version !== null) {
    const { [key]: _stale, ...others } = readProbeCache();
    writeProbeCache({ ...others, [key]: version });
  }
  return version;
}

/** Compile an empty file to learn which HBC version this hermesc emits. */
function compileProbe(hermesCommand: string): number | null {
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

export type BaseArtifactType = 'ppk' | 'apk' | 'ipa' | 'app';

/** Which zip entry holds the JS/HBC bundle in each kind of artifact. */
export function bundleEntryMatcher(
  artifactType: BaseArtifactType,
): (name: string) => boolean {
  switch (artifactType) {
    case 'apk':
      return (name) => APK_BUNDLE.test(name);
    case 'ipa':
      return (name) => IPA_BUNDLE.test(name.toLowerCase());
    default:
      return (name) => BUNDLE_ENTRY_NAMES.includes(name);
  }
}

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
  if (ext === '.ppk' || ext === '.apk' || ext === '.ipa') {
    return readFirstZipEntry(
      filePath,
      bundleEntryMatcher(ext.slice(1) as BaseArtifactType),
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
  if ((await sha256File(file).catch(() => '')) !== bundleHash) {
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
  knownHash?: string,
): Promise<{ path: string; bundleHash: string }> {
  const bundleHash = knownHash ?? sha256Hex(bundle);
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
  const staleTmpCutoff = Date.now() - STALE_CACHE_TMP_MS;
  for (const name of await fs.readdir(dir)) {
    const isTmp = isCacheTmpName(name);
    if (!isTmp && !/^[0-9a-f]{64}$/.test(name)) continue;
    const stat = await fs.stat(path.join(dir, name)).catch(() => null);
    if (!stat?.isFile()) continue;
    if (isTmp) {
      // an interrupted cachePut; nothing will ever rename it into place
      if (stat.mtimeMs < staleTmpCutoff)
        await fs.remove(path.join(dir, name)).catch(() => {});
      continue;
    }
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

/** `<sha256>.<pid>.tmp`, the staging name cachePut writes before renaming */
function isCacheTmpName(name: string): boolean {
  return /^[0-9a-f]{64}\.\d+\.tmp$/.test(name);
}

/** Remove every cached bundle (and staging leftovers); returns the bundle count. */
export async function cleanCache(): Promise<number> {
  const dir = cacheDir();
  if (!(await fs.pathExists(dir))) return 0;
  let bundles = 0;
  for (const name of await fs.readdir(dir)) {
    const isBundle = /^[0-9a-f]{64}$/.test(name);
    if (!isBundle && !isCacheTmpName(name)) continue;
    await fs.remove(path.join(dir, name));
    if (isBundle) bundles += 1;
  }
  return bundles;
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
  const controller = new AbortController();
  const headersTimer = setTimeout(
    () => controller.abort(new Error('timeout waiting for response')),
    FETCH_HEADERS_TIMEOUT_MS,
  );
  let response: Response;
  try {
    response = await webFetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(headersTimer);
  }
  if (!response.ok || !response.body) {
    throw new Error(`download failed: HTTP ${response.status} ${url}`);
  }
  await saveResponse(response, destination, controller);
}

// ---------------------------------------------------------------------------
// resolution
// ---------------------------------------------------------------------------

export interface HermesBaseServerRecord {
  versionId?: number | null;
  hash: string;
  artifactType?: BaseArtifactType;
  bundleHash?: string | null;
  bytecodeVersion?: number | null;
  url: string;
  /**
   * Location of the bundle's compressed bytes inside the ppk, reported by the
   * publishing CLI; lets the base be fetched with a single HTTP Range request.
   */
  bundleOffset?: number | null;
  bundleCompressedSize?: number | null;
  /** zip compression method: 0 stored, 8 deflate */
  bundleCompression?: number | null;
}

interface FetchedBaseBundle {
  bundle: Buffer;
  /** sha256 of `bundle`, computed once here */
  bundleHash: string;
  /** how the bytes were obtained, for the log line */
  transport: 'range-entry' | 'range-zip' | 'full';
  fetchedBytes?: number;
  totalBytes?: number;
}

function hasBundleLocation(record: HermesBaseServerRecord): boolean {
  return (
    record.bundleOffset != null &&
    record.bundleCompressedSize != null &&
    record.bundleCompression != null &&
    (record.bundleCompression === ZIP_STORED ||
      record.bundleCompression === ZIP_DEFLATED)
  );
}

/**
 * Stream a response body to disk, giving up when no bytes arrive for
 * STREAM_IDLE_TIMEOUT_MS. `controller` is the one the request was made with
 * (aborting it also tears down the socket); a foreign response gets its own.
 */
async function saveResponse(
  response: Response,
  destination: string,
  controller = new AbortController(),
): Promise<void> {
  if (!response.body) throw new Error('empty response body');
  await fs.ensureDir(path.dirname(destination));
  const abort = () =>
    controller.abort(
      new Error(`download stalled for ${STREAM_IDLE_TIMEOUT_MS / 1000}s`),
    );
  let idle = setTimeout(abort, STREAM_IDLE_TIMEOUT_MS);
  const watchdog = new PassThrough({
    transform(chunk, _encoding, callback) {
      clearTimeout(idle);
      idle = setTimeout(abort, STREAM_IDLE_TIMEOUT_MS);
      callback(null, chunk);
    },
  });
  try {
    await pipeline(
      Readable.fromWeb(response.body as any),
      watchdog,
      fs.createWriteStream(destination),
      { signal: controller.signal },
    );
  } finally {
    clearTimeout(idle);
  }
}

/**
 * Obtain the base bundle with as little traffic as possible, in order:
 *  1. one Range request for the bundle's compressed bytes when the server
 *     knows their location (ppk / apk / ipa published by a CLI that
 *     reported it);
 *  2. the archive's central directory over Range, then just the bundle
 *     entry (any zip: ppk, apk, ipa — harmony .app nests a second zip and
 *     is skipped);
 *  3. the whole archive, as before.
 * A server that ignores Range (HTTP 200) streams the full archive into
 * `archive` without a second request. Every result is verified against
 * `record.bundleHash`. A mismatch of the located bytes (1) may only mean the
 * recorded location is stale, so the directory transport (2) still runs; a
 * mismatch of the entry itself (2, 3) is final — the same bytes would come
 * back however they are fetched — and raises BundleHashMismatchError.
 */
export async function fetchBaseBundle(
  record: HermesBaseServerRecord,
  artifactType: BaseArtifactType,
  archive: string,
  log: (message: string) => void = () => {},
): Promise<FetchedBaseBundle> {
  const matches = bundleEntryMatcher(artifactType);
  const verified = (
    bundle: Buffer | null,
  ): { bundle: Buffer; bundleHash: string } => {
    if (!bundle) throw new PermanentBaseError('bundle entry not found');
    const bundleHash = sha256Hex(bundle);
    if (record.bundleHash && bundleHash !== record.bundleHash) {
      throw new BundleHashMismatchError(bundleHash, record.bundleHash);
    }
    return { bundle, bundleHash };
  };
  const fromFullResponse = async (
    response: Response,
  ): Promise<FetchedBaseBundle> => {
    await saveResponse(response, archive);
    return {
      ...verified(await extractBundleFromArchive(archive)),
      transport: 'full',
    };
  };
  const skip = (reason: string) =>
    log(t('hermesBaseRangeFallback', { reason }));

  // harmony .app nests the bundle in a second zip, so a location inside the
  // outer archive is never reported for it
  if (artifactType !== 'app' && hasBundleLocation(record)) {
    try {
      const { data, fetchedBytes, totalBytes } = await fetchZipEntryData(
        record.url,
        {
          dataOffset: record.bundleOffset as number,
          compressedSize: record.bundleCompressedSize as number,
          compressionMethod: record.bundleCompression as number,
        },
      );
      return {
        ...verified(data),
        transport: 'range-entry',
        fetchedBytes,
        totalBytes,
      };
    } catch (error: any) {
      if (error instanceof RangeUnsupportedError) {
        skip('server ignores Range');
        return fromFullResponse(error.response);
      }
      skip(`entry range: ${error?.message ?? error}`);
    }
  }

  if (artifactType !== 'app') {
    try {
      const remote = await openRemoteZip(record.url);
      if (remote.kind === 'full') {
        skip('server ignores Range');
        return fromFullResponse(remote.response);
      }
      const bundle = await readRemoteZipEntry(
        remote.zipFile,
        matches,
        remote.reader,
      );
      return {
        ...verified(bundle),
        transport: 'range-zip',
        fetchedBytes: remote.reader.fetchedBytes,
        totalBytes: remote.reader.totalSize,
      };
    } catch (error: any) {
      if (error instanceof RangeUnsupportedError) {
        skip('server ignores Range');
        return fromFullResponse(error.response);
      }
      // the real entry was read and is not the recorded one: final
      if (error instanceof PermanentBaseError) throw error;
      skip(`zip range: ${error?.message ?? error}`);
    }
  }

  await downloadToFile(record.url, archive);
  return {
    ...verified(await extractBundleFromArchive(archive)),
    transport: 'full',
  };
}

export interface ResolveHermesBaseParams {
  option: HermesBaseOption;
  hermesCommand: string;
  bytecodeVersion: number;
  appId?: string;
  cacheMaxMb?: number;
  /**
   * server lookup; returns null when the app has no usable base. The server
   * itself falls back to the newest legacy version, then the newest native
   * package (bytecodeVersion is null and verified here after download).
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
    record = await retryOnce(() =>
      params.fetchBase(params.appId as string, bytecodeVersion),
    );
  } catch (error: any) {
    log(
      t('hermesBaseNone', {
        reason: `server lookup failed: ${error?.message ?? error}`,
      }),
    );
    return null;
  }
  const source: HermesBaseSelection['source'] =
    record?.artifactType && record.artifactType !== 'ppk'
      ? 'native-package'
      : record?.bytecodeVersion == null
        ? 'latest-version'
        : 'download';
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
    if (hit && record.bytecodeVersion == null) {
      // the server does not know the HBC version (legacy version, native
      // package): the download path checks it, the cache path must too
      const version = await readFileHbcVersion(hit);
      if (version !== bytecodeVersion) {
        log(
          t('hermesBaseNone', {
            reason: `cached base is HBC ${version ?? 'n/a'}, need ${bytecodeVersion}`,
          }),
        );
        return null;
      }
    }
    if (hit) {
      log(
        t('hermesBaseUsing', {
          source: `cache ${record.bundleHash.slice(0, 12)}${record.versionId == null ? '' : ` (version ${record.versionId})`}`,
          version: bytecodeVersion,
        }),
      );
      return {
        path: hit,
        bytecodeVersion,
        bundleHash: record.bundleHash,
        versionId: record.versionId ?? undefined,
        hash: record.hash,
        source: 'cache',
      };
    }
  }
  // 2. download, extract, verify, cache — transport errors get a second try
  for (let attempt = 1; attempt <= 2; attempt++) {
    const dir = tmpDir();
    await fs.ensureDir(dir);
    const artifactType: BaseArtifactType = [
      'ppk',
      'apk',
      'ipa',
      'app',
    ].includes(record.artifactType ?? '')
      ? (record.artifactType as BaseArtifactType)
      : 'ppk';
    const archive = path.join(
      dir,
      `base-${process.pid}-${Date.now()}-${attempt}.${artifactType}`,
    );
    try {
      log(t('hermesBaseDownloading', { url: record.url }));
      const fetched = await fetchBaseBundle(record, artifactType, archive, log);
      const { bundle, bundleHash: actualHash } = fetched;
      if (fetched.transport !== 'full') {
        log(
          t('hermesBaseRangeFetched', {
            fetchedKb: Math.ceil((fetched.fetchedBytes ?? 0) / 1024),
            totalKb: Math.ceil((fetched.totalBytes ?? 0) / 1024),
          }),
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
      const cached = await cachePut(bundle, params.cacheMaxMb, actualHash);
      log(
        t('hermesBaseUsing', {
          source:
            record.versionId == null
              ? `native package ${record.hash.slice(0, 8)}`
              : `version ${record.versionId} ${record.hash.slice(0, 8)}`,
          version: bytecodeVersion,
        }),
      );
      return {
        path: cached.path,
        bytecodeVersion,
        bundleHash: cached.bundleHash,
        versionId: record.versionId ?? undefined,
        hash: record.hash,
        source,
      };
    } catch (error: any) {
      if (attempt === 2 || error instanceof PermanentBaseError) {
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

/** one retry after a short pause, for transient network failures */
async function retryOnce<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 500));
    return action();
  }
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
  // Cheap dispatch on the opcode before touching any regex: dumps run to
  // millions of lines and only a handful of instructions need rewriting.
  let indent = 0;
  while (indent < line.length && isSpace(line.charCodeAt(indent))) indent++;
  let opEnd = indent;
  while (opEnd < line.length && isLetter(line.charCodeAt(opEnd))) opEnd++;
  const opcode = line.slice(indent, opEnd);
  if (opcode === 'Offset' && line.startsWith('Offset in debug table', indent)) {
    return null;
  }
  let m: RegExpExecArray | null;
  if (opcode.startsWith('New') && opcode.includes('WithBuffer')) {
    m =
      /^(\s*New(?:Array|Object)WithBuffer)(?:Long)?(?:AndParent)?\s+(r\d+)(.*)$/.exec(
        line,
      );
    if (m) {
      const nums = m[3].match(/\d+/g) ?? [];
      return `${m[1]} ${m[2]} sizes=${nums.slice(0, 1).join(',')}`;
    }
  }
  if (opcode.charCodeAt(0) === 0x4a /* J */) {
    m = /^(\s*J[A-Za-z]+?)(Long)?\s+(L\d+|\d+)(.*)$/.exec(line);
    if (m) return `${m[1]} <tgt>${m[4]}`;
  }
  if (opcode.startsWith('DefineOwnById')) {
    m = /^(\s*DefineOwnById\w*\s+r\d+, r\d+, \d+, )(\d+)$/.exec(line);
    if (m) line = `${m[1]}"${strings.get(Number(m[2])) ?? `?${m[2]}`}"`;
  }
  // Operand-width variants of one instruction (GetByIdShort/GetById/GetByIdLong,
  // LoadConstString/LoadConstStringLongIndex, ...) only differ by how wide a
  // string/function id or offset is encoded — a foreign base hands the new
  // code's hot strings large ids, so the delta build legitimately picks the
  // wider form. Fold the suffix and the column padding that follows it.
  if (
    opEnd > indent &&
    (opEnd === line.length || isSpace(line.charCodeAt(opEnd)))
  ) {
    const folded = foldWidthSuffix(opcode);
    line = `${line.slice(0, indent)}${folded}${line.slice(opEnd).replace(/\s+/g, ' ')}`;
    // Switch jump tables sit after the instructions; their relative offset (and
    // the table header hermesc prints for them) moves with instruction widths.
    // The two switch instructions carry that offset in different operands:
    //   StringSwitchImm rX, <id>, <jtOffset>, <defaultLabel>, <count>
    //   UIntSwitchImm   rX, <jtOffset>, <defaultLabel>, <min>, <max>
    // Folding only the first shape let a shifted UIntSwitchImm offset read as a
    // real difference and drop an otherwise good delta build.
    if (folded === 'StringSwitchImm') {
      m = /^(\s*StringSwitchImm r\d+, \d+, )\d+(, L\d+, \d+)$/.exec(line);
      if (m) line = `${m[1]}<jt>${m[2]}`;
    } else if (folded === 'UIntSwitchImm') {
      m = /^(\s*UIntSwitchImm r\d+, )\d+(, L\d+, \d+, \d+)$/.exec(line);
      if (m) line = `${m[1]}<jt>${m[2]}`;
    } else if (folded === 'offset' && /^\s*offset \d+$/.test(line)) {
      line = line.replace(/\d+$/, '<jt>');
    }
  }
  return line;
}

function isSpace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0d;
}

function isLetter(code: number): boolean {
  return (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
}

/** strip one operand-width suffix (LongIndex, Long, Short) off an opcode */
function foldWidthSuffix(opcode: string): string {
  for (const suffix of ['LongIndex', 'Long', 'Short']) {
    if (opcode.length > suffix.length && opcode.endsWith(suffix)) {
      return opcode.slice(0, -suffix.length);
    }
  }
  return opcode;
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
