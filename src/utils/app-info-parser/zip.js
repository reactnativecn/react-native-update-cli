const Unzip = require('isomorphic-unzip');
const { isBrowser, decodeNullUnicode } = require('./utils');
const { enumZipEntries, readEntry } = require('../../bundle');

class Zip {
  constructor(file) {
    if (isBrowser()) {
      if (!(file instanceof window.Blob || typeof file.size !== 'undefined')) {
        throw new Error(
          'Param error: [file] must be an instance of Blob or File in browser.',
        );
      }
      this.file = file;
    } else {
      if (typeof file !== 'string') {
        throw new Error('Param error: [file] must be file path in Node.');
      }
      this.file = require('path').resolve(file);
    }
    this.unzip = new Unzip(this.file);
  }

  /**
   * get entries by regexps, the return format is: { <filename>: <Buffer|Blob> }
   * @param {Array} regexps // regexps for matching files
   * @param {String} type // return type, can be buffer or blob, default buffer
   */
  getEntries(regexps, type = 'buffer') {
    regexps = regexps.map((regex) => decodeNullUnicode(regex));
    return new Promise((resolve, reject) => {
      this.unzip.getBuffer(regexps, { type }, (err, buffers) => {
        err ? reject(err) : resolve(buffers);
      });
    });
  }
  /**
   * get entry by regex, return an instance of Buffer or Blob
   * @param {Regex} regex // regex for matching file
   * @param {String} type // return type, can be buffer or blob, default buffer
   */
  getEntry(regex, type = 'buffer') {
    regex = decodeNullUnicode(regex);
    return new Promise((resolve, reject) => {
      this.unzip.getBuffer([regex], { type }, (err, buffers) => {
        // console.log(buffers);
        err ? reject(err) : resolve(buffers[regex]);
      });
    });
  }

  async getEntryFromHarmonyApp(regex) {
    try {
      let originSource;
      await enumZipEntries(this.file, (entry, zipFile) => {
        if (regex.test(entry.fileName)) {
          return readEntry(entry, zipFile).then((v) => (originSource = v));
        }
      });
      return originSource;
    } catch (error) {
      console.error('Error in getEntryFromHarmonyApp:', error);
    }
  }
}

module.exports = Zip;
