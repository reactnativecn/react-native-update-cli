import * as fs from 'fs-extra';
import { npm, yarn } from 'global-dirs';
import path from 'path';
import type { Entry, ZipFile as YauzlZipFile } from 'yauzl';
import { ZipFile as YazlZipFile } from 'yazl';
import type { CommandContext } from './types';
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
type HdiffModule = {
  diff?: Diff;
  patch?: Patch;
};
type EntryMap = Record<string, { crc32: number; fileName: string }>;
type CrcMap = Record<number, string>;
type CopyMap = Record<string, string>;
type PackagePathTransform = (v: string) => string | undefined;
type DiffTarget =
  | { kind: 'ppk' }
  | {
      kind: 'package';
      originBundleName: string;
      transformPackagePath?: PackagePathTransform;
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
};

/**
 * 生成 bundle patch:默认现状路径;开启 hbcTransform 时对 Hermes bundle
 * 做双候选择优(baseline vs 变换域 + 元数据开销),且变换候选必须通过
 * 本地 round-trip 还原自检才会被采用——收益永不为负,未知格式天然安全。
 */
async function buildBundlePatch(
  diffFn: Diff,
  originSource: Buffer | undefined,
  newSource: Buffer,
  options: BundleDiffOptions,
): Promise<{ patchData: Buffer; hbcTransform?: HbcTransformMeta }> {
  const baseline = await diffFn(originSource, newSource);
  if (
    !options.hbcTransform ||
    !options.patchFn ||
    !originSource ||
    baseline.length <
      (options.minBaselineBytes ?? HBC_TRANSFORM_MIN_BASELINE_BYTES)
  ) {
    return { patchData: baseline };
  }

  const pair = tryTransformPair(originSource, newSource);
  if (!pair) {
    return { patchData: baseline };
  }

  try {
    const candidate = await diffFn(pair.tOld, pair.tNew);
    const metaOverhead = Buffer.byteLength(JSON.stringify(pair.meta));
    if (candidate.length + metaOverhead >= baseline.length) {
      return { patchData: baseline };
    }

    const patched = options.patchFn(pair.tOld, candidate);
    const restored = transformHbcWithLayout(patched, pair.layout, true);
    if (!restored || Buffer.compare(restored, newSource) !== 0) {
      console.warn(t('hbcTransformRoundTripFailed'));
      return { patchData: baseline };
    }
    return { patchData: candidate, hbcTransform: pair.meta };
  } catch {
    return { patchData: baseline };
  }
}

async function addBundlePatch(
  zipfile: YazlZipFile,
  entry: Entry,
  nextZipfile: YauzlZipFile,
  diffFn: Diff,
  originSource: Buffer | undefined,
  bundleOptions: BundleDiffOptions,
  hbcTransformMetas: Record<string, HbcTransformMeta>,
) {
  const newSource = await readEntry(entry, nextZipfile);
  const { patchData, hbcTransform } = await buildBundlePatch(
    diffFn,
    originSource,
    newSource,
    bundleOptions,
  );
  const patchEntryName = `${entry.fileName}.patch`;
  if (hbcTransform) {
    hbcTransformMetas[patchEntryName] = hbcTransform;
  }
  zipfile.addBuffer(patchData, patchEntryName, zipOptionsForPatchEntry());
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
  bundleOptions: BundleDiffOptions = {},
) {
  const originEntries: EntryMap = {};
  const originMap: CrcMap = {};

  let originSource: Buffer | undefined;

  await enumZipEntries(origin, async (entry, zipFile) => {
    originEntries[entry.fileName] = entry;
    if (!/\/$/.test(entry.fileName)) {
      // isFile
      originMap[entry.crc32] = entry.fileName;

      if (isPPKBundleFileName(entry.fileName)) {
        // This is source.
        originSource = await readEntry(entry, zipFile);
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
  originBundleName: string,
  transformPackagePath: (v: string) => string | undefined = (v: string) => v,
  bundleOptions: BundleDiffOptions = {},
) {
  const originEntries: Record<string, number> = {};
  const originMap: CrcMap = {};

  let originSource: Buffer | undefined;

  // Content checksum (CRC32) for entries that are copied from a *different*
  // path in the origin package ("moved" entries). On Android these are the
  // res/ drawables (images), whose on-device path differs between an APK
  // baseline and an AAB(split-apk) install due to resource path shortening,
  // so the client cannot locate them by path and must fall back to content.
  const copiesCrc: Record<string, number> = {};

  await enumZipEntries(origin, async (entry, zipFile) => {
    if (!/\/$/.test(entry.fileName)) {
      const fn = transformPackagePath(entry.fileName);
      if (!fn) {
        return;
      }

      //console.log(fn);
      // isFile
      originEntries[fn] = entry.crc32;
      originMap[entry.crc32] = fn;

      if (fn === originBundleName) {
        // This is source.
        originSource = await readEntry(entry, zipFile);
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
  customHdiffModule?: HdiffModule;
  hbcTransform?: boolean;
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
  if (!options.hbcTransform) {
    return {};
  }
  const patchFn = resolvePatchImplementation(options);
  if (!patchFn) {
    console.warn(t('hbcTransformNeedsPatch'));
    return {};
  }
  return {
    hbcTransform: true,
    patchFn,
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

const transformIpaPackagePath: PackagePathTransform = (v) => {
  const match = /^Payload\/[^/]+\/(.+)$/.exec(v);
  return match?.[1];
};

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

    if (target.kind === 'ppk') {
      await diffFromPPK(origin, next, realOutput, diffFn, bundleOptions);
    } else {
      await diffFromPackage(
        origin,
        next,
        realOutput,
        diffFn,
        target.originBundleName,
        target.transformPackagePath,
        bundleOptions,
      );
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
      originBundleName: 'assets/index.android.bundle',
    },
  }),
  hdiffFromApp: createDiffCommand({
    diffFnName: 'hdiffFromApp',
    target: {
      kind: 'package',
      originBundleName: 'resources/rawfile/bundle.harmony.js',
    },
  }),
  hdiffFromIpa: createDiffCommand({
    diffFnName: 'hdiffFromIpa',
    target: {
      kind: 'package',
      originBundleName: 'main.jsbundle',
      transformPackagePath: transformIpaPackagePath,
    },
  }),
};
