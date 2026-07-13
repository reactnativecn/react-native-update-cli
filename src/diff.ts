import { createHash } from 'node:crypto';
import * as fs from 'fs-extra';
import { npm, yarn } from 'global-dirs';
import os from 'os';
import path from 'path';
import type { Entry, ZipFile as YauzlZipFile } from 'yauzl';
import { ZipFile as YazlZipFile } from 'yazl';
import { resolveNativePackageEntry } from './native-package';
import type { CommandContext, Platform } from './types';
import { translateOptions } from './utils';
import { isPPKBundleFileName, scriptName, tempDir } from './utils/constants';
import {
  type HbcTransformMeta,
  transformHbcWithLayout,
  tryTransformPair,
} from './utils/hbcTransform';
import { t } from './utils/i18n';
import {
  enumZipEntries,
  readEntry,
  readEntryPrefix,
  writeEntry,
} from './utils/zip-entries';
import {
  ZIP_ENTRY_SNIFF_BYTES,
  zipOptionsForManifestEntry,
  zipOptionsForPatchEntry,
  zipOptionsForPayloadEntry,
} from './utils/zip-options';

type Diff = (
  oldSource?: Buffer,
  newSource?: Buffer,
) => Buffer | Promise<Buffer>;
type Patch = (oldSource: Buffer, diffData: Buffer) => Buffer;
type DiffStream = (
  oldPath: string,
  newPath: string,
  outDiffPath: string,
) => unknown | Promise<unknown>;
type PatchStream = (
  oldPath: string,
  diffPath: string,
  outNewPath: string,
) => unknown | Promise<unknown>;
type HdiffModule = {
  diff?: Diff;
  patch?: Patch;
  diffStream?: DiffStream;
  patchStream?: PatchStream;
  diffSingleStream?: DiffStream;
  patchSingleStream?: PatchStream;
  capabilities?: {
    diffStreamVerifiesOutput?: boolean;
    diffSingleStreamVerifiesOutput?: boolean;
    diffWindowVerifiesOutput?: boolean;
  };
};
type BundleSource =
  | { kind: 'buffer'; data: Buffer }
  | {
      kind: 'file';
      path: string;
      size: number;
      materializeDurationMs: number;
    };
type BundlePatch =
  | { kind: 'buffer'; data: Buffer }
  | { kind: 'file'; path: string };
type BundlePatchResult = {
  patch: BundlePatch;
  hbcTransform?: HbcTransformMeta;
};
type EntryMap = Record<string, { crc32: number; fileName: string }>;
type CrcMap = Record<number, string>;
type CopyMap = Record<string, string>;
type DiffTarget =
  | { kind: 'ppk' }
  | {
      kind: 'package';
      platform: Platform;
    };
type DiffCommandConfig = {
  diffFnName: string;
  target: DiffTarget;
};

export { enumZipEntries, readEntry };

const loadModule = <T>(pkgName: string): T | undefined => {
  const nodePathDirs = (process.env.NODE_PATH || '')
    .split(path.delimiter)
    .filter(Boolean);
  const resolvePaths = ['.', ...nodePathDirs, npm.packages, yarn.packages];

  try {
    const resolved = require.resolve(pkgName, { paths: resolvePaths });
    return require(resolved) as T;
  } catch {}

  return undefined;
};

const hdiff = loadModule<HdiffModule>('node-hdiffpatch');

function basename(fn: string): string | undefined {
  const m = /^(.+\/)[^/]+\/?$/.exec(fn);
  return m?.[1];
}

function createOutputZip(output: string) {
  fs.ensureDirSync(path.dirname(output));
  const zipfile = new YazlZipFile();
  const writePromise = new Promise<void>((resolve, reject) => {
    zipfile.outputStream.on('error', reject);
    zipfile.outputStream.pipe(fs.createWriteStream(output)).on('close', () => {
      resolve(void 0);
    });
  });
  return { zipfile, writePromise };
}

// baseline patch 小于该值时跳过变换尝试:节省一次 diff 的 CPU,
// 且此时变换收益上限(~25%)也抵不过元数据开销
const HBC_TRANSFORM_MIN_BASELINE_BYTES = 64 * 1024;

