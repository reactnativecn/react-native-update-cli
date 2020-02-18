'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.commands = exports.choosePackage = exports.listPackage = undefined;

let listPackage = exports.listPackage = function () {
  var _ref = _asyncToGenerator(function* (appId) {
    var _ref2 = yield get(`/app/${appId}/package/list?limit=1000`);

    const data = _ref2.data;


    const header = [{ value: 'Package Id' }, { value: 'Version' }];
    const rows = [];
    for (const pkg of data) {
      const version = pkg.version;

      let versionInfo = '';
      if (version) {
        versionInfo = ` - ${version.id} ${version.hash.slice(0, 8)} ${version.name}`;
      } else {
        versionInfo = ' (newest)';
      }

      rows.push([pkg.id, `${pkg.name}(${pkg.status})${versionInfo}`]);
    }

    console.log(Table(header, rows).render());
    console.log(`\nTotal ${data.length} package(s).`);
    return data;
  });

  return function listPackage(_x) {
    return _ref.apply(this, arguments);
  };
}();

let choosePackage = exports.choosePackage = function () {
  var _ref3 = _asyncToGenerator(function* (appId) {
    const list = yield listPackage(appId);

    while (true) {
      const id = yield (0, _utils.question)('Enter Package Id:');
      const app = list.find(function (v) {
        return v.id === (id | 0);
      });
      if (app) {
        return app;
      }
    }
  });

  return function choosePackage(_x2) {
    return _ref3.apply(this, arguments);
  };
}();

var _utils = require('./utils');

var _app = require('./app');

function _asyncToGenerator(fn) { return function () { var gen = fn.apply(this, arguments); return new Promise(function (resolve, reject) { function step(key, arg) { try { var info = gen[key](arg); var value = info.value; } catch (error) { reject(error); return; } if (info.done) { resolve(value); } else { return Promise.resolve(value).then(function (value) { step("next", value); }, function (err) { step("throw", err); }); } } return step("next"); }); }; }

/**
 * Created by tdzl2003 on 4/2/16.
 */

var _require = require('./api');

const get = _require.get,
      post = _require.post,
      uploadFile = _require.uploadFile;

const Table = require('tty-table');

const commands = exports.commands = {
  uploadIpa: function () {
    var _ref4 = _asyncToGenerator(function* (_ref5) {
      let args = _ref5.args;

      const fn = args[0];
      if (!fn) {
        throw new Error('Usage: pushy uploadIpa <ipaFile>');
      }

      var _ref6 = yield (0, _utils.getIpaInfo)(fn);

      const versionName = _ref6.versionName,
            buildTime = _ref6.buildTime;

      var _ref7 = yield (0, _app.getSelectedApp)('ios');

      const appId = _ref7.appId;

      var _ref8 = yield uploadFile(fn);

      const hash = _ref8.hash;

      var _ref9 = yield post(`/app/${appId}/package/create`, {
        name: versionName,
        hash,
        buildTime
      });

      const id = _ref9.id;

      console.log(`Ipa uploaded: ${id}`);
    });

    return function uploadIpa(_x3) {
      return _ref4.apply(this, arguments);
    };
  }(),
  uploadApk: function () {
    var _ref10 = _asyncToGenerator(function* (_ref11) {
      let args = _ref11.args;

      const fn = args[0];
      if (!fn) {
        throw new Error('Usage: pushy uploadApk <apkFile>');
      }

      var _ref12 = yield (0, _utils.getApkInfo)(fn);

      const versionName = _ref12.versionName,
            buildTime = _ref12.buildTime;

      var _ref13 = yield (0, _app.getSelectedApp)('android');

      const appId = _ref13.appId;

      var _ref14 = yield uploadFile(fn);

      const hash = _ref14.hash;

      var _ref15 = yield post(`/app/${appId}/package/create`, {
        name: versionName,
        hash,
        buildTime
      });

      const id = _ref15.id;

      console.log(`Apk uploaded: ${id}`);
    });

    return function uploadApk(_x4) {
      return _ref10.apply(this, arguments);
    };
  }(),
  packages: function () {
    var _ref16 = _asyncToGenerator(function* (_ref17) {
      let options = _ref17.options;

      const platform = (0, _app.checkPlatform)(options.platform || (yield (0, _utils.question)('Platform(ios/android):')));

      var _ref18 = yield (0, _app.getSelectedApp)(platform);

      const appId = _ref18.appId;

      yield listPackage(appId);
    });

    return function packages(_x5) {
      return _ref16.apply(this, arguments);
    };
  }()
};