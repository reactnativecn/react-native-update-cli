const parsePlist = require('plist').parse;
const parseBplist = require('bplist-parser').parseBuffer;
const cgbiToPng = require('cgbi-to-png');

import { findIpaIconPath, getBase64FromBuffer, isBrowser } from './utils';
import { Zip } from './zip';

const PlistName = /payload\/[^\/]+?.app\/info.plist$/i;
const ProvisionName = /payload\/.+?\.app\/embedded.mobileprovision/;

export class IpaParser extends Zip {
  parse(): Promise<any> {
    return new Promise((resolve, reject) => {
      this.getEntries([PlistName, ProvisionName])
        .then((buffers: any) => {
          if (!buffers[PlistName as any]) {
            throw new Error("Info.plist can't be found.");
          }
          const plistInfo = this._parsePlist(buffers[PlistName as any]);
          const provisionInfo = this._parseProvision(
            buffers[ProvisionName as any],
          );
          plistInfo.mobileProvision = provisionInfo;

          const iconRegex = new RegExp(
            findIpaIconPath(plistInfo).toLowerCase(),
          );
          this.getEntry(iconRegex)
            .then((iconBuffer: any) => {
              try {
                plistInfo.icon = iconBuffer
                  ? getBase64FromBuffer(cgbiToPng.revert(iconBuffer))
                  : null;
              } catch (err) {
                if (isBrowser()) {
                  plistInfo.icon = iconBuffer
                    ? getBase64FromBuffer(
                        window.btoa(String.fromCharCode(...iconBuffer)),
                      )
                    : null;
                } else {
                  plistInfo.icon = null;
                  console.warn('[Warning] failed to parse icon: ', err);
                }
              }
              resolve(plistInfo);
            })
            .catch((e: any) => {
              reject(e);
            });
        })
        .catch((e: any) => {
          reject(e);
        });
    });
  }
  /**
   * Parse plist
   * @param {Buffer} buffer // plist file's buffer
   */
  private _parsePlist(buffer: Buffer) {
    let result: any;
    const bufferType = buffer[0];
    if (bufferType === 60 || bufferType === '<' || bufferType === 239) {
      result = parsePlist(buffer.toString());
    } else if (bufferType === 98) {
      result = parseBplist(buffer)[0];
    } else {
      throw new Error('Unknown plist buffer type.');
    }
    return result;
  }
  /**
   * parse provision
   * @param {Buffer} buffer // provision file's buffer
   */
  private _parseProvision(buffer: Buffer | undefined) {
    let info: Record<string, any> = {};
    if (buffer) {
      let content = buffer.toString('utf-8');
      const firstIndex = content.indexOf('<?xml');
      const endIndex = content.indexOf('</plist>');
      content = content.slice(firstIndex, endIndex + 8);
      if (content) {
        info = parsePlist(content);
      }
    }
    return info;
  }
}