type BundleDiffOptions = {
  hbcTransform?: boolean;
  patchFn?: Patch;
  /** 测试用:覆写跳过变换尝试的 baseline 大小下限 */
  minBaselineBytes?: number;
  /**
   * bundle 尺寸达到该字节数时改走流式 diff:生成端内存 O(块匹配),
   * 彻底绕开内存 diff 的后缀数组峰值(~6× bundle)。0/未设 = 关闭。
   * 优先使用 single 格式流式生成(diffSingleStream,产物与 diff() 同格式,
   * 老客户端可直接应用,任何轨道均可开启);仅当 single 流式不可用时回退
   * HDIFF13(diffStream)——该格式老客户端不识别,只应在 v2 轨道下开启。
   */
  streamThresholdBytes?: number;
  diffStreamFn?: DiffStream;
  patchStreamFn?: PatchStream;
  /** 流式产物是否为 single 格式(决定 baseline 轨道是否可用) */
  streamEmitsSingleFormat?: boolean;
  /** diffStreamFn 内部已经完整 apply-and-compare,可跳过重复还原 */
  streamOutputVerified?: boolean;
  onDiffPhase?: (metric: {
    phase: 'materialize' | 'diff' | 'verify';
    durationMs: number;
    inputBytes: number;
    outputBytes?: number;
    skipped?: boolean;
  }) => void;
};

function reportDiffPhase(
  options: BundleDiffOptions,
  metric: Parameters<NonNullable<BundleDiffOptions['onDiffPhase']>>[0],
) {
  try {
    options.onDiffPhase?.(metric);
  } catch {
    // Observability must never break patch generation.
  }
}

const bundleSourceSize = (source: BundleSource) =>
  source.kind === 'buffer' ? source.data.length : source.size;

const bundleSourceBuffer = async (source: BundleSource) =>
  source.kind === 'buffer' ? source.data : fs.readFile(source.path);

async function bundleSourceFile(
  source: BundleSource,
  outputPath: string,
): Promise<string> {
  if (source.kind === 'file') {
    return source.path;
  }
  await fs.writeFile(outputPath, source.data);
  return outputPath;
}

async function hashFile(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest('hex');
}

async function filesEqual(leftPath: string, rightPath: string) {
  const [leftStat, rightStat] = await Promise.all([
    fs.stat(leftPath),
    fs.stat(rightPath),
  ]);
  if (leftStat.size !== rightStat.size) {
    return false;
  }
  const [leftHash, rightHash] = await Promise.all([
    hashFile(leftPath),
    hashFile(rightPath),
  ]);
  return leftHash === rightHash;
}

/**
 * 大 bundle 流式路径:普通 bundle 直接从 ZIP entry 落盘后传入 native,
 * 避免 old/new/restored 的整块 Buffer 副本。HBC 变换仍需 Buffer,因为
 * T/T⁻¹ 当前是内存算法。native 已自校验的普通产物不再重复 patch;
 * 自定义/变换路径仍保留 round-trip 校验。
 */
