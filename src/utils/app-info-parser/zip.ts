import path from 'path';
import { enumZipEntries, readEntry } from '../zip-entries';
import { decodeNullUnicode } from './utils';

export class Zip {
  file: string | File;

  constructor(file: string | File) {
    this.file = typeof file === 'string' ? path.resolve(file) : file;
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
    return this.readEntries(decoded, type);
  }

  /**
   * get entry by regex, return an instance of Buffer or Blob
   * @param {Regex} regex // regex for matching file
   * @param {String} type // return type, can be buffer or blob, default buffer
   */
  getEntry(regex: RegExp | string, type: 'buffer' | 'blob' = 'buffer') {
    const decoded = decodeNullUnicode(regex);
    return this.readEntries([decoded], type).then(
      (buffers) => buffers[decoded as any],
    );
  }

  async getEntryFromHarmonyApp(
    regex: RegExp,
  ): Promise<Buffer | Blob | undefined> {
    return (await this.getEntriesFromHarmonyApp([regex]))[0];
  }

  /**
   * Read multiple entries in a single pass over the archive (including
   * nested .hap extraction), instead of one full scan per entry.
   * Returns buffers in the same order as the given regexps.
   */
  async getEntriesFromHarmonyApp(
    regexps: RegExp[],
  ): Promise<(Buffer | undefined)[]> {
    const results: (Buffer | undefined)[] = new Array(regexps.length);
    try {
      if (typeof this.file !== 'string') {
        throw new Error('Param error: [file] must be file path in Node.');
      }
      await enumZipEntries(this.file, async (entry, zipFile) => {
        for (let i = 0; i < regexps.length; i++) {
          if (regexps[i].test(entry.fileName)) {
            results[i] = await readEntry(entry, zipFile);
          }
        }
      });
    } catch (error) {
      console.error('Error in getEntriesFromHarmonyApp:', error);
    }
    return results;
  }

  private async readEntries(
    decoded: Array<RegExp | string>,
    type: 'buffer' | 'blob',
  ): Promise<Record<string, Buffer | Blob>> {
    if (typeof this.file !== 'string') {
      throw new Error('Param error: [file] must be file path in Node.');
    }

    const buffers: Record<string, Buffer | Blob> = {};
    await enumZipEntries(this.file, async (entry, zipFile) => {
      if (entry.fileName.endsWith('/')) {
        return;
      }

      const entryName = decodeNullUnicode(entry.fileName).toString();
      const lowerEntryName = entryName.toLowerCase();
      const matched = decoded.find((pattern) => {
        if (typeof pattern === 'string') {
          return pattern === entryName || pattern === lowerEntryName;
        }
        pattern.lastIndex = 0;
        if (pattern.test(entryName)) {
          return true;
        }
        pattern.lastIndex = 0;
        return pattern.test(lowerEntryName);
      });

      if (!matched) {
        return;
      }

      const buffer = await readEntry(entry, zipFile);
      buffers[matched as any] =
        type === 'blob' ? new Blob([buffer as any]) : buffer;
    });

    return buffers;
  }
}
