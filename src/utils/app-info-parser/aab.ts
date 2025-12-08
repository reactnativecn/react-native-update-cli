import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import {
  type Entry,
  fromBuffer as openZipFromBuffer,
  open as openZipFile,
} from 'yauzl';
import { ZipFile as YazlZipFile } from 'yazl';
import Zip from './zip';

interface ExtractApkOptions {
  includeAllSplits?: boolean;
  splits?: string[] | null;
}

type BufferedEntry = {
  apkPath: string;
  buffer: Buffer;
  compress?: boolean;
};

type SplitEntry = {
  name: string;
  buffer: Buffer;
};

/**
 * 纯 JS 的 AAB 解析器，参考 https://github.com/accrescent/android-bundle
 * 将 base/ 内容重打包为一个通用 APK，并在需要时合并 split APK。
 * 生成的 APK 使用 AAB 中的 proto manifest/resources（不可用于安装，但可被本工具解析）。
 */
class AabParser extends Zip {
  file: string | File;

  constructor(file: string | File) {
    super(file);
    this.file = file;
  }

  /**
   * 从 AAB 提取 APK（不依赖 bundletool）
   */
  async extractApk(
    outputPath: string,
    options: ExtractApkOptions = {},
  ): Promise<string> {
    if (typeof this.file !== 'string') {
      throw new Error('AAB file path must be a string in Node.js environment');
    }

    const { includeAllSplits = false, splits = null } = options;
    const { baseEntries, splitEntries, metaInfEntries } =
      await this.collectBundleEntries();

    const entryMap = new Map<string, BufferedEntry>();
    for (const entry of baseEntries) {
      entryMap.set(entry.apkPath, entry);
    }
    for (const entry of metaInfEntries) {
      entryMap.set(entry.apkPath, entry);
    }

    const selectedSplits = this.pickSplits(splitEntries, includeAllSplits, splits);
    for (const split of selectedSplits) {
      await this.mergeSplitApk(entryMap, split.buffer);
    }

    await this.writeApk(entryMap, outputPath);
    return outputPath;
  }

  /**
   * 解析 AAB 文件信息（类似 APK parser 的 parse 方法）
   * 注意：AAB 中的 AndroidManifest.xml 在 base/manifest/AndroidManifest.xml
   */
  async parse() {
    const manifestPath = 'base/manifest/AndroidManifest.xml';
    const ResourceName = /^base\/resources\.arsc$/;

    try {
      const manifestBuffer = await this.getEntry(
        new RegExp(`^${escapeRegExp(manifestPath)}$`),
      );

      if (!manifestBuffer) {
        throw new Error(
          "AndroidManifest.xml can't be found in AAB base/manifest/",
        );
      }

      let apkInfo = this._parseManifest(manifestBuffer as Buffer);

      try {
        const resourceBuffer = await this.getEntry(ResourceName);
        if (resourceBuffer) {
          const resourceMap = this._parseResourceMap(resourceBuffer as Buffer);
          const { mapInfoResource } = require('./utils');
          apkInfo = mapInfoResource(apkInfo, resourceMap);
        }
      } catch (e: any) {
        console.warn(
          '[Warning] Failed to parse resources.arsc:',
          e?.message ?? e,
        );
      }

      return apkInfo;
    } catch (error: any) {
      throw new Error(`Failed to parse AAB: ${error.message ?? error}`);
    }
  }

  private pickSplits(
    splitEntries: SplitEntry[],
    includeAllSplits: boolean,
    splits: string[] | null,
  ) {
    if (splits && splits.length > 0) {
      return splitEntries.filter(({ name }) =>
        splits.some((s) => name.includes(s)),
      );
    }
    return includeAllSplits ? splitEntries : [];
  }

  private async writeApk(
    entries: Map<string, BufferedEntry>,
    outputPath: string,
  ) {
    await fs.ensureDir(path.dirname(outputPath));

    const zipFile = new YazlZipFile();
    for (const { apkPath, buffer, compress } of entries.values()) {
      zipFile.addBuffer(buffer, apkPath, {
        compress,
      });
    }

    await new Promise<void>((resolve, reject) => {
      zipFile.outputStream
        .pipe(fs.createWriteStream(outputPath))
        .on('close', resolve)
        .on('error', reject);
      zipFile.end();
    });
  }

