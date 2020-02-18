'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.getIpaInfo = exports.getApkInfo = undefined;

let getApkInfo = exports.getApkInfo = function () {
  var _ref = _asyncToGenerator(function* (fn) {
    const appInfoParser = new AppInfoParser(fn);

    var _ref2 = yield appInfoParser.parse();

    const versionName = _ref2.versionName,
          application = _ref2.application;

    let buildTime = 0;
    if (Array.isArray(application.metaData)) {
      for (const meta of application.metaData) {
        if (meta.name === 'pushy_build_time') {
          buildTime = meta.value[0];
        }
      }
    }
    if (buildTime == 0) {
      throw new Error('Can not get build time for this app.');
    }
    return { versionName, buildTime };
  });

  return function getApkInfo(_x) {
    return _ref.apply(this, arguments);
  };
}();

let getIpaInfo = exports.getIpaInfo = function () {
  var _ref3 = _asyncToGenerator(function* (fn) {
    const appInfoParser = new AppInfoParser(fn);

    var _ref4 = yield appInfoParser.parse();

    const versionName = _ref4.CFBundleShortVersionString;

    let buildTimeTxtBuffer = yield appInfoParser.parser.getEntry(/payload\/.+?\.app\/pushy_build_time.txt/);
    if (!buildTimeTxtBuffer) {
      // Not in root bundle when use `use_frameworks`
      buildTimeTxtBuffer = yield appInfoParser.parser.getEntry(/payload\/.+?\.app\/frameworks\/react_native_update.framework\/pushy_build_time.txt/);
    }
    if (!buildTimeTxtBuffer) {
      throw new Error('Can not get build time for this app.');
    }
    const buildTime = buildTimeTxtBuffer.toString().replace('\n', '');
    return { versionName, buildTime };
  });

  return function getIpaInfo(_x2) {
    return _ref3.apply(this, arguments);
  };
}();

exports.question = question;
exports.translateOptions = translateOptions;
exports.getRNVersion = getRNVersion;

var _path = require('path');

var path = _interopRequireWildcard(_path);

var _fsExtra = require('fs-extra');

var fs = _interopRequireWildcard(_fsExtra);

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) newObj[key] = obj[key]; } } newObj.default = obj; return newObj; } }

function _asyncToGenerator(fn) { return function () { var gen = fn.apply(this, arguments); return new Promise(function (resolve, reject) { function step(key, arg) { try { var info = gen[key](arg); var value = info.value; } catch (error) { reject(error); return; } if (info.done) { resolve(value); } else { return Promise.resolve(value).then(function (value) { step("next", value); }, function (err) { step("throw", err); }); } } return step("next"); }); }; } /**
                                                                                                                                                                                                                                                                                                                                                                                                                                                                            * Created by tdzl2003 on 2/13/16.
                                                                                                                                                                                                                                                                                                                                                                                                                                                                            */

const AppInfoParser = require('app-info-parser');

var read = require('read');

function question(query, password) {
  if (NO_INTERACTIVE) {
    return Promise.resolve('');
  }
  return new Promise(function (resolve, reject) {
    return read({
      prompt: query,
      silent: password,
      replace: password ? '*' : undefined
    }, function (err, result) {
      return err ? reject(err) : resolve(result);
    });
  });
}

function translateOptions(options) {
  const ret = {};
  for (let key in options) {
    const v = options[key];
    if (typeof v === 'string') {
      ret[key] = v.replace(/\$\{(\w+)\}/g, function (v, n) {
        return options[n] || process.env[n] || v;
      });
    } else {
      ret[key] = v;
    }
  }
  return ret;
}

function getRNVersion() {
  const version = JSON.parse(fs.readFileSync(path.resolve('node_modules/react-native/package.json'))).version;

  // We only care about major and minor version.
  const match = /^(\d+)\.(\d+)\./.exec(version);
  return {
    version,
    major: match[1] | 0,
    minor: match[2] | 0
  };
}