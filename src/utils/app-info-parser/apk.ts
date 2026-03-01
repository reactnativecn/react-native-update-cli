import { ResourceFinder } from './resource-finder';
import { findApkIconPath, getBase64FromBuffer, mapInfoResource } from './utils';
import { ManifestParser } from './xml-parser/manifest';
import { Zip } from './zip';

const ManifestName = /^androidmanifest\.xml$/;
const ResourceName = /^resources\.arsc$/;

export class ApkParser extends Zip {
  parse(): Promise<any> {
    const manifestKey = ManifestName.toString();
    const resourceKey = ResourceName.toString();

    return new Promise((resolve, reject) => {
      this.getEntries([ManifestName, ResourceName])
        .then((buffers: Record<string, Buffer | Blob | undefined>) => {
          const manifestBuffer = buffers[manifestKey];
          if (!manifestBuffer) {
            throw new Error("AndroidManifest.xml can't be found.");
          }
          let apkInfo: any;
          let resourceMap: any;

          apkInfo = this._parseManifest(manifestBuffer as Buffer);

          if (!buffers[resourceKey]) {
            resolve(apkInfo);
          } else {
            resourceMap = this._parseResourceMap(
              buffers[resourceKey] as Buffer,
            );
            apkInfo = mapInfoResource(apkInfo, resourceMap);

            const iconPath = findApkIconPath(apkInfo);
            if (iconPath) {
              this.getEntry(iconPath)
                .then((iconBuffer: Buffer | Blob | undefined) => {
                  apkInfo.icon = Buffer.isBuffer(iconBuffer)
                    ? getBase64FromBuffer(iconBuffer)
                    : null;
                  resolve(apkInfo);
                })
                .catch((e: any) => {
                  apkInfo.icon = null;
                  resolve(apkInfo);
                  console.warn('[Warning] failed to parse icon: ', e);
                });
            } else {
              apkInfo.icon = null;
              resolve(apkInfo);
            }
          }
        })
        .catch((e: any) => {
          reject(e);
        });
    });
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
      throw new Error(`Parse AndroidManifest.xml error: ${e.message || e}`);
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
      throw new Error(`Parser resources.arsc error: ${e}`);
    }
  }
}