  private async collectBundleEntries() {
    return new Promise<{
      baseEntries: BufferedEntry[];
      splitEntries: SplitEntry[];
      metaInfEntries: BufferedEntry[];
    }>((resolve, reject) => {
      openZipFile(this.file as string, { lazyEntries: true }, (err, zipfile) => {
        if (err || !zipfile) {
          reject(err ?? new Error('Failed to open AAB file'));
          return;
        }

        const baseEntries: BufferedEntry[] = [];
        const splitEntries: SplitEntry[] = [];
        const metaInfEntries: BufferedEntry[] = [];
        const promises: Promise<void>[] = [];

        const readNext = () => zipfile.readEntry();

        zipfile.on('entry', (entry: Entry) => {
          if (entry.fileName.endsWith('/')) {
            readNext();
            return;
          }

          const promise = this.readEntryBuffer(zipfile, entry)
            .then((buffer) => {
              if (entry.fileName.startsWith('base/')) {
                const apkPath = this.mapBasePath(entry.fileName);
                if (apkPath) {
                  baseEntries.push({
                    apkPath,
                    buffer,
                    compress: entry.compressionMethod !== 0,
                  });
                }
              } else if (
                (entry.fileName.startsWith('splits/') ||
                  entry.fileName.startsWith('split/')) &&
                entry.fileName.endsWith('.apk')
              ) {
                splitEntries.push({ name: entry.fileName, buffer });
              } else if (entry.fileName.startsWith('META-INF/')) {
                metaInfEntries.push({
                  apkPath: entry.fileName,
                  buffer,
                  compress: entry.compressionMethod !== 0,
                });
              }
            })
            .catch((error) => {
              zipfile.close();
              reject(error);
            })
            .finally(readNext);

          promises.push(promise);
        });

        zipfile.once('error', reject);
        zipfile.once('end', () => {
          Promise.all(promises)
            .then(() => resolve({ baseEntries, splitEntries, metaInfEntries }))
            .catch(reject);
        });

        readNext();
      });
    });
  }

  private mapBasePath(fileName: string) {
    const relative = fileName.replace(/^base\//, '');
    if (!relative) return null;

    if (relative === 'manifest/AndroidManifest.xml') {
      return 'androidmanifest.xml';
    }

    if (relative.startsWith('root/')) {
      return relative.replace(/^root\//, '');
    }

    if (relative === 'resources.pb') {
      return 'resources.pb';
    }

    if (relative === 'resources.arsc') {
      return 'resources.arsc';
    }

    return relative;
  }

  private async mergeSplitApk(
    entryMap: Map<string, BufferedEntry>,
    splitBuffer: Buffer,
  ) {
    await new Promise<void>((resolve, reject) => {
      openZipFromBuffer(splitBuffer, { lazyEntries: true }, (err, zipfile) => {
        if (err || !zipfile) {
          reject(err ?? new Error('Failed to open split APK'));
          return;
        }

        const readNext = () => zipfile.readEntry();
        zipfile.on('entry', (entry: Entry) => {
          if (entry.fileName.endsWith('/')) {
            readNext();
            return;
          }
          if (entry.fileName.startsWith('META-INF/')) {
            readNext();
            return;
          }

          this.readEntryBuffer(zipfile, entry)
            .then((buffer) => {
              entryMap.set(entry.fileName, {
                apkPath: entry.fileName,
                buffer,
                compress: entry.compressionMethod !== 0,
              });
            })
            .catch((error) => {
              zipfile.close();
              reject(error);
            })
            .finally(readNext);
        });

        zipfile.once('error', reject);
        zipfile.once('end', resolve);
        readNext();
      });
    });
  }

  private async readEntryBuffer(zipfile: any, entry: Entry): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      zipfile.openReadStream(entry, (err: any, readStream: any) => {
        if (err || !readStream) {
          reject(err ?? new Error('Failed to open entry stream'));
          return;
        }
        const chunks: Buffer[] = [];
        readStream.on('data', (chunk: Buffer) => chunks.push(chunk));
        readStream.on('end', () => resolve(Buffer.concat(chunks)));
        readStream.on('error', reject);
      });
    });
  }

  /**
   * Parse manifest
   * @param {Buffer} buffer // manifest file's buffer
   */
  private _parseManifest(buffer: Buffer) {
    try {
      const ManifestXmlParser = require('./xml-parser/manifest');
      const parser = new ManifestXmlParser(buffer, {
        ignore: [
          'application.activity',
          'application.service',
          'application.receiver',
          'application.provider',
          'permission-group',
        ],
      });
      return parser.parse();
    } catch (e: any) {
      throw new Error('Parse AndroidManifest.xml error: ' + e.message);
    }
  }

  /**
   * Parse resourceMap
   * @param {Buffer} buffer // resourceMap file's buffer
   */
  private _parseResourceMap(buffer: Buffer) {
    try {
      const ResourceFinder = require('./resource-finder');
      return new ResourceFinder().processResourceTable(buffer);
    } catch (e: any) {
      throw new Error('Parser resources.arsc error: ' + e.message);
    }
  }
}

const escapeRegExp = (value: string) =>
  value.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');

export = AabParser;
