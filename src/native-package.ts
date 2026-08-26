import * as fs from 'fs-extra';
import os from 'os';
import path from 'path';
import {
  type Entry,
  open as openZipFile,
  type ZipFile as YauzlZipFile,
} from 'yauzl';
import { ZipFile as YazlZipFile } from 'yazl';
import type { Platform } from './types';
import { fitsRawZip, RawZipWriter } from './utils/zip-raw-writer';

export type NativePackageEntry = {
  diffPath: string;
  kind: 'bundle' | 'resource';
};

type NativePackageRule = {
  resolveEntry: (entryName: string) => NativePackageEntry | undefined;
};

const nativePackageRules: Record<Platform, NativePackageRule> = {
  android: {
    resolveEntry: (entryName) => {
      if (entryName === 'assets/index.android.bundle') {
        return { diffPath: entryName, kind: 'bundle' };
      }
      if (entryName.startsWith('assets/') || entryName.startsWith('res/')) {
        return { diffPath: entryName, kind: 'resource' };
      }
    },
  },
  ios: {
    resolveEntry: (entryName) => {
      const match = /^Payload\/[^/]+\.app\/(.+)$/.exec(entryName);
      const appPath = match?.[1];
      if (appPath === 'main.jsbundle') {
        return { diffPath: appPath, kind: 'bundle' };
      }
      if (appPath?.startsWith('assets/')) {
        return { diffPath: appPath, kind: 'resource' };
      }
    },
  },
  harmony: {
    resolveEntry: (entryName) => {
      if (entryName === 'resources/rawfile/bundle.harmony.js') {
        return { diffPath: entryName, kind: 'bundle' };
      }
      if (entryName.startsWith('resources/rawfile/assets/')) {
        return { diffPath: entryName, kind: 'resource' };
      }
    },
  },
};

/**
 * Resolve an archive entry that can be used as a native-package diff origin.
 * Upload extraction and diff indexing deliberately share this function so a
 * file cannot be removed from the uploaded baseline while still being
 * considered by the local diff implementation (or vice versa).
 */
export function resolveNativePackageEntry(
  platform: Platform,
  entryName: string,
): NativePackageEntry | undefined {
  return nativePackageRules[platform].resolveEntry(entryName);
}

/** Where the kept entries go: a raw copy (default) or a yazl repack. */
interface SlimSink {
  copyEntry(sourceZip: YauzlZipFile, entry: Entry): Promise<void>;
  /** add a local file under `fileName`, dated like `like` */
  addFile(filePath: string, fileName: string, like: Entry): Promise<void>;
  end(): Promise<void>;
  abort(): Promise<void>;
}

/**
 * Copies each entry's stored bytes, CRC and sizes verbatim (yauzl hands out
 * the raw file data with `decodeFileData: false`), so slimming a package is
 * bound by disk I/O rather than by deflating every asset again.
 */
class RawCopySink implements SlimSink {
  private readonly writer: RawZipWriter;
  constructor(output: string) {
    this.writer = new RawZipWriter(output);
  }
  copyEntry(sourceZip: YauzlZipFile, entry: Entry): Promise<void> {
    return new Promise((resolve, reject) => {
      sourceZip.openReadStream(
        entry,
        { decodeFileData: false },
        (error, readStream) => {
          if (error || !readStream) {
            reject(
              error ?? new Error(`Unable to read zip entry: ${entry.fileName}`),
            );
            return;
          }
          this.writer.addRawEntry(entry, readStream).then(resolve, reject);
        },
      );
    });
  }
  addFile(filePath: string, fileName: string, like: Entry): Promise<void> {
    // a nested slim archive is a zip of deflated entries: storing it as-is
    // loses nothing and skips another pass over its bytes
    return this.writer.addStoredFile(filePath, fileName, like);
  }
  end(): Promise<void> {
    return this.writer.end();
  }
  abort(): Promise<void> {
    return this.writer.abort();
  }
}

/** Re-deflates every kept entry through yazl; only for sources that need zip64. */
class RepackSink implements SlimSink {
  private readonly outputZip = new YazlZipFile();
  private readonly writePromise: Promise<void>;
  constructor(readonly output: string) {
    this.writePromise = new Promise<void>((resolve, reject) => {
      this.outputZip.outputStream.once('error', reject);
      this.outputZip.outputStream
        .pipe(fs.createWriteStream(output))
        .once('error', reject)
        .once('close', () => resolve());
    });
  }
  copyEntry(sourceZip: YauzlZipFile, entry: Entry): Promise<void> {
    return new Promise((resolve, reject) => {
      sourceZip.openReadStream(entry, (error, readStream) => {
        if (error || !readStream) {
          reject(
            error ?? new Error(`Unable to read zip entry: ${entry.fileName}`),
          );
          return;
        }
        readStream.once('error', reject);
        readStream.once('end', () => resolve());
        this.outputZip.addReadStream(readStream, entry.fileName, {
          compress: entry.compressionMethod !== 0,
          mtime: entry.getLastModDate(),
        });
      });
    });
  }
  async addFile(
    filePath: string,
    fileName: string,
    like: Entry,
  ): Promise<void> {
    this.outputZip.addFile(filePath, fileName, {
      compress: like.compressionMethod !== 0,
      mtime: like.getLastModDate(),
    });
  }
  async end(): Promise<void> {
    this.outputZip.end();
    await this.writePromise;
  }
  async abort(): Promise<void> {
    this.outputZip.end();
    await this.writePromise.catch(() => {});
    await fs.remove(this.output).catch(() => {});
  }
}

