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
