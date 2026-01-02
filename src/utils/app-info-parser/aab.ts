import { spawn } from 'child_process';
import os from 'os';
import path from 'path';
import fs from 'fs-extra';
import { open as openZipFile } from 'yauzl';
import { t } from '../i18n';
import { ResourceFinder } from './resource-finder';
import { mapInfoResource } from './utils';
import { ManifestParser } from './xml-parser/manifest';
import { Zip } from './zip';

export class AabParser extends Zip {
  file: string | File;

  constructor(file: string | File) {
    super(file);
    this.file = file;
  }

  async extractApk(
    outputPath: string,
    {
      includeAllSplits,
      splits,
    }: { includeAllSplits?: boolean; splits?: string[] | null },
  ) {
    const normalizedSplits = Array.isArray(splits)
      ? splits.map((item) => item.trim()).filter(Boolean)
      : [];
    const modules = includeAllSplits
      ? null
      : Array.from(new Set(['base', ...normalizedSplits]));
    const modulesArgs = modules ? [`--modules=${modules.join(',')}`] : [];

    const runCommand = (
      command: string,
      args: string[],
      options: { stdio?: 'inherit'; env?: NodeJS.ProcessEnv } = {},
    ) =>
      new Promise<void>((resolve, reject) => {
        const inheritStdio = options.stdio === 'inherit';
        const child = spawn(command, args, {
          stdio: inheritStdio ? 'inherit' : ['ignore', 'pipe', 'pipe'],
          env: options.env,
        });
        let stderr = '';
        if (!inheritStdio) {
          child.stderr?.on('data', (chunk) => {
            stderr += chunk.toString();
          });
        }
        child.on('error', reject);
        child.on('close', (code) => {
          if (code === 0) {
            resolve();
            return;
          }
          reject(
            new Error(
              stderr.trim() || `Command failed: ${command} (code ${code})`,
            ),
          );
        });
      });

    // Create a temp file for the .apks output
    const tempDir = os.tmpdir();
    const tempApksPath = path.join(tempDir, `temp-${Date.now()}.apks`);

    const needsNpxDownload = async () => {
      try {
        await runCommand('npx', [
          '--no-install',
          'node-bundletool',
          '--version',
        ]);
        return false;
      } catch {
        return true;
      }
    };

    try {
      // 1. Build APKS (universal mode)
      // We assume bundletool is in the path.
      // User might need keystore to sign it properly but for simple extraction we stick to default debug key if possible or unsigned?
      // actually bundletool build-apks signs with debug key by default if no keystore provided.

      try {
        await runCommand('bundletool', [
          'build-apks',
          '--mode=universal',
          `--bundle=${this.file}`,
          `--output=${tempApksPath}`,
          '--overwrite',
          ...modulesArgs,
        ]);
      } catch (e) {
        // Fallback to npx node-bundletool if bundletool is not in PATH
        // We use -y to avoid interactive prompt for installation
        if (await needsNpxDownload()) {
          console.log(t('aabBundletoolDownloadHint'));
        }
        await runCommand(
          'npx',
          [
            '-y',
            'node-bundletool',
            'build-apks',
            '--mode=universal',
            `--bundle=${this.file}`,
            `--output=${tempApksPath}`,
            '--overwrite',
            ...modulesArgs,
          ],
          {
            stdio: 'inherit',
            env: {
              ...process.env,
              npm_config_progress: 'true',
            },
          },
        );
      }

      // 2. Extract universal.apk from the .apks (zip) file
      await new Promise<void>((resolve, reject) => {
        openZipFile(tempApksPath, { lazyEntries: true }, (err, zipfile) => {
          if (err || !zipfile) {
            reject(err || new Error(t('aabOpenApksFailed')));
            return;
          }

          let found = false;
          zipfile.readEntry();
          zipfile.on('entry', (entry) => {
            if (entry.fileName === 'universal.apk') {
              found = true;
              zipfile.openReadStream(entry, (err, readStream) => {
                if (err || !readStream) {
                  reject(err || new Error(t('aabReadUniversalApkFailed')));
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
            if (!found) reject(new Error(t('aabUniversalApkNotFound')));
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
        throw new Error(t('aabManifestNotFound'));
      }

      let apkInfo = this._parseManifest(manifestBuffer as Buffer);

      try {
        const resourceBuffer = await this.getEntry(ResourceName);
        if (resourceBuffer) {
          const resourceMap = this._parseResourceMap(resourceBuffer as Buffer);
          apkInfo = mapInfoResource(apkInfo, resourceMap);
        }
      } catch (e: any) {
        console.warn(t('aabParseResourcesWarning', { error: e?.message ?? e }));
      }

      return apkInfo;
    } catch (error: any) {
      throw new Error(t('aabParseFailed', { error: error.message ?? error }));
    }
  }
  /**
   * Parse manifest
   * @param {Buffer} buffer // manifest file's buffer
   */
  private _parseManifest(buffer: Buffer) {
    try {
      const parser = new ManifestParser(buffer, {
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
      throw new Error(t('aabParseManifestError', { error: e?.message ?? e }));
    }
  }

  /**
   * Parse resourceMap
   * @param {Buffer} buffer // resourceMap file's buffer
   */
  private _parseResourceMap(buffer: Buffer) {
    try {
      return new ResourceFinder().processResourceTable(buffer);
    } catch (e: any) {
      throw new Error(t('aabParseResourcesError', { error: e?.message ?? e }));
    }
  }
}

const escapeRegExp = (value: string) =>
  value.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