async function buildStreamBundlePatch(
  originSource: BundleSource,
  newSource: BundleSource,
  options: BundleDiffOptions,
  workRoot: string,
): Promise<BundlePatchResult> {
  const diffStreamFn = options.diffStreamFn;
  const patchStreamFn = options.patchStreamFn;
  if (!diffStreamFn || !patchStreamFn) {
    throw new Error(
      'stream diff requires diffStream/patchStream from node-hdiffpatch',
    );
  }

  const tempRoot = fs.mkdtempSync(path.join(workRoot, 'stream-'));
  const inputBytes =
    bundleSourceSize(originSource) + bundleSourceSize(newSource);
  const extractionDurationMs =
    (originSource.kind === 'file' ? originSource.materializeDurationMs : 0) +
    (newSource.kind === 'file' ? newSource.materializeDurationMs : 0);
  let phaseStartedAt = performance.now();
  const rawOldFile = await bundleSourceFile(
    originSource,
    path.join(tempRoot, 'old.bin'),
  );
  const rawNewFile = await bundleSourceFile(
    newSource,
    path.join(tempRoot, 'new.bin'),
  );
  const originBuffer = options.hbcTransform
    ? await bundleSourceBuffer(originSource)
    : null;
  const newBuffer = options.hbcTransform
    ? await bundleSourceBuffer(newSource)
    : null;
  const pair =
    originBuffer && newBuffer
      ? tryTransformPair(originBuffer, newBuffer)
      : null;
  const oldFile = pair
    ? path.join(tempRoot, 'old-transformed.bin')
    : rawOldFile;
  const newFile = pair
    ? path.join(tempRoot, 'new-transformed.bin')
    : rawNewFile;
  const patchFile = path.join(tempRoot, 'patch.bin');

  if (pair) {
    await Promise.all([
      fs.writeFile(oldFile, pair.tOld),
      fs.writeFile(newFile, pair.tNew),
    ]);
  }
  reportDiffPhase(options, {
    phase: 'materialize',
    durationMs: extractionDurationMs + performance.now() - phaseStartedAt,
    inputBytes,
  });

  phaseStartedAt = performance.now();
  await diffStreamFn(oldFile, newFile, patchFile);
  const patchBytes = (await fs.stat(patchFile)).size;
  reportDiffPhase(options, {
    phase: 'diff',
    durationMs: performance.now() - phaseStartedAt,
    inputBytes,
    outputBytes: patchBytes,
  });

  // 变换路径必须验证 T⁻¹ 和元数据;未声明自校验的自定义 diff 也保留
  // round-trip。node-hdiffpatch native 普通路径已经在返回前完整验证。
  if (pair || !options.streamOutputVerified) {
    phaseStartedAt = performance.now();
    const restoredFile = path.join(tempRoot, 'restored.bin');
    await patchStreamFn(oldFile, patchFile, restoredFile);
    if (pair) {
      const restoredRaw = await fs.readFile(restoredFile);
      const restored = transformHbcWithLayout(restoredRaw, pair.layout, true);
      if (
        !restored ||
        !newBuffer ||
        Buffer.compare(restored, newBuffer) !== 0
      ) {
        throw new Error('stream diff round-trip verification failed');
      }
    } else if (!(await filesEqual(restoredFile, rawNewFile))) {
      throw new Error('stream diff round-trip verification failed');
    }
    reportDiffPhase(options, {
      phase: 'verify',
      durationMs: performance.now() - phaseStartedAt,
      inputBytes,
      outputBytes: patchBytes,
    });
  } else {
    reportDiffPhase(options, {
      phase: 'verify',
      durationMs: 0,
      inputBytes,
      outputBytes: patchBytes,
      skipped: true,
    });
  }

  return {
    patch: { kind: 'file', path: patchFile },
    ...(pair ? { hbcTransform: pair.meta } : {}),
  };
}

/**
 * 生成 bundle patch:默认现状路径;开启 hbcTransform 时对 Hermes bundle
 * 做双候选择优(baseline vs 变换域 + 元数据开销),且变换候选必须通过
 * 本地 round-trip 还原自检才会被采用——收益永不为负,未知格式天然安全。
 */
async function buildBundlePatch(
  diffFn: Diff,
  originSource: BundleSource | undefined,
  newSource: BundleSource,
  options: BundleDiffOptions,
  workRoot: string,
): Promise<BundlePatchResult> {
  if (
    options.streamThresholdBytes &&
    originSource &&
    Math.max(bundleSourceSize(originSource), bundleSourceSize(newSource)) >=
      options.streamThresholdBytes
  ) {
    return buildStreamBundlePatch(originSource, newSource, options, workRoot);
  }

  const [originBuffer, newBuffer] = await Promise.all([
    originSource
      ? bundleSourceBuffer(originSource)
      : Promise.resolve(undefined),
    bundleSourceBuffer(newSource),
  ]);
  const baseline = await diffFn(originBuffer, newBuffer);
  if (
    !options.hbcTransform ||
    !options.patchFn ||
    !originBuffer ||
    baseline.length <
      (options.minBaselineBytes ?? HBC_TRANSFORM_MIN_BASELINE_BYTES)
  ) {
    return { patch: { kind: 'buffer', data: baseline } };
  }

  const pair = tryTransformPair(originBuffer, newBuffer);
  if (!pair) {
    return { patch: { kind: 'buffer', data: baseline } };
  }

  try {
    const candidate = await diffFn(pair.tOld, pair.tNew);
    const metaOverhead = Buffer.byteLength(JSON.stringify(pair.meta));
    if (candidate.length + metaOverhead >= baseline.length) {
      return { patch: { kind: 'buffer', data: baseline } };
    }

    const patched = options.patchFn(pair.tOld, candidate);
    const restored = transformHbcWithLayout(patched, pair.layout, true);
    if (!restored || Buffer.compare(restored, newBuffer) !== 0) {
      console.warn(t('hbcTransformRoundTripFailed'));
      return { patch: { kind: 'buffer', data: baseline } };
    }
    return {
      patch: { kind: 'buffer', data: candidate },
      hbcTransform: pair.meta,
    };
  } catch {
    return { patch: { kind: 'buffer', data: baseline } };
  }
}

