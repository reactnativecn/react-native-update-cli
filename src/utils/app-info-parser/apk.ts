import { findApkIconPath, getBase64FromBuffer, mapInfoResource } from './utils';
import { Zip } from './zip';

const ManifestName = /^androidmanifest\.xml$/;
const ResourceName = /^resources\.arsc$/;

const ManifestXmlParser = require('./xml-parser/manifest');
const ResourceFinder = require('./resource-finder');

export class ApkParser extends Zip {
  parse(): Promise<any> {
    return new Promise((resolve, reject) => {
      this.getEntries([ManifestName, ResourceName])
        .then((buffers: any) => {
          const manifestBuffer = buffers[ManifestName];
          if (!manifestBuffer) {
            throw new Error("AndroidManifest.xml can't be found.");
          }
          let apkInfo: any;
          let resourceMap: any;

          apkInfo = this._parseManifest(manifestBuffer as Buffer);

          if (!buffers[ResourceName]) {
            resolve(apkInfo);
          } else {
            resourceMap = this._parseResourceMap(
              buffers[ResourceName] as Buffer,
            );
            apkInfo = mapInfoResource(apkInfo, resourceMap);

            const iconPath = findApkIconPath(apkInfo);
            if (iconPath) {
              this.getEntry(iconPath)
                .then((iconBuffer: Buffer | null) => {
                  apkInfo.icon = iconBuffer
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
