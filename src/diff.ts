import path from 'path';
import * as fs from 'fs-extra';
import { npm, yarn } from 'global-dirs';
import { ZipFile as YazlZipFile } from 'yazl';
import { translateOptions } from './utils';
import { isPPKBundleFileName, scriptName, tempDir } from './utils/constants';
import { t } from './utils/i18n';
import { enumZipEntries, readEntry } from './utils/zip-entries';

type Diff = (oldSource?: Buffer, newSource?: Buffer) => Buffer;

export { enumZipEntries, readEntry };

const loadDiffModule = (pkgName: string): Diff | undefined => {
  const resolvePaths = ['.', npm.packages, yarn.packages];

  try {
    const resolved = require.resolve(pkgName, { paths: resolvePaths });
    const mod = require(resolved);
    if (mod?.diff) {
      return mod.diff as Diff;
    }
  } catch {}

  return undefined;
};

let hdiff: Diff | undefined;
hdiff = (loadDiffModule('node-hdiffpatch') as any)?.diff;
let bsdiff: Diff | undefined;
let diff: Diff;
bsdiff = loadDiffModule('node-bsdiff');

function basename(fn: string) {
  const m = /^(.+\/)[^\/]+\/?$/.exec(fn);
  return m?.[1];
}

async function diffFromPPK(origin: string, next: string, output: string) {
  fs.ensureDirSync(path.dirname(output));

  const originEntries = {};
  const originMap = {};

  let originSource: Buffer | undefined;

  await enumZipEntries(origin, (entry, zipFile) => {
    originEntries[entry.fileName] = entry;
    if (!/\/$/.test(entry.fileName)) {
      // isFile
      originMap[entry.crc32] = entry.fileName;

      if (isPPKBundleFileName(entry.fileName)) {
        // This is source.
        return readEntry(entry, zipFile).then((v) => (originSource = v));
      }
    }
  });

  if (!originSource) {
    throw new Error(t('bundleFileNotFound'));
  }

  const copies = {};

  const zipfile = new YazlZipFile();

  const writePromise = new Promise((resolve, reject) => {
    zipfile.outputStream.on('error', (err) => {
      throw err;
    });
    zipfile.outputStream.pipe(fs.createWriteStream(output)).on('close', () => {
      resolve(void 0);
    });
  });

  const addedEntry = {};

  function addEntry(fn: string) {
    //console.log(fn);
    if (!fn || addedEntry[fn]) {
      return;
    }
    const base = basename(fn);
    if (base) {
      addEntry(base);
    }
    zipfile.addEmptyDirectory(fn);
  }

  const newEntries = {};

  await enumZipEntries(next, (entry, nextZipfile) => {
    newEntries[entry.fileName] = entry;

    if (/\/$/.test(entry.fileName)) {
      // Directory
      if (!originEntries[entry.fileName]) {
        addEntry(entry.fileName);
      }
    } else if (isPPKBundleFileName(entry.fileName)) {
      //console.log('Found bundle');
      return readEntry(entry, nextZipfile).then((newSource) => {
        //console.log('Begin diff');
        zipfile.addBuffer(
          diff(originSource, newSource),
          `${entry.fileName}.patch`,
        );
        //console.log('End diff');
      });
    } else {
      // If same file.
      const originEntry = originEntries[entry.fileName];
      if (originEntry && originEntry.crc32 === entry.crc32) {
        // ignore
        return;
      }

      // If moved from other place
      if (originMap[entry.crc32]) {
        const base = basename(entry.fileName);
        if (!originEntries[base]) {
          addEntry(base);
        }
        copies[entry.fileName] = originMap[entry.crc32];
        return;
      }

      // New file.
      addEntry(basename(entry.fileName));

      return new Promise((resolve, reject) => {
        nextZipfile.openReadStream(entry, (err, readStream) => {
          if (err) {
            return reject(err);
          }
          zipfile.addReadStream(readStream, entry.fileName);
          readStream.on('end', () => {
            //console.log('add finished');
            resolve(void 0);
          });
        });
      });
    }
  });

  const deletes = {};

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
  );
  zipfile.end();
  await writePromise;
}

