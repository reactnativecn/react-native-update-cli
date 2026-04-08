import path from 'path';
import * as fs from 'fs-extra';
import { npm, yarn } from 'global-dirs';
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

type Diff = (oldSource?: Buffer, newSource?: Buffer) => Buffer;
type HpatchCover = {
  oldPos: number | string | bigint;
  newPos: number | string | bigint;
  len: number | string | bigint;
};
type HpatchCompatiblePlan = {
  covers?: HpatchCover[];
};
type HdiffWithCoversOptions = {
  mode?: 'replace' | 'merge' | 'native-coalesce';
};
type HdiffModule = {
  diff?: Diff;
  diffWithCovers?: (
    oldSource: Buffer,
    newSource: Buffer,
    covers: HpatchCover[],
    options?: HdiffWithCoversOptions,
  ) => { diff?: Buffer };
};
type BsdiffModule = {
  diff?: Diff;
};
type ChiffModule = {
  hpatchCompatiblePlanResult?: (
    oldSource: Buffer,
    newSource: Buffer,
  ) => HpatchCompatiblePlan;
  hpatchApproximatePlanResult?: (
    oldSource: Buffer,
    newSource: Buffer,
  ) => HpatchCompatiblePlan;
};
type ChiffHpatchPolicy = 'off' | 'costed';
type ChiffHpatchExactPolicy = 'off' | 'on';
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
  useHdiff: boolean;
  target: DiffTarget;
};

export { enumZipEntries, readEntry };

const loadModule = <T>(pkgName: string): T | undefined => {
  const resolvePaths = ['.', npm.packages, yarn.packages];

  try {
    const resolved = require.resolve(pkgName, { paths: resolvePaths });
    return require(resolved) as T;
  } catch {}

  return undefined;
};

const hdiff = loadModule<HdiffModule>('node-hdiffpatch');
const bsdiff = loadModule<BsdiffModule>('node-bsdiff');
const chiff = loadModule<ChiffModule>('@chiff/node');

// Structured covers are experimental and can be expensive on real Hermes input.
// Keep native hdiff as the default unless the server explicitly opts in.
function resolveChiffHpatchPolicy(policy?: unknown): ChiffHpatchPolicy {
  const value = String(
    policy ?? process.env.RNU_CHIFF_HPATCH_POLICY ?? 'off',
  ).toLowerCase();
  if (
    value === 'costed' ||
    value === 'on' ||
    value === 'true' ||
    value === '1'
  ) {
    return 'costed';
  }
  return 'off';
}

function resolveChiffHpatchMinNativeBytes(value?: unknown): number {
  const raw = value ?? process.env.RNU_CHIFF_HPATCH_MIN_NATIVE_BYTES ?? 4096;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 4096;
  }
  return Math.floor(parsed);
}

function resolveChiffHpatchExactPolicy(policy?: unknown): ChiffHpatchExactPolicy {
  const value = String(
    policy ?? process.env.RNU_CHIFF_HPATCH_EXACT_COVERS ?? 'off',
  ).toLowerCase();
  if (value === 'on' || value === 'true' || value === '1') {
    return 'on';
  }
  return 'off';
}

function createChiffAwareHdiff(
  hdiffModule: HdiffModule,
  chiffModule: ChiffModule | undefined,
  policy: ChiffHpatchPolicy,
  minNativeBytes: number,
  exactPolicy: ChiffHpatchExactPolicy,
): Diff {
  const baseDiff = hdiffModule.diff;
  if (!baseDiff) {
    throw new Error(t('nodeHdiffpatchRequired', { scriptName }));
  }

  if (policy === 'off') {
    return baseDiff;
  }

  return (oldSource?: Buffer, newSource?: Buffer) => {
    const nativeDiff = baseDiff(oldSource, newSource);
    if (!oldSource || !newSource || !hdiffModule.diffWithCovers) {
      return nativeDiff;
    }

    let bestDiff = nativeDiff;
    const tryDiffWithCovers = (
      covers: HpatchCover[],
      mode: 'replace' | 'merge' | 'native-coalesce',
    ) => {
      try {
        const result = hdiffModule.diffWithCovers?.(
          oldSource,
          newSource,
          covers,
          { mode },
        );
        if (
          Buffer.isBuffer(result?.diff) &&
          result.diff.length < bestDiff.length
        ) {
          bestDiff = result.diff;
        }
      } catch {}
    };

    tryDiffWithCovers([], 'native-coalesce');

    if (nativeDiff.length < minNativeBytes) {
      return bestDiff;
    }

    try {
      const approximatePlan = chiffModule?.hpatchApproximatePlanResult?.(
        oldSource,
        newSource,
      );
      if (Array.isArray(approximatePlan?.covers)) {
        tryDiffWithCovers(approximatePlan.covers, 'merge');
      }
    } catch {}

    if (
      exactPolicy === 'off' ||
      !chiffModule?.hpatchCompatiblePlanResult
    ) {
      return bestDiff;
    }

    try {
      const plan = chiffModule.hpatchCompatiblePlanResult(oldSource, newSource);
      if (Array.isArray(plan.covers)) {
        tryDiffWithCovers(plan.covers, 'replace');
        tryDiffWithCovers(plan.covers, 'merge');
      }
    } catch {}

    return bestDiff;
  };
}

