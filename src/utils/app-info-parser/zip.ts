import { decodeNullUnicode } from './utils';
import path from 'path';

const Unzip = require('isomorphic-unzip');

import { enumZipEntries, readEntry } from '../zip-entries';

export class Zip {
  file: string;
  unzip: any;

  constructor(file: string) {
    if (typeof file !== 'string') {
      throw new Error('Param error: [file] must be file path in Node.');
    }
    this.file = path.resolve(file);
    this.unzip = new Unzip(this.file);
  }

  /**
   * get entries by regexps, the return format is: { <filename>: <Buffer|Blob> }
   * @param {Array} regexps // regexps for matching files
   * @param {String} type // return type, can be buffer or blob, default buffer
   */
  getEntries(
    regexps: Array<RegExp | string>,
    type: 'buffer' | 'blob' = 'buffer',
  ) {
    const decoded = regexps.map((regex) => decodeNullUnicode(regex));
    return new Promise<Record<string, Buffer | Blob>>((resolve, reject) => {
      this.unzip.getBuffer(
        decoded,
        { type },
        (err: Error | null, buffers: Record<string, Buffer | Blob>) => {
          err ? reject(err) : resolve(buffers);
        },
      );
    });
  }

  /**
   * get entry by regex, return an instance of Buffer or Blob
   * @param {Regex} regex // regex for matching file
   * @param {String} type // return type, can be buffer or blob, default buffer
   */
  getEntry(regex: RegExp | string, type: 'buffer' | 'blob' = 'buffer') {
    const decoded = decodeNullUnicode(regex);
    return new Promise<Buffer | Blob | undefined>((resolve, reject) => {
      this.unzip.getBuffer(
        [decoded],
        { type },
        (err: Error | null, buffers: Record<string, Buffer | Blob>) => {
          err ? reject(err) : resolve(buffers[decoded as any]);
        },
      );
    });
  }

  async getEntryFromHarmonyApp(regex: RegExp) {
    try {
      let originSource: Buffer | Blob | undefined;
      await enumZipEntries(this.file, (entry: any, zipFile: any) => {
        if (regex.test(entry.fileName)) {
          return readEntry(entry, zipFile).then(
            (value: Buffer | Blob | undefined) => {
              originSource = value;
            },
          );
        }
      });
      return originSource;
    } catch (error) {
      console.error('Error in getEntryFromHarmonyApp:', error);
    }
  }
}