async function addBundlePatch(
  zipfile: YazlZipFile,
  entry: Entry,
  nextZipfile: YauzlZipFile,
  diffFn: Diff,
  originSource: BundleSource | undefined,
  bundleOptions: BundleDiffOptions,
  hbcTransformMetas: Record<string, HbcTransformMeta>,
  workRoot: string,
) {
  const shouldStream =
    !!bundleOptions.streamThresholdBytes &&
    !!originSource &&
    Math.max(bundleSourceSize(originSource), entry.uncompressedSize) >=
      bundleOptions.streamThresholdBytes;
  let newSource: BundleSource;
  if (shouldStream) {
    const nextRoot = fs.mkdtempSync(path.join(workRoot, 'next-'));
    const nextPath = path.join(nextRoot, 'bundle.bin');
    const startedAt = performance.now();
    await writeEntry(entry, nextZipfile, nextPath);
    newSource = {
      kind: 'file',
      path: nextPath,
      size: entry.uncompressedSize,
      materializeDurationMs: performance.now() - startedAt,
    };
  } else {
    newSource = { kind: 'buffer', data: await readEntry(entry, nextZipfile) };
  }

  const { patch, hbcTransform } = await buildBundlePatch(
    diffFn,
    originSource,
    newSource,
    bundleOptions,
    workRoot,
  );
  const patchEntryName = `${entry.fileName}.patch`;
  if (hbcTransform) {
    hbcTransformMetas[patchEntryName] = hbcTransform;
  }
  if (patch.kind === 'file') {
    zipfile.addFile(patch.path, patchEntryName, zipOptionsForPatchEntry());
  } else {
    zipfile.addBuffer(patch.data, patchEntryName, zipOptionsForPatchEntry());
  }
}

async function readOriginBundleSource(
  entry: Entry,
  zipFile: YauzlZipFile,
  bundleOptions: BundleDiffOptions,
  workRoot: string,
): Promise<BundleSource> {
  if (!bundleOptions.streamThresholdBytes) {
    return { kind: 'buffer', data: await readEntry(entry, zipFile) };
  }
  const originRoot = fs.mkdtempSync(path.join(workRoot, 'origin-'));
  const originPath = path.join(originRoot, 'bundle.bin');
  const startedAt = performance.now();
  await writeEntry(entry, zipFile, originPath);
  return {
    kind: 'file',
    path: originPath,
    size: entry.uncompressedSize,
    materializeDurationMs: performance.now() - startedAt,
  };
}

async function addFileFromZipEntry(
  zipfile: YazlZipFile,
  entry: Entry,
  nextZipfile: YauzlZipFile,
) {
  const entryPrefix = await readEntryPrefix(
    entry,
    nextZipfile,
    ZIP_ENTRY_SNIFF_BYTES,
  );
  await new Promise<void>((resolve, reject) => {
    nextZipfile.openReadStream(entry, (err, readStream) => {
      if (err) {
        return reject(err);
      }
      if (!readStream) {
        return reject(new Error(`Unable to read zip entry: ${entry.fileName}`));
      }
      zipfile.addReadStream(
        readStream,
        entry.fileName,
        zipOptionsForPayloadEntry(entry.fileName, entryPrefix),
      );
      readStream.on('error', reject);
      readStream.on('end', () => {
        resolve(void 0);
      });
    });
  });
}