function basename(fn: string): string | undefined {
  const m = /^(.+\/)[^\/]+\/?$/.exec(fn);
  return m?.[1];
}

async function diffFromPPK(
  origin: string,
  next: string,
  output: string,
  diffFn: Diff,
) {
  fs.ensureDirSync(path.dirname(output));

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

  const zipfile = new YazlZipFile();

  const writePromise = new Promise<void>((resolve, reject) => {
    zipfile.outputStream.on('error', reject);
    zipfile.outputStream.pipe(fs.createWriteStream(output)).on('close', () => {
      resolve(void 0);
    });
  });

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
      //console.log('Found bundle');
      const newSource = await readEntry(entry, nextZipfile);
      //console.log('Begin diff');
      zipfile.addBuffer(
        diffFn(originSource, newSource),
        `${entry.fileName}.patch`,
        zipOptionsForPatchEntry(),
      );
      //console.log('End diff');
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
            return reject(
              new Error(`Unable to read zip entry: ${entry.fileName}`),
            );
          }
          zipfile.addReadStream(
            readStream,
            entry.fileName,
            zipOptionsForPayloadEntry(entry.fileName, entryPrefix),
          );
          readStream.on('end', () => {
            //console.log('add finished');
            resolve(void 0);
          });
        });
      });
    }
  });

  const deletes: Record<string, 1> = {};

  for (const k in originEntries) {
    if (!newEntries[k]) {
      console.log(t('deleteFile', { file: k }));
      deletes[k] = 1;
    }
  }

  //console.log({copies, deletes});
  zipfile.addBuffer(
    Buffer.from(JSON.stringify({ copies, deletes })),
    '__diff.json',
    zipOptionsForManifestEntry(),
  );
  zipfile.end();
  await writePromise;
}

async function diffFromPackage(
  origin: string,
  next: string,
  output: string,
  diffFn: Diff,
  originBundleName: string,
  transformPackagePath: (v: string) => string | undefined = (v: string) => v,
) {
  fs.ensureDirSync(path.dirname(output));

  const originEntries: Record<string, number> = {};
  const originMap: CrcMap = {};

  let originSource: Buffer | undefined;

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

  const zipfile = new YazlZipFile();

  const writePromise = new Promise<void>((resolve, reject) => {
    zipfile.outputStream.on('error', reject);
    zipfile.outputStream.pipe(fs.createWriteStream(output)).on('close', () => {
      resolve(void 0);
    });
  });

  await enumZipEntries(next, async (entry, nextZipfile) => {
    if (/\/$/.test(entry.fileName)) {
      // Directory
      zipfile.addEmptyDirectory(entry.fileName);
    } else if (isPPKBundleFileName(entry.fileName)) {
      //console.log('Found bundle');
      const newSource = await readEntry(entry, nextZipfile);
      //console.log('Begin diff');
      zipfile.addBuffer(
        diffFn(originSource, newSource),
        `${entry.fileName}.patch`,
        zipOptionsForPatchEntry(),
      );
      //console.log('End diff');
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
        return;
      }

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
            return reject(
              new Error(`Unable to read zip entry: ${entry.fileName}`),
            );
          }
          zipfile.addReadStream(
            readStream,
            entry.fileName,
            zipOptionsForPayloadEntry(entry.fileName, entryPrefix),
          );
          readStream.on('end', () => {
            //console.log('add finished');
            resolve(void 0);
          });
        });
      });
    }
  });

  zipfile.addBuffer(
    Buffer.from(JSON.stringify({ copies })),
    '__diff.json',
    zipOptionsForManifestEntry(),
  );
  zipfile.end();
  await writePromise;
}

