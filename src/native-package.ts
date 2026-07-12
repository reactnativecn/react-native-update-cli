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

function copyEntryToZip(
  sourceZip: YauzlZipFile,
  entry: Entry,
  outputZip: YazlZipFile,
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

      readStream.once('error', reject);
      readStream.once('end', () => resolve());
      outputZip.addReadStream(readStream, entry.fileName, {
        compress: entry.compressionMethod !== 0,
        mtime: entry.getLastModDate(),
      });
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

async function filterNativePackageArchive(
  source: string,
  output: string,
  platform: Platform,
): Promise<{ bundles: number; entries: number }> {
  await fs.ensureDir(path.dirname(output));
  const scratchDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'rnu-native-package-entry-'),
  );
  const outputZip = new YazlZipFile();
  const writePromise = new Promise<void>((resolve, reject) => {
    outputZip.outputStream.once('error', reject);
    outputZip.outputStream
      .pipe(fs.createWriteStream(output))
      .once('error', reject)
      .once('close', () => resolve());
  });
  let includedEntries = 0;
  let includedBundles = 0;
  let nestedArchiveIndex = 0;

  try {
    await new Promise<void>((resolve, reject) => {
      openZipFile(source, { lazyEntries: true }, (openError, sourceZip) => {
        if (openError || !sourceZip) {
          reject(openError ?? new Error(`Unable to open zip file: ${source}`));
          return;
        }

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
              );
              if (nestedResult.entries > 0) {
                outputZip.addFile(nestedOutput, entry.fileName, {
                  compress: entry.compressionMethod !== 0,
                  mtime: entry.getLastModDate(),
                });
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
              await copyEntryToZip(sourceZip, entry, outputZip);
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
    });

    outputZip.end();
    await writePromise;
    return { bundles: includedBundles, entries: includedEntries };
  } catch (error) {
    outputZip.end();
    await writePromise.catch(() => {});
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
): Promise<void> {
  const result = await filterNativePackageArchive(source, output, platform);
  if (result.bundles === 0) {
    await fs.remove(output);
    throw new Error(`Bundle entry not found in native package: ${source}`);
  }
}