function finishDiffZip(
  zipfile: YazlZipFile,
  writePromise: Promise<void>,
  manifest: Record<string, unknown>,
) {
  const diffManifest = Buffer.from(JSON.stringify(manifest));
  zipfile.addBuffer(
    diffManifest,
    '__diff.json',
    zipOptionsForManifestEntry(diffManifest.length),
  );
  zipfile.end();
  return writePromise;
}

async function diffFromPPK(
  origin: string,
  next: string,
  output: string,
  diffFn: Diff,
  bundleOptions: BundleDiffOptions,
  workRoot: string,
) {
  const originEntries: EntryMap = {};
  const originMap: CrcMap = {};

  let originSource: BundleSource | undefined;

  await enumZipEntries(origin, async (entry, zipFile) => {
    originEntries[entry.fileName] = entry;
    if (!/\/$/.test(entry.fileName)) {
      // isFile
      originMap[entry.crc32] = entry.fileName;

      if (isPPKBundleFileName(entry.fileName)) {
        // This is source.
        originSource = await readOriginBundleSource(
          entry,
          zipFile,
          bundleOptions,
          workRoot,
        );
      }
    }
  });

  if (!originSource) {
    throw new Error(t('bundleFileNotFound'));
  }

  const copies: CopyMap = {};

  const { zipfile, writePromise } = createOutputZip(output);

  const addedEntry: Record<string, true> = {};

  function addEntry(fn: string) {
    //console.log(fn);
    if (!fn || addedEntry[fn]) {
      return;
    }
    addedEntry[fn] = true;
    const base = basename(fn);
    if (base) {
      addEntry(base);
    }
    zipfile.addEmptyDirectory(fn);
  }

  const newEntries: EntryMap = {};
  const hbcTransformMetas: Record<string, HbcTransformMeta> = {};

  await enumZipEntries(next, async (entry, nextZipfile) => {
    newEntries[entry.fileName] = entry;

    if (/\/$/.test(entry.fileName)) {
      // Directory
      if (!originEntries[entry.fileName]) {
        addEntry(entry.fileName);
      }
    } else if (isPPKBundleFileName(entry.fileName)) {
      await addBundlePatch(
        zipfile,
        entry,
        nextZipfile,
        diffFn,
        originSource,
        bundleOptions,
        hbcTransformMetas,
        workRoot,
      );
    } else {
      // If same file.
      const originEntry = originEntries[entry.fileName];
      if (originEntry && originEntry.crc32 === entry.crc32) {
        // ignore
        return;
      }

      // If moved from other place
      const movedFrom = originMap[entry.crc32];
      if (movedFrom) {
        const base = basename(entry.fileName);
        if (base && !originEntries[base]) {
          addEntry(base);
        }
        copies[entry.fileName] = movedFrom;
        return;
      }

      // New file.
      const basePath = basename(entry.fileName);
      if (basePath) {
        addEntry(basePath);
      }

      await addFileFromZipEntry(zipfile, entry, nextZipfile);
    }
  });

  const deletes: Record<string, 1> = {};

  for (const k in originEntries) {
    if (!newEntries[k]) {
      console.log(t('deleteFile', { file: k }));
      deletes[k] = 1;
    }
  }

  await finishDiffZip(zipfile, writePromise, {
    copies,
    deletes,
    ...(Object.keys(hbcTransformMetas).length
      ? { hbcTransform: hbcTransformMetas }
      : {}),
  });
}