async function diffFromPackage(
  origin: string,
  next: string,
  output: string,
  originBundleName: string,
  transformPackagePath = (v: string) => v,
) {
  fs.ensureDirSync(path.dirname(output));

  const originEntries = {};
  const originMap = {};

  let originSource: Buffer | undefined;

  await enumZipEntries(origin, (entry, zipFile) => {
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
        return readEntry(entry, zipFile).then((v) => (originSource = v));
      }
    }
  });

  if (!originSource) {
    throw new Error(t('bundleFileNotFound'));
  }

  const copies = {};

  const zipfile = new YazlZipFile();

  const writePromise = new Promise((resolve, reject) => {
    zipfile.outputStream.on('error', (err) => {
      throw err;
    });
    zipfile.outputStream.pipe(fs.createWriteStream(output)).on('close', () => {
      resolve(void 0);
    });
  });

  await enumZipEntries(next, (entry, nextZipfile) => {
    if (/\/$/.test(entry.fileName)) {
      // Directory
      zipfile.addEmptyDirectory(entry.fileName);
    } else if (isPPKBundleFileName(entry.fileName)) {
      //console.log('Found bundle');
      return readEntry(entry, nextZipfile).then((newSource) => {
        //console.log('Begin diff');
        zipfile.addBuffer(
          diff(originSource, newSource),
          `${entry.fileName}.patch`,
        );
        //console.log('End diff');
      });
    } else {
      // If same file.
      if (originEntries[entry.fileName] === entry.crc32) {
        copies[entry.fileName] = '';
        return;
      }
      // If moved from other place
      if (originMap[entry.crc32]) {
        copies[entry.fileName] = originMap[entry.crc32];
        return;
      }

      return new Promise((resolve, reject) => {
        nextZipfile.openReadStream(entry, (err, readStream) => {
          if (err) {
            return reject(err);
          }
          zipfile.addReadStream(readStream, entry.fileName);
          readStream.on('end', () => {
            //console.log('add finished');
            resolve(void 0);
          });
        });
      });
    }
  });

  zipfile.addBuffer(Buffer.from(JSON.stringify({ copies })), '__diff.json');
  zipfile.end();
  await writePromise;
}

function diffArgsCheck(args: string[], options: any, diffFn: string) {
  const [origin, next] = args;

  if (!origin || !next) {
    console.error(t('usageDiff', { command: diffFn }));
    process.exit(1);
  }
  if (options?.customDiff) {
    diff = options.customDiff;
  } else {
    if (diffFn.startsWith('hdiff')) {
      if (!hdiff) {
        console.error(t('nodeHdiffpatchRequired', { scriptName }));
        process.exit(1);
      }
      diff = hdiff;
    } else {
      if (!bsdiff) {
        console.error(t('nodeBsdiffRequired', { scriptName }));
        process.exit(1);
      }
      diff = bsdiff;
    }
  }

  const { output } = translateOptions({
    ...options,
    tempDir,
  });

  return {
    origin,
    next,
    realOutput: output.replace(/\$\{time\}/g, `${Date.now()}`),
  };
}

export const diffCommands = {
  async diff({ args, options }) {
    const { origin, next, realOutput } = diffArgsCheck(args, options, 'diff');

    await diffFromPPK(origin, next, realOutput);
    console.log(t('diffPackageGenerated', { output: realOutput }));
  },

  async hdiff({ args, options }) {
    const { origin, next, realOutput } = diffArgsCheck(args, options, 'hdiff');

    await diffFromPPK(origin, next, realOutput);
    console.log(t('diffPackageGenerated', { output: realOutput }));
  },

  async diffFromApk({ args, options }) {
    const { origin, next, realOutput } = diffArgsCheck(
      args,
      options,
      'diffFromApk',
    );

    await diffFromPackage(
      origin,
      next,
      realOutput,
      'assets/index.android.bundle',
    );
    console.log(t('diffPackageGenerated', { output: realOutput }));
  },

  async hdiffFromApk({ args, options }) {
    const { origin, next, realOutput } = diffArgsCheck(
      args,
      options,
      'hdiffFromApk',
    );

    await diffFromPackage(
      origin,
      next,
      realOutput,
      'assets/index.android.bundle',
    );
    console.log(t('diffPackageGenerated', { output: realOutput }));
  },

  async diffFromApp({ args, options }) {
    const { origin, next, realOutput } = diffArgsCheck(
      args,
      options,
      'diffFromApp',
    );
    await diffFromPackage(
      origin,
      next,
      realOutput,
      'resources/rawfile/bundle.harmony.js',
    );
    console.log(t('diffPackageGenerated', { output: realOutput }));
  },

  async hdiffFromApp({ args, options }) {
    const { origin, next, realOutput } = diffArgsCheck(
      args,
      options,
      'hdiffFromApp',
    );
    await diffFromPackage(
      origin,
      next,
      realOutput,
      'resources/rawfile/bundle.harmony.js',
    );
    console.log(t('diffPackageGenerated', { output: realOutput }));
  },

  async diffFromIpa({ args, options }) {
    const { origin, next, realOutput } = diffArgsCheck(
      args,
      options,
      'diffFromIpa',
    );

    await diffFromPackage(origin, next, realOutput, 'main.jsbundle', (v) => {
      const m = /^Payload\/[^/]+\/(.+)$/.exec(v);
      return m?.[1];
    });

    console.log(t('diffPackageGenerated', { output: realOutput }));
  },

  async hdiffFromIpa({ args, options }) {
    const { origin, next, realOutput } = diffArgsCheck(
      args,
      options,
      'hdiffFromIpa',
    );

    await diffFromPackage(origin, next, realOutput, 'main.jsbundle', (v) => {
      const m = /^Payload\/[^/]+\/(.+)$/.exec(v);
      return m?.[1];
    });

    console.log(t('diffPackageGenerated', { output: realOutput }));
  },
};
