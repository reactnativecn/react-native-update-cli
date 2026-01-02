import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import {
  open as openZipFile,
} from 'yauzl';
import Zip from './zip';

class AabParser extends Zip {
  file: string | File;

  constructor(file: string | File) {
    super(file);
    this.file = file;
  }

  /**
   * 从 AAB 提取 APK（不依赖 bundletool）
   */
  async extractApk(outputPath: string) {
    const { exec } = require('child_process');
    const util = require('util');
    const execAsync = util.promisify(exec);

    // Create a temp file for the .apks output
    const tempDir = os.tmpdir();
    const tempApksPath = path.join(tempDir, `temp-${Date.now()}.apks`);

    try {
      // 1. Build APKS (universal mode)
      // We assume bundletool is in the path.
      // User might need keystore to sign it properly but for simple extraction we stick to default debug key if possible or unsigned?
      // actually bundletool build-apks signs with debug key by default if no keystore provided.

      let cmd = `bundletool build-apks --mode=universal --bundle="${this.file}" --output="${tempApksPath}" --overwrite`;
      try {
        await execAsync(cmd);
      } catch (e) {
        // Fallback to npx node-bundletool if bundletool is not in PATH
        // We use -y to avoid interactive prompt for installation
        cmd = `npx -y node-bundletool build-apks --mode=universal --bundle="${this.file}" --output="${tempApksPath}" --overwrite`;
        await execAsync(cmd);
      }

      // 2. Extract universal.apk from the .apks (zip) file
      await new Promise<void>((resolve, reject) => {
        openZipFile(tempApksPath, { lazyEntries: true }, (err, zipfile) => {
          if (err || !zipfile) {
            reject(err || new Error('Failed to open generated .apks file'));
            return;
          }

          let found = false;
          zipfile.readEntry();
          zipfile.on('entry', (entry) => {
            if (entry.fileName === 'universal.apk') {
              found = true;
              zipfile.openReadStream(entry, (err, readStream) => {
                if (err || !readStream) {
                  reject(err || new Error('Failed to read universal.apk'));
                  return;
                }
                const writeStream = fs.createWriteStream(outputPath);
                readStream.pipe(writeStream);
                writeStream.on('close', () => {
                  zipfile.close();
                  resolve();
                });
                writeStream.on('error', reject);
              });
            } else {
              zipfile.readEntry();
            }
          });

          zipfile.on('end', () => {
            if (!found)
              reject(new Error('universal.apk not found in generated .apks'));
          });
          zipfile.on('error', reject);
        });
      });
    } finally {
      // Cleanup
      if (await fs.pathExists(tempApksPath)) {
        await fs.remove(tempApksPath);
      }
    }
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
      throw new Error(`Parse AndroidManifest.xml error: ${e.message}`);
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
      throw new Error(`Parser resources.arsc error: ${e.message}`);
    }
  }
}

const escapeRegExp = (value: string) =>
  value.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');

export = AabParser;