async function diffFromPackage(
  origin: string,
  next: string,
  output: string,
  diffFn: Diff,
  platform: Platform,
  bundleOptions: BundleDiffOptions,
  workRoot: string,
) {
  const originEntries: Record<string, number> = {};
  const originMap: CrcMap = {};

  let originSource: BundleSource | undefined;

  // Content checksum (CRC32) for entries that are copied from a *different*
  // path in the origin package ("moved" entries). On Android these are the
  // res/ drawables (images), whose on-device path differs between an APK
  // baseline and an AAB(split-apk) install due to resource path shortening,
  // so the client cannot locate them by path and must fall back to content.
  const copiesCrc: Record<string, number> = {};

  await enumZipEntries(origin, async (entry, zipFile) => {
    if (!/\/$/.test(entry.fileName)) {
      const resolvedEntry = resolveNativePackageEntry(platform, entry.fileName);
      if (!resolvedEntry) {
        return;
      }
      const fn = resolvedEntry.diffPath;

      //console.log(fn);
      // isFile
      originEntries[fn] = entry.crc32;
      originMap[entry.crc32] = fn;

      if (resolvedEntry.kind === 'bundle') {
        // This is source.
        originSource = await readOriginBundleSource(
          entry,
          zipFile,
          bundleOptions,
          workRoot,
        );
      }
    }
  });

  if (!originSource) {
    throw new Error(t('bundleFileNotFound'));
  }

  const copies: CopyMap = {};

  const { zipfile, writePromise } = createOutputZip(output);
  const hbcTransformMetas: Record<string, HbcTransformMeta> = {};

  await enumZipEntries(next, async (entry, nextZipfile) => {
    if (/\/$/.test(entry.fileName)) {
      // Directory
      zipfile.addEmptyDirectory(entry.fileName);
    } else if (isPPKBundleFileName(entry.fileName)) {
      await addBundlePatch(
        zipfile,
        entry,
        nextZipfile,
        diffFn,
        originSource,
        bundleOptions,
        hbcTransformMetas,
        workRoot,
      );
    } else {
      // If same file.
      if (originEntries[entry.fileName] === entry.crc32) {
        copies[entry.fileName] = '';
        return;
      }
      // If moved from other place
      const movedFrom = originMap[entry.crc32];
      if (movedFrom) {
        copies[entry.fileName] = movedFrom;
        // Record the content checksum so the client can locate this file by
        // content when the origin path does not exist verbatim on device
        // (APK baseline -> AAB install path shortening).
        copiesCrc[entry.fileName] = entry.crc32;
        return;
      }

      await addFileFromZipEntry(zipfile, entry, nextZipfile);
    }
  });

  await finishDiffZip(zipfile, writePromise, {
    copies,
    copiesCrc,
    ...(Object.keys(hbcTransformMetas).length
      ? { hbcTransform: hbcTransformMetas }
      : {}),
  });
}

type DiffCommandOptions = {
  customDiff?: Diff;
  customPatch?: Patch;
  customDiffStream?: DiffStream;
  customPatchStream?: PatchStream;
  customDiffStreamVerified?: boolean;
  customDiffSingleStream?: DiffStream;
  customPatchSingleStream?: PatchStream;
  customDiffSingleStreamVerified?: boolean;
  customHdiffModule?: HdiffModule;
  onDiffPhase?: BundleDiffOptions['onDiffPhase'];
  hbcTransform?: boolean;
  bundleStreamThreshold?: number;
  [key: string]: any;
};

function resolveDiffImplementation(options: DiffCommandOptions): Diff {
  if (options.customDiff) {
    return options.customDiff;
  }

  const hdiffModule = options.customHdiffModule ?? hdiff;
  if (!hdiffModule?.diff) {
    throw new Error(t('nodeHdiffpatchRequired', { scriptName }));
  }
  return hdiffModule.diff;
}

// round-trip 自检需要 patch 能力;拿不到时禁用变换(安全优先),不报错
function resolvePatchImplementation(
  options: DiffCommandOptions,
): Patch | undefined {
  if (options.customPatch) {
    return options.customPatch;
  }
  const hdiffModule = options.customHdiffModule ?? hdiff;
  return hdiffModule?.patch;
}

