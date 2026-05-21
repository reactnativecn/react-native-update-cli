const parseBplist = require('bplist-parser').parseBuffer;
const cgbiToPng = require('cgbi-to-png');

import { findIpaIconPath, getBase64FromBuffer, isBrowser } from './utils';
import { Zip } from './zip';

const PlistName = /payload\/[^/]+?.app\/info.plist$/i;
const ProvisionName = /payload\/.+?\.app\/embedded.mobileprovision/;

type ParsePlist = (content: string) => Record<string, any>;

let parsePlistPromise: Promise<ParsePlist> | undefined;

function loadParsePlist(): Promise<ParsePlist> {
  if (!parsePlistPromise) {
    parsePlistPromise = Promise.resolve().then(async () => {
      try {
        return require('plist').parse as ParsePlist;
      } catch (requireError) {
        const importModule = new Function(
          'specifier',
          'return import(specifier)',
        ) as (specifier: string) => Promise<{
          parse?: ParsePlist;
          default?: { parse?: ParsePlist };
        }>;
        const plistModule = await importModule('plist');
        const parsePlist = plistModule.parse ?? plistModule.default?.parse;
        if (!parsePlist) {
          throw requireError;
        }
        return parsePlist;
      }
    });
  }
  return parsePlistPromise;
}

export class IpaParser extends Zip {
  async parse(): Promise<any> {
    const parsePlist = await loadParsePlist();
    const buffers = await this.getEntries([PlistName, ProvisionName]);
    if (!buffers[PlistName as any]) {
      throw new Error("Info.plist can't be found.");
    }
    const plistInfo = this._parsePlist(
      buffers[PlistName as any] as Buffer,
      parsePlist,
    );
    const provisionInfo = this._parseProvision(
      buffers[ProvisionName as any] as Buffer | undefined,
      parsePlist,
    );
    plistInfo.mobileProvision = provisionInfo;

    const iconRegex = new RegExp(findIpaIconPath(plistInfo).toLowerCase());
    const iconBuffer = await this.getEntry(iconRegex);
    try {
      plistInfo.icon = iconBuffer
        ? getBase64FromBuffer(cgbiToPng.revert(iconBuffer))
        : null;
    } catch (err) {
      if (isBrowser()) {
        plistInfo.icon = iconBuffer
          ? getBase64FromBuffer(
              window.btoa(String.fromCharCode(...(iconBuffer as Buffer))),
            )
          : null;
      } else {
        plistInfo.icon = null;
        console.warn('[Warning] failed to parse icon: ', err);
      }
    }
    return plistInfo;
  }
  /**
   * Parse plist
   * @param {Buffer} buffer // plist file's buffer
   */
  private _parsePlist(buffer: Buffer, parsePlist: ParsePlist) {
    let result: any;
    const bufferType = buffer[0];
    if (bufferType === 60 || bufferType === 239) {
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
  private _parseProvision(buffer: Buffer | undefined, parsePlist: ParsePlist) {
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
