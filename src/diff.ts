import * as fs from 'fs-extra';
import { npm, yarn } from 'global-dirs';
import path from 'path';
import type { Entry, ZipFile as YauzlZipFile } from 'yauzl';
import { ZipFile as YazlZipFile } from 'yazl';
import type { CommandContext } from './types';
import { translateOptions } from './utils';
import { isPPKBundleFileName, scriptName, tempDir } from './utils/constants';
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
type HdiffModule = {
  diff?: Diff;
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

async function addBundlePatch(
  zipfile: YazlZipFile,
  entry: Entry,
  nextZipfile: YauzlZipFile,
  diffFn: Diff,
  originSource: Buffer | undefined,
) {
  const newSource = await readEntry(entry, nextZipfile);
  zipfile.addBuffer(
    await diffFn(originSource, newSource),
    `${entry.fileName}.patch`,
    zipOptionsForPatchEntry(),
  );
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

  await enumZipEntries(next, async (entry, nextZipfile) => {
    newEntries[entry.fileName] = entry;

    if (/\/$/.test(entry.fileName)) {
      // Directory
      if (!originEntries[entry.fileName]) {
        addEntry(entry.fileName);
      }
    } else if (isPPKBundleFileName(entry.fileName)) {
      await addBundlePatch(zipfile, entry, nextZipfile, diffFn, originSource);
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

  await finishDiffZip(zipfile, writePromise, { copies, deletes });
}

async function diffFromPackage(
  origin: string,
  next: string,
  output: string,
  diffFn: Diff,
  originBundleName: string,
  transformPackagePath: (v: string) => string | undefined = (v: string) => v,
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

  await enumZipEntries(next, async (entry, nextZipfile) => {
    if (/\/$/.test(entry.fileName)) {
      // Directory
      zipfile.addEmptyDirectory(entry.fileName);
    } else if (isPPKBundleFileName(entry.fileName)) {
      await addBundlePatch(zipfile, entry, nextZipfile, diffFn, originSource);
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

  await finishDiffZip(zipfile, writePromise, { copies, copiesCrc });
}

type DiffCommandOptions = {
  customDiff?: Diff;
  customHdiffModule?: HdiffModule;
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

    if (target.kind === 'ppk') {
      await diffFromPPK(origin, next, realOutput, diffFn);
    } else {
      await diffFromPackage(
        origin,
        next,
        realOutput,
        diffFn,
        target.originBundleName,
        target.transformPackagePath,
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