function resolveBundleDiffOptions(
  options: DiffCommandOptions,
): BundleDiffOptions {
  const hdiffModule = options.customHdiffModule ?? hdiff;
  const streamOptions: Pick<
    BundleDiffOptions,
    | 'streamThresholdBytes'
    | 'diffStreamFn'
    | 'patchStreamFn'
    | 'streamEmitsSingleFormat'
    | 'streamOutputVerified'
  > = {};
  const observerOptions =
    typeof options.onDiffPhase === 'function'
      ? { onDiffPhase: options.onDiffPhase }
      : {};
  if (
    typeof options.bundleStreamThreshold === 'number' &&
    options.bundleStreamThreshold > 0
  ) {
    const singleDiffStreamFn =
      options.customDiffSingleStream ?? hdiffModule?.diffSingleStream;
    const singlePatchStreamFn =
      options.customPatchSingleStream ?? hdiffModule?.patchSingleStream;
    const diffStreamFn = options.customDiffStream ?? hdiffModule?.diffStream;
    const patchStreamFn = options.customPatchStream ?? hdiffModule?.patchStream;
    if (singleDiffStreamFn && singlePatchStreamFn) {
      streamOptions.streamThresholdBytes = options.bundleStreamThreshold;
      streamOptions.diffStreamFn = singleDiffStreamFn;
      streamOptions.patchStreamFn = singlePatchStreamFn;
      streamOptions.streamEmitsSingleFormat = true;
      streamOptions.streamOutputVerified = options.customDiffSingleStream
        ? options.customDiffSingleStreamVerified === true
        : hdiffModule?.capabilities?.diffSingleStreamVerifiesOutput === true;
    } else if (diffStreamFn && patchStreamFn) {
      streamOptions.streamThresholdBytes = options.bundleStreamThreshold;
      streamOptions.diffStreamFn = diffStreamFn;
      streamOptions.patchStreamFn = patchStreamFn;
      streamOptions.streamEmitsSingleFormat = false;
      streamOptions.streamOutputVerified = options.customDiffStream
        ? options.customDiffStreamVerified === true
        : hdiffModule?.capabilities?.diffStreamVerifiesOutput === true;
    } else {
      console.warn(t('bundleStreamNeedsHdiffpatch'));
    }
  }

  if (!options.hbcTransform) {
    return { ...observerOptions, ...streamOptions };
  }
  const patchFn = resolvePatchImplementation(options);
  if (!patchFn) {
    console.warn(t('hbcTransformNeedsPatch'));
    return { ...observerOptions, ...streamOptions };
  }
  return {
    hbcTransform: true,
    patchFn,
    ...observerOptions,
    ...streamOptions,
    ...(typeof options.hbcTransformMinBaseline === 'number'
      ? { minBaselineBytes: options.hbcTransformMinBaseline }
      : {}),
  };
}

function diffArgsCheck(
  args: string[],
  options: DiffCommandOptions,
  diffFnName: string,
) {
  const [origin, next] = args;

  if (!origin || !next) {
    throw new Error(t('usageDiff', { command: diffFnName }));
  }

  const diffFn = resolveDiffImplementation(options);
  const { output } = translateOptions({
    ...options,
    tempDir,
  } as DiffCommandOptions & { tempDir: string });
  if (typeof output !== 'string') {
    throw new Error(t('outputPathRequired'));
  }

  return {
    origin,
    next,
    diffFn,
    realOutput: output.replace(/\$\{time\}/g, `${Date.now()}`),
  };
}

const createDiffCommand =
  ({ diffFnName, target }: DiffCommandConfig) =>
  async ({ args, options }: CommandContext) => {
    const { origin, next, realOutput, diffFn } = diffArgsCheck(
      args,
      options as DiffCommandOptions,
      diffFnName,
    );
    const bundleOptions = resolveBundleDiffOptions(
      options as DiffCommandOptions,
    );

    const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rnu-bundle-diff-'));
    try {
      if (target.kind === 'ppk') {
        await diffFromPPK(
          origin,
          next,
          realOutput,
          diffFn,
          bundleOptions,
          workRoot,
        );
      } else {
        await diffFromPackage(
          origin,
          next,
          realOutput,
          diffFn,
          target.platform,
          bundleOptions,
          workRoot,
        );
      }
    } finally {
      fs.rmSync(workRoot, { recursive: true, force: true });
    }

    console.log(t('diffPackageGenerated', { output: realOutput }));
  };

export const diffCommands = {
  hdiff: createDiffCommand({
    diffFnName: 'hdiff',
    target: { kind: 'ppk' },
  }),
  hdiffFromApk: createDiffCommand({
    diffFnName: 'hdiffFromApk',
    target: {
      kind: 'package',
      platform: 'android',
    },
  }),
  hdiffFromApp: createDiffCommand({
    diffFnName: 'hdiffFromApp',
    target: {
      kind: 'package',
      platform: 'harmony',
    },
  }),
  hdiffFromIpa: createDiffCommand({
    diffFnName: 'hdiffFromIpa',
    target: {
      kind: 'package',
      platform: 'ios',
    },
  }),
};