function openZip(source: string): Promise<YauzlZipFile> {
  return new Promise((resolve, reject) => {
    openZipFile(source, { lazyEntries: true }, (error, zipFile) => {
      if (error || !zipFile) {
        reject(error ?? new Error(`Unable to open zip file: ${source}`));
        return;
      }
      resolve(zipFile);
    });
  });
}

function extractEntryToFile(
  sourceZip: YauzlZipFile,
  entry: Entry,
  outputPath: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    sourceZip.openReadStream(entry, (error, readStream) => {
      if (error) {
        reject(error);
        return;
      }
      if (!readStream) {
        reject(new Error(`Unable to read zip entry: ${entry.fileName}`));
        return;
      }

      const writeStream = fs.createWriteStream(outputPath);
      readStream.once('error', reject);
      writeStream.once('error', reject);
      writeStream.once('close', () => resolve());
      readStream.pipe(writeStream);
    });
  });
}

export interface SlimPackageOptions {
  /** re-deflate through yazl even when a raw copy would do (tests) */
  repack?: boolean;
}

async function filterNativePackageArchive(
  source: string,
  output: string,
  platform: Platform,
  options: SlimPackageOptions,
): Promise<{ bundles: number; entries: number }> {
  await fs.ensureDir(path.dirname(output));
  const scratchDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'rnu-native-package-entry-'),
  );
  const sourceZip = await openZip(source);
  // a subset of the source never outgrows it, so the source's own size and
  // entry count decide whether plain (non-zip64) headers are enough
  const rawCopy =
    !options.repack &&
    fitsRawZip((await fs.stat(source)).size, sourceZip.entryCount);
  const sink: SlimSink = rawCopy
    ? new RawCopySink(output)
    : new RepackSink(output);
  let includedEntries = 0;
  let includedBundles = 0;
  let nestedArchiveIndex = 0;

  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const fail = (error: unknown) => {
        if (settled) {
          return;
        }
        settled = true;
        sourceZip.close();
        reject(error);
      };

      sourceZip.once('error', fail);
      sourceZip.once('end', () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      });
      sourceZip.on('entry', async (entry) => {
        try {
          if (entry.fileName.endsWith('/')) {
            sourceZip.readEntry();
            return;
          }

          // Harmony .app packages contain one or more nested .hap archives.
          // Rebuild those archives recursively and keep their outer path so
          // the slim package has the same nesting as the original package.
          if (
            platform === 'harmony' &&
            entry.fileName.toLowerCase().endsWith('.hap')
          ) {
            const index = nestedArchiveIndex++;
            const nestedSource = path.join(scratchDir, `${index}.source.hap`);
            const nestedOutput = path.join(scratchDir, `${index}.slim.hap`);
            await extractEntryToFile(sourceZip, entry, nestedSource);
            const nestedResult = await filterNativePackageArchive(
              nestedSource,
              nestedOutput,
              platform,
              options,
            );
            if (nestedResult.entries > 0) {
              await sink.addFile(nestedOutput, entry.fileName, entry);
              includedEntries += nestedResult.entries;
              includedBundles += nestedResult.bundles;
            }
            sourceZip.readEntry();
            return;
          }

          const resolvedEntry = resolveNativePackageEntry(
            platform,
            entry.fileName,
          );
          if (resolvedEntry) {
            await sink.copyEntry(sourceZip, entry);
            includedEntries += 1;
            if (resolvedEntry.kind === 'bundle') {
              includedBundles += 1;
            }
          }
          sourceZip.readEntry();
        } catch (error) {
          fail(error);
        }
      });

      sourceZip.readEntry();
    });

    await sink.end();
    return { bundles: includedBundles, entries: includedEntries };
  } catch (error) {
    await sink.abort();
    throw error;
  } finally {
    await fs.remove(scratchDir);
  }
}

/**
 * Repack a native package with only the bundle and resources required by
 * package-origin diffs. Entry names and nested Harmony HAP structure are kept.
 */
export async function createSlimNativePackage(
  source: string,
  output: string,
  platform: Platform,
  options: SlimPackageOptions = {},
): Promise<void> {
  const result = await filterNativePackageArchive(
    source,
    output,
    platform,
    options,
  );
  if (result.bundles === 0) {
    await fs.remove(output);
    throw new Error(`Bundle entry not found in native package: ${source}`);
  }
}
