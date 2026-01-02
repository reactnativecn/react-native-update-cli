import { ApkParser } from './apk';
const IpaParser = require('./ipa');
import { AppParser } from './app';
import { AabParser } from './aab';
const supportFileTypes = ['ipa', 'apk', 'app', 'aab'];

class AppInfoParser {
  file: string | File;
  parser: any;
  /**
   * parser for parsing .ipa or .apk file
   * @param {String | File} file // file's path in Node, instance of File in Browser
   */
  constructor(file: string | File) {
    if (!file) {
      throw new Error(
        "Param miss: file(file's path in Node, instance of File in browser).",
      );
    }
    const splits = (typeof file === 'string' ? file : file.name).split('.');
    const fileType = splits[splits.length - 1].toLowerCase();
    if (!supportFileTypes.includes(fileType)) {
      throw new Error(
        'Unsupported file type, only support .ipa, .apk, .app, or .aab file.',
      );
    }
    this.file = file;

    switch (fileType) {
      case 'ipa':
        this.parser = new IpaParser(this.file);
        break;
      case 'apk':
        this.parser = new ApkParser(this.file);
        break;
      case 'app':
        this.parser = new AppParser(this.file);
        break;
      case 'aab':
        this.parser = new AabParser(this.file);
        break;
    }
  }
  parse() {
    return this.parser.parse();
  }
}

export default AppInfoParser;