type DiffCommandOptions = {
  customDiff?: Diff;
  customHdiffModule?: HdiffModule;
  customChiffModule?: ChiffModule;
  chiffHpatchPolicy?: ChiffHpatchPolicy;
  chiffHpatchMinNativeBytes?: number | string;
  chiffHpatchExactCovers?: ChiffHpatchExactPolicy | boolean | string | number;
  [key: string]: any;
};

function resolveDiffImplementation(
  useHdiff: boolean,
  options: DiffCommandOptions,
): Diff {
  if (options.customDiff) {
    return options.customDiff;
  }

  if (useHdiff) {
    const hdiffModule = options.customHdiffModule ?? hdiff;
    if (!hdiffModule?.diff) {
      throw new Error(t('nodeHdiffpatchRequired', { scriptName }));
    }
    return createChiffAwareHdiff(
      hdiffModule,
      options.customChiffModule ?? chiff,
      resolveChiffHpatchPolicy(options.chiffHpatchPolicy),
      resolveChiffHpatchMinNativeBytes(options.chiffHpatchMinNativeBytes),
      resolveChiffHpatchExactPolicy(options.chiffHpatchExactCovers),
    );
  }

  if (!bsdiff?.diff) {
    throw new Error(t('nodeBsdiffRequired', { scriptName }));
  }
  return bsdiff.diff;
}

function diffArgsCheck(
  args: string[],
  options: DiffCommandOptions,
  diffFnName: string,
  useHdiff: boolean,
) {
  const [origin, next] = args;

  if (!origin || !next) {
    throw new Error(t('usageDiff', { command: diffFnName }));
  }

  const diffFn = resolveDiffImplementation(useHdiff, options);
  const { output } = translateOptions({
    ...options,
    tempDir,
  });
  if (typeof output !== 'string') {
    throw new Error('Output path is required.');
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
  ({ diffFnName, useHdiff, target }: DiffCommandConfig) =>
  async ({ args, options }: CommandContext) => {
    const { origin, next, realOutput, diffFn } = diffArgsCheck(
      args,
      options as DiffCommandOptions,
      diffFnName,
      useHdiff,
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
  diff: createDiffCommand({
    diffFnName: 'diff',
    useHdiff: false,
    target: { kind: 'ppk' },
  }),
  hdiff: createDiffCommand({
    diffFnName: 'hdiff',
    useHdiff: true,
    target: { kind: 'ppk' },
  }),
  diffFromApk: createDiffCommand({
    diffFnName: 'diffFromApk',
    useHdiff: false,
    target: {
      kind: 'package',
      originBundleName: 'assets/index.android.bundle',
    },
  }),
  hdiffFromApk: createDiffCommand({
    diffFnName: 'hdiffFromApk',
    useHdiff: true,
    target: {
      kind: 'package',
      originBundleName: 'assets/index.android.bundle',
    },
  }),
  diffFromApp: createDiffCommand({
    diffFnName: 'diffFromApp',
    useHdiff: false,
    target: {
      kind: 'package',
      originBundleName: 'resources/rawfile/bundle.harmony.js',
    },
  }),
  hdiffFromApp: createDiffCommand({
    diffFnName: 'hdiffFromApp',
    useHdiff: true,
    target: {
      kind: 'package',
      originBundleName: 'resources/rawfile/bundle.harmony.js',
    },
  }),
  diffFromIpa: createDiffCommand({
    diffFnName: 'diffFromIpa',
    useHdiff: false,
    target: {
      kind: 'package',
      originBundleName: 'main.jsbundle',
      transformPackagePath: transformIpaPackagePath,
    },
  }),
  hdiffFromIpa: createDiffCommand({
    diffFnName: 'hdiffFromIpa',
    useHdiff: true,
    target: {
      kind: 'package',
      originBundleName: 'main.jsbundle',
      transformPackagePath: transformIpaPackagePath,
    },
  }),
};
