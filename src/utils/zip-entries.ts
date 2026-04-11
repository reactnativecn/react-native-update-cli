import os from 'os';
import path from 'path';
import * as fs from 'fs-extra';
import {
  type Entry,
  type ZipFile as YauzlZipFile,
  open as openZipFile,
} from 'yauzl';
import { t } from './i18n';

export function readEntry(
  entry: Entry,
  zipFile: YauzlZipFile,
): Promise<Buffer> {
  const buffers: Buffer[] = [];
  return new Promise((resolve, reject) => {
    zipFile.openReadStream(entry, (err, stream) => {
      if (err) {
        return reject(err);
      }
      if (!stream) {
        return reject(new Error(`Unable to read zip entry: ${entry.fileName}`));
      }
      stream.on('data', (chunk: Buffer) => {
        buffers.push(chunk);
      });
      stream.on('end', () => {
        resolve(Buffer.concat(buffers));
      });
      stream.on('error', (err) => {
        reject(err);
      });
    });
  });
}

export function readEntryPrefix(
  entry: Entry,
  zipFile: YauzlZipFile,
  maxBytes: number,
): Promise<Buffer> {
  if (maxBytes <= 0) {
    return Promise.resolve(Buffer.alloc(0));
  }

  const buffers: Buffer[] = [];
  let length = 0;

  return new Promise((resolve, reject) => {
    zipFile.openReadStream(entry, (err, stream) => {
      if (err) {
        return reject(err);
      }
      if (!stream) {
        return reject(new Error(`Unable to read zip entry: ${entry.fileName}`));
      }

      let settled = false;
      const cleanup = () => {
        stream.off('data', onData);
        stream.off('end', onEnd);
        stream.off('error', onError);
      };
      const finish = () => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolve(Buffer.concat(buffers, length));
      };
      const onData = (chunk: Buffer) => {
        const remaining = maxBytes - length;
        if (remaining <= 0) {
          finish();
          stream.destroy();
          return;
        }

        const slice =
          chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
        buffers.push(slice);
        length += slice.length;
        if (length >= maxBytes) {
          finish();
          stream.destroy();
        }
      };
      const onEnd = () => finish();
      const onError = (error: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(error);
      };

      stream.on('data', onData);
      stream.once('end', onEnd);
      stream.once('error', onError);
    });
  });
}

export async function enumZipEntries(
  zipFn: string,
  callback: (
    entry: Entry,
    zipFile: YauzlZipFile,
    nestedPath?: string,
  ) => Promise<any> | undefined,
  nestedPath = '',
) {
  return new Promise((resolve, reject) => {
    openZipFile(
      zipFn,
      { lazyEntries: true },
      async (err: any, zipfile: YauzlZipFile) => {
        if (err) {
          return reject(err);
        }

        zipfile.on('end', resolve);
        zipfile.on('error', reject);
        zipfile.on('entry', async (entry) => {
          const fullPath = nestedPath + entry.fileName;

          try {
            if (
              !entry.fileName.endsWith('/') &&
              entry.fileName.toLowerCase().endsWith('.hap')
            ) {
              const tempDir = path.join(
                os.tmpdir(),
                `nested_zip_${Date.now()}`,
              );
              await fs.ensureDir(tempDir);
              const tempZipPath = path.join(tempDir, 'temp.zip');

              await new Promise((res, rej) => {
                zipfile.openReadStream(entry, async (err, readStream) => {
                  if (err) return rej(err);
                  const writeStream = fs.createWriteStream(tempZipPath);
                  readStream.pipe(writeStream);
                  writeStream.on('finish', () => res(void 0));
                  writeStream.on('error', rej);
                });
              });

              await enumZipEntries(tempZipPath, callback, `${fullPath}/`);

              await fs.remove(tempDir);
            }

            const result = callback(entry, zipfile, fullPath);
            if (result && typeof result.then === 'function') {
              await result;
            }
          } catch (error) {
            console.error(t('processingError', { error }));
          }

          zipfile.readEntry();
        });

        zipfile.readEntry();
      },
    );
  });
}
