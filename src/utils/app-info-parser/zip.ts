import path from 'path';
import { decodeNullUnicode } from './utils';

const Unzip = require('isomorphic-unzip');

import { enumZipEntries, readEntry } from '../zip-entries';

export class Zip {
  file: string | File;
  unzip: any;

  constructor(file: string | File) {
    this.file = typeof file === 'string' ? path.resolve(file) : file;
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

  async getEntryFromHarmonyApp(
    regex: RegExp,
  ): Promise<Buffer | Blob | undefined> {
    try {
      let originSource: Buffer | Blob | undefined;
      if (typeof this.file !== 'string') {
        throw new Error('Param error: [file] must be file path in Node.');
      }
      await enumZipEntries(this.file, async (entry, zipFile) => {
        if (regex.test(entry.fileName)) {
          originSource = await readEntry(entry, zipFile);
        }
      });
      return originSource;
    } catch (error) {
      console.error('Error in getEntryFromHarmonyApp:', error);
    }
  }
}
