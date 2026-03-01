import { AabParser } from './aab';
import { ApkParser } from './apk';
import { AppParser } from './app';
import { IpaParser } from './ipa';

const supportFileTypes = ['ipa', 'apk', 'app', 'aab'] as const;
type SupportedFileType = (typeof supportFileTypes)[number];
type AppInfoInnerParser = AabParser | ApkParser | AppParser | IpaParser;

class AppInfoParser {
  file: string | File;
  parser: AppInfoInnerParser;
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
    if (!supportFileTypes.includes(fileType as SupportedFileType)) {
      throw new Error(
        'Unsupported file type, only support .ipa, .apk, .app, or .aab file.',
      );
    }
    this.file = file;

    switch (fileType as SupportedFileType) {
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
      default:
        throw new Error('Unsupported parser file type.');
    }
  }
  parse<T = unknown>(): Promise<T> {
    return this.parser.parse() as Promise<T>;
  }
}

export default AppInfoParser;
