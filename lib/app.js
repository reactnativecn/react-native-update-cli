'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.commands = exports.chooseApp = exports.listApp = undefined;

let listApp = exports.listApp = function () {
  var _ref = _asyncToGenerator(function* (platform) {
    var _ref2 = yield get('/app/list');

    const data = _ref2.data;

    const list = platform ? data.filter(function (v) {
      return v.platform === platform;
    }) : data;
    for (const app of list) {
      console.log(`${app.id}) ${app.name}(${app.platform})`);
    }
    if (platform) {
      console.log(`\nTotal ${list.length} ${platform} apps`);
    } else {
      console.log(`\nTotal ${list.length} apps`);
    }
    return list;
  });

  return function listApp(_x) {
    return _ref.apply(this, arguments);
  };
}();

let chooseApp = exports.chooseApp = function () {
  var _ref3 = _asyncToGenerator(function* (platform) {
    const list = yield listApp(platform);

    while (true) {
      const id = yield (0, _utils.question)('Enter appId:');
      const app = list.find(function (v) {
        return v.id === (id | 0);
      });
      if (app) {
        return app;
      }
    }
  });

  return function chooseApp(_x2) {
    return _ref3.apply(this, arguments);
  };
}();

exports.checkPlatform = checkPlatform;
exports.getSelectedApp = getSelectedApp;

var _utils = require('./utils');

var _fsExtra = require('fs-extra');

var fs = _interopRequireWildcard(_fsExtra);

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) newObj[key] = obj[key]; } } newObj.default = obj; return newObj; } }

function _asyncToGenerator(fn) { return function () { var gen = fn.apply(this, arguments); return new Promise(function (resolve, reject) { function step(key, arg) { try { var info = gen[key](arg); var value = info.value; } catch (error) { reject(error); return; } if (info.done) { resolve(value); } else { return Promise.resolve(value).then(function (value) { step("next", value); }, function (err) { step("throw", err); }); } } return step("next"); }); }; } /**
                                                                                                                                                                                                                                                                                                                                                                                                                                                                            * Created by tdzl2003 on 2/13/16.
                                                                                                                                                                                                                                                                                                                                                                                                                                                                            */

var _require = require('./api');

const post = _require.post,
      get = _require.get,
      doDelete = _require.doDelete;


const validPlatforms = {
  ios: 1,
  android: 1
};

function checkPlatform(platform) {
  if (!validPlatforms[platform]) {
    throw new Error(`Invalid platform '${platform}'`);
  }
  return platform;
}

function getSelectedApp(platform) {
  checkPlatform(platform);

  if (!fs.existsSync('update.json')) {
    throw new Error(`App not selected. run 'pushy selectApp --platform ${platform}' first!`);
  }
  const updateInfo = JSON.parse(fs.readFileSync('update.json', 'utf8'));
  if (!updateInfo[platform]) {
    throw new Error(`App not selected. run 'pushy selectApp --platform ${platform}' first!`);
  }
  return updateInfo[platform];
}

const commands = exports.commands = {
  createApp: function () {
    var _ref4 = _asyncToGenerator(function* (_ref5) {
      let options = _ref5.options;

      const name = options.name || (yield (0, _utils.question)('App Name:'));
      const downloadUrl = options.downloadUrl;

      const platform = checkPlatform(options.platform || (yield (0, _utils.question)('Platform(ios/android):')));

      var _ref6 = yield post('/app/create', { name, platform });

      const id = _ref6.id;

      console.log(`Created app ${id}`);
      yield this.selectApp({
        args: [id],
        options: { platform, downloadUrl }
      });
    });

    return function createApp(_x3) {
      return _ref4.apply(this, arguments);
    };
  }(),
  deleteApp: function () {
    var _ref7 = _asyncToGenerator(function* (_ref8) {
      let args = _ref8.args,
          options = _ref8.options;
      const platform = options.platform;

      const id = args[0] || chooseApp(platform);
      if (!id) {
        console.log('Canceled');
      }
      yield doDelete(`/app/${id}`);
      console.log('Ok.');
    });

    return function deleteApp(_x4) {
      return _ref7.apply(this, arguments);
    };
  }(),
  apps: function () {
    var _ref9 = _asyncToGenerator(function* (_ref10) {
      let options = _ref10.options;
      const platform = options.platform;

      listApp(platform);
    });

    return function apps(_x5) {
      return _ref9.apply(this, arguments);
    };
  }(),
  selectApp: function () {
    var _ref11 = _asyncToGenerator(function* (_ref12) {
      let args = _ref12.args,
          options = _ref12.options;

      const platform = checkPlatform(options.platform || (yield (0, _utils.question)('Platform(ios/android):')));
      const id = args[0] || (yield chooseApp(platform)).id;

      let updateInfo = {};
      if (fs.existsSync('update.json')) {
        try {
          updateInfo = JSON.parse(fs.readFileSync('update.json', 'utf8'));
        } catch (e) {
          console.error('Failed to parse file `update.json`. Try to remove it manually.');
          throw e;
        }
      }

      var _ref13 = yield get(`/app/${id}`);

      const appKey = _ref13.appKey;

      updateInfo[platform] = {
        appId: id,
        appKey
      };
      fs.writeFileSync('update.json', JSON.stringify(updateInfo, null, 4), 'utf8');
    });

    return function selectApp(_x6) {
      return _ref11.apply(this, arguments);
    };
  }()
};