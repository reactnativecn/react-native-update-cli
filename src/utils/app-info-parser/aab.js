const Zip = require('./zip');
const yazl = require('yazl');
const fs = require('fs-extra');
const path = require('path');
const { open: openZipFile } = require('yauzl');
const os = require('os');

class AabParser extends Zip {
  /**
   * parser for parsing .aab file
   * @param {String | File | Blob} file // file's path in Node, instance of File or Blob in Browser
   */
  constructor(file) {
    super(file);
    if (!(this instanceof AabParser)) {
      return new AabParser(file);
    }
  }

  /**
   * 从 AAB 提取通用 APK
   * 这个方法会合并 base/ 和所有 split/ 目录的内容
   *
   * @param {String} outputPath - 输出 APK 文件路径
   * @param {Object} options - 选项
   * @param {Boolean} options.includeAllSplits - 是否包含所有 split APK（默认 false，只提取 base）
   * @param {Array<String>} options.splits - 指定要包含的 split APK 名称（如果指定，则只包含这些）
   * @returns {Promise<String>} 返回输出文件路径
   */
  async extractApk(outputPath, options = {}) {
    const { includeAllSplits = false, splits = null } = options;

    return new Promise((resolve, reject) => {
      if (typeof this.file !== 'string') {
        return reject(
          new Error('AAB file path must be a string in Node.js environment'),
        );
      }

      openZipFile(this.file, { lazyEntries: true }, async (err, zipfile) => {
        if (err) {
          return reject(err);
        }

        try {
          // 1. 收集所有条目及其数据
          const baseEntries = [];
          const splitEntries = [];
          const metaInfEntries = [];
          let pendingReads = 0;
          let hasError = false;

          const processEntry = (entry, fileName) => {
            return new Promise((resolve, reject) => {
              zipfile.openReadStream(entry, (err, readStream) => {
                if (err) {
                  return reject(err);
                }

                const chunks = [];
                readStream.on('data', (chunk) => chunks.push(chunk));
                readStream.on('end', () => {
                  const buffer = Buffer.concat(chunks);
                  resolve(buffer);
                });
                readStream.on('error', reject);
              });
            });
          };

          zipfile.on('entry', async (entry) => {
            const fileName = entry.fileName;

            // 跳过目录
            if (fileName.endsWith('/')) {
              zipfile.readEntry();
              return;
            }

            pendingReads++;
            try {
              const buffer = await processEntry(entry, fileName);

              if (fileName.startsWith('base/')) {
                // 将 base/manifest/AndroidManifest.xml 转换为 androidmanifest.xml（APK 中通常是小写）
                // 将 base/resources.arsc 转换为 resources.arsc
                let apkPath = fileName.replace(/^base\//, '');
                if (apkPath === 'manifest/AndroidManifest.xml') {
                  apkPath = 'androidmanifest.xml';
                }

                baseEntries.push({
                  buffer,
                  zipPath: fileName,
                  apkPath,
                });
              } else if (fileName.startsWith('split/')) {
                splitEntries.push({
                  buffer,
                  zipPath: fileName,
                });
              } else if (fileName.startsWith('META-INF/')) {
                metaInfEntries.push({
                  buffer,
                  zipPath: fileName,
                  apkPath: fileName,
                });
              }
              // BundleConfig.pb 和其他文件不需要包含在 APK 中

              pendingReads--;
              zipfile.readEntry();
            } catch (error) {
              pendingReads--;
              if (!hasError) {
                hasError = true;
                reject(error);
              }
              zipfile.readEntry();
            }
          });

          zipfile.on('end', async () => {
            // 等待所有读取完成
            while (pendingReads > 0) {
              await new Promise((resolve) => setTimeout(resolve, 10));
            }

            if (hasError) {
              return;
            }

            try {
              // 2. 创建新的 APK 文件
              const zipFile = new yazl.ZipFile();

              // 3. 添加 base 目录的所有文件
              for (const { buffer, apkPath } of baseEntries) {
                zipFile.addBuffer(buffer, apkPath);
              }

              // 4. 添加 split APK 的内容（如果需要）
              if (includeAllSplits || splits) {
                const splitsToInclude = splits
                  ? splitEntries.filter((se) =>
                      splits.some((s) => se.zipPath.includes(s)),
                    )
                  : splitEntries;

                await this.mergeSplitApksFromBuffers(zipFile, splitsToInclude);
              }

              // 5. 添加 META-INF（签名信息，虽然可能无效，但保留结构）
              for (const { buffer, apkPath } of metaInfEntries) {
                zipFile.addBuffer(buffer, apkPath);
              }

              // 6. 写入文件
              zipFile.outputStream
                .pipe(fs.createWriteStream(outputPath))
                .on('close', () => {
                  resolve(outputPath);
                })
                .on('error', (err) => {
                  reject(err);
                });

              zipFile.end();
            } catch (error) {
              reject(error);
            }
          });

          zipfile.on('error', reject);
          zipfile.readEntry();
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  /**
   * 合并 split APK 的内容（从已读取的 buffer）
   */
  async mergeSplitApksFromBuffers(zipFile, splitEntries) {
    for (const { buffer: splitBuffer } of splitEntries) {
      if (splitBuffer) {
        // 创建一个临时的 ZIP 文件来读取 split APK
        const tempSplitPath = path.join(
          os.tmpdir(),
          `split_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.apk`,
        );

        try {
          await fs.writeFile(tempSplitPath, splitBuffer);

          await new Promise((resolve, reject) => {
            openZipFile(
              tempSplitPath,
              { lazyEntries: true },
              async (err, splitZipfile) => {
                if (err) {
                  return reject(err);
                }

                splitZipfile.on('entry', (splitEntry) => {
                  // 跳过 META-INF，因为签名信息不需要合并
                  if (splitEntry.fileName.startsWith('META-INF/')) {
                    splitZipfile.readEntry();
                    return;
                  }

                  splitZipfile.openReadStream(splitEntry, (err, readStream) => {
                    if (err) {
                      splitZipfile.readEntry();
                      return;
                    }

                    const chunks = [];
                    readStream.on('data', (chunk) => chunks.push(chunk));
                    readStream.on('end', () => {
                      const buffer = Buffer.concat(chunks);
                      // 注意：如果文件已存在（在 base 中），split 中的会覆盖 base 中的
                      zipFile.addBuffer(buffer, splitEntry.fileName);
                      splitZipfile.readEntry();
                    });
                    readStream.on('error', () => {
                      splitZipfile.readEntry();
                    });
                  });
                });

                splitZipfile.on('end', resolve);
                splitZipfile.on('error', reject);
                splitZipfile.readEntry();
              },
            );
          });
        } finally {
          // 清理临时文件
          await fs.remove(tempSplitPath).catch(() => {});
        }
      }
    }
  }

  /**
   * 解析 AAB 文件信息（类似 APK parser 的 parse 方法）
   * 注意：AAB 中的 AndroidManifest.xml 在 base/manifest/AndroidManifest.xml
   */
  async parse() {
    // 尝试从 base/manifest/AndroidManifest.xml 读取 manifest
    // 但 AAB 中的 manifest 可能是二进制格式，需要特殊处理
    const manifestPath = 'base/manifest/AndroidManifest.xml';
    const ResourceName = /^base\/resources\.arsc$/;

    try {
      const manifestBuffer = await this.getEntry(
        new RegExp(`^${manifestPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`),
      );

      if (!manifestBuffer) {
        throw new Error(
          "AndroidManifest.xml can't be found in AAB base/manifest/",
        );
      }

      let apkInfo = this._parseManifest(manifestBuffer);

      // 尝试解析 resources.arsc
      try {
        const resourceBuffer = await this.getEntry(ResourceName);
        if (resourceBuffer) {
          const resourceMap = this._parseResourceMap(resourceBuffer);
          const { mapInfoResource } = require('./utils');
          apkInfo = mapInfoResource(apkInfo, resourceMap);
        }
      } catch (e) {
        // resources.arsc 解析失败不影响基本信息
        console.warn('[Warning] Failed to parse resources.arsc:', e.message);
      }

      return apkInfo;
    } catch (error) {
      throw new Error(`Failed to parse AAB: ${error.message}`);
    }
  }

  /**
   * Parse manifest
   * @param {Buffer} buffer // manifest file's buffer
   */
  _parseManifest(buffer) {
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
    } catch (e) {
      throw new Error('Parse AndroidManifest.xml error: ' + e.message);
    }
  }

  /**
   * Parse resourceMap
   * @param {Buffer} buffer // resourceMap file's buffer
   */
  _parseResourceMap(buffer) {
    try {
      const ResourceFinder = require('./resource-finder');
      return new ResourceFinder().processResourceTable(buffer);
    } catch (e) {
      throw new Error('Parser resources.arsc error: ' + e.message);
    }
  }
}

module.exports = AabParser;
