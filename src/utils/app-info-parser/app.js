const Zip = require('./zip')

class AppParser extends Zip {
  /**
   * parser for parsing .apk file
   * @param {String | File | Blob} file // file's path in Node, instance of File or Blob in Browser
   */
  constructor (file) {
    super(file)
    if (!(this instanceof AppParser)) {
      return new AppParser(file)
    }
  }
}

module.exports = AppParser
