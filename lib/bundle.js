'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.commands = undefined;

var _slicedToArray = function () { function sliceIterator(arr, i) { var _arr = []; var _n = true; var _d = false; var _e = undefined; try { for (var _i = arr[Symbol.iterator](), _s; !(_n = (_s = _i.next()).done); _n = true) { _arr.push(_s.value); if (i && _arr.length === i) break; } } catch (err) { _d = true; _e = err; } finally { try { if (!_n && _i["return"]) _i["return"](); } finally { if (_d) throw _e; } } return _arr; } return function (arr, i) { if (Array.isArray(arr)) { return arr; } else if (Symbol.iterator in Object(arr)) { return sliceIterator(arr, i); } else { throw new TypeError("Invalid attempt to destructure non-iterable instance"); } }; }();

var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };

let runReactNativeBundleCommand = function () {
  var _ref = _asyncToGenerator(function* (bundleName, development, entryFile, outputFolder, platform, sourcemapOutput, config) {
    let reactNativeBundleArgs = [];

    let envArgs = process.env.PUSHY_ENV_ARGS;

    if (envArgs) {
      Array.prototype.push.apply(reactNativeBundleArgs, envArgs.trim().split(/\s+/));
    }

    fs.emptyDirSync(outputFolder);

    Array.prototype.push.apply(reactNativeBundleArgs, [path.join("node_modules", "react-native", "local-cli", "cli.js"), "bundle", '--assets-dest', outputFolder, '--bundle-output', path.join(outputFolder, bundleName), '--dev', development, '--entry-file', entryFile, '--platform', platform, '--reset-cache']);

    if (sourcemapOutput) {
      reactNativeBundleArgs.push('--sourcemap-output', sourcemapOutput);
    }

    if (config) {
      reactNativeBundleArgs.push('--config', config);
    }

    const reactNativeBundleProcess = spawn('node', reactNativeBundleArgs);
    console.log(`Running bundle command: node ${reactNativeBundleArgs.join(' ')}`);

    return new Promise(function (resolve, reject) {
      reactNativeBundleProcess.stdout.on('data', function (data) {
        console.log(data.toString().trim());
      });

      reactNativeBundleProcess.stderr.on('data', function (data) {
        console.error(data.toString().trim());
      });

      reactNativeBundleProcess.on('close', function () {
        var _ref2 = _asyncToGenerator(function* (exitCode) {
          if (exitCode) {
            reject(new Error(`"react-native bundle" command exited with code ${exitCode}.`));
          } else {
            if (platform === 'android') {
              yield compileHermesByteCode(bundleName, outputFolder);
            }
            resolve(null);
          }
        });

        return function (_x8) {
          return _ref2.apply(this, arguments);
        };
      }());
    });
  });

  return function runReactNativeBundleCommand(_x, _x2, _x3, _x4, _x5, _x6, _x7) {
    return _ref.apply(this, arguments);
  };
}();

let compileHermesByteCode = function () {
  var _ref3 = _asyncToGenerator(function* (bundleName, outputFolder) {
    let enableHermes = false;
    try {
      const gradleConfig = yield g2js.parseFile('android/app/build.gradle');
      const projectConfig = gradleConfig['project.ext.react'];
      for (const packagerConfig of projectConfig) {
        if (packagerConfig.includes('enableHermes') && packagerConfig.includes('true')) {
          enableHermes = true;
          break;
        }
      }
    } catch (e) {}
    if (enableHermes) {
      console.log(`Hermes enabled, now compiling to hermes bytecode:\n`);
      const hermesPath = fs.existsSync('node_modules/hermes-engine') ? 'node_modules/hermes-engine' : 'node_modules/hermesvm';
      execSync(`${hermesPath}/${getHermesOSBin()}/hermes -emit-binary -out ${outputFolder}/${bundleName} ${outputFolder}/${bundleName} -O`, { stdio: 'ignore' });
    }
  });

  return function compileHermesByteCode(_x9, _x10) {
    return _ref3.apply(this, arguments);
  };
}();

let pack = function () {
  var _ref4 = _asyncToGenerator(function* (dir, output) {
    console.log('Packing');
    fs.ensureDirSync(path.dirname(output));
    yield new Promise(function (resolve, reject) {
      var zipfile = new _yazl.ZipFile();

      function addDirectory(root, rel) {
        if (rel) {
          zipfile.addEmptyDirectory(rel);
        }
        const childs = fs.readdirSync(root);
        for (const name of childs) {
          if (name === '.' || name === '..') {
            continue;
          }
          const fullPath = path.join(root, name);
          const stat = fs.statSync(fullPath);
          if (stat.isFile()) {
            //console.log('adding: ' + rel+name);
            zipfile.addFile(fullPath, rel + name);
          } else if (stat.isDirectory()) {
            //console.log('adding: ' + rel+name+'/');
            addDirectory(fullPath, rel + name + '/');
          }
        }
      }

      addDirectory(dir, '');

      zipfile.outputStream.on('error', function (err) {
        return reject(err);
      });
      zipfile.outputStream.pipe(fs.createWriteStream(output)).on('close', function () {
        resolve();
      });
      zipfile.end();
    });
    console.log('Bundled saved to: ' + output);
  });

  return function pack(_x11, _x12) {
    return _ref4.apply(this, arguments);
  };
}();

let diffFromPPK = function () {
  var _ref5 = _asyncToGenerator(function* (origin, next, output) {
    fs.ensureDirSync(path.dirname(output));

    const originEntries = {};
    const originMap = {};

    let originSource;

    yield enumZipEntries(origin, function (entry, zipFile) {
      originEntries[entry.fileName] = entry;
      if (!/\/$/.test(entry.fileName)) {
        // isFile
        originMap[entry.crc32] = entry.fileName;

        if (entry.fileName === 'index.bundlejs') {
          // This is source.
          return readEntire(entry, zipFile).then(function (v) {
            return originSource = v;
          });
        }
      }
    });

    originSource = originSource || new Buffer(0);

    const copies = {};

    var zipfile = new _yazl.ZipFile();

    const writePromise = new Promise(function (resolve, reject) {
      zipfile.outputStream.on('error', function (err) {
        throw err;
      });
      zipfile.outputStream.pipe(fs.createWriteStream(output)).on('close', function () {
        resolve();
      });
    });

    const addedEntry = {};

    function addEntry(fn) {
      //console.log(fn);
      if (!fn || addedEntry[fn]) {
        return;
      }
      const base = basename(fn);
      if (base) {
        addEntry(base);
      }
      zipfile.addEmptyDirectory(fn);
    }

    const newEntries = {};

    yield enumZipEntries(next, function (entry, nextZipfile) {
      newEntries[entry.fileName] = entry;

      if (/\/$/.test(entry.fileName)) {
        // Directory
        if (!originEntries[entry.fileName]) {
          addEntry(entry.fileName);
        }
      } else if (entry.fileName === 'index.bundlejs') {
        //console.log('Found bundle');
        return readEntire(entry, nextZipfile).then(function (newSource) {
          //console.log('Begin diff');
          zipfile.addBuffer(diff(originSource, newSource), 'index.bundlejs.patch');
          //console.log('End diff');
        });
      } else {
        // If same file.
        const originEntry = originEntries[entry.fileName];
        if (originEntry && originEntry.crc32 === entry.crc32) {
          // ignore
          return;
        }

        // If moved from other place
        if (originMap[entry.crc32]) {
          const base = basename(entry.fileName);
          if (!originEntries[base]) {
            addEntry(base);
          }
          copies[entry.fileName] = originMap[entry.crc32];
          return;
        }

        // New file.
        addEntry(basename(entry.fileName));

        return new Promise(function (resolve, reject) {
          nextZipfile.openReadStream(entry, function (err, readStream) {
            if (err) {
              return reject(err);
            }
            zipfile.addReadStream(readStream, entry.fileName);
            readStream.on('end', function () {
              //console.log('add finished');
              resolve();
            });
          });
        });
      }
    });

    const deletes = {};

    for (var k in originEntries) {
      if (!newEntries[k]) {
        console.log('Delete ' + k);
        deletes[k] = 1;
      }
    }

    //console.log({copies, deletes});
    zipfile.addBuffer(new Buffer(JSON.stringify({ copies, deletes })), '__diff.json');
    zipfile.end();
    yield writePromise;
  });

  return function diffFromPPK(_x13, _x14, _x15) {
    return _ref5.apply(this, arguments);
  };
}();

let diffFromPackage = function () {
  var _ref6 = _asyncToGenerator(function* (origin, next, output, originBundleName) {
    let transformPackagePath = arguments.length > 4 && arguments[4] !== undefined ? arguments[4] : function (v) {
      return v;
    };

    fs.ensureDirSync(path.dirname(output));

    const originEntries = {};
    const originMap = {};

    let originSource;

    yield enumZipEntries(origin, function (entry, zipFile) {
      if (!/\/$/.test(entry.fileName)) {
        const fn = transformPackagePath(entry.fileName);
        if (!fn) {
          return;
        }

        //console.log(fn);
        // isFile
        originEntries[fn] = entry.crc32;
        originMap[entry.crc32] = fn;

        if (fn === originBundleName) {
          // This is source.
          return readEntire(entry, zipFile).then(function (v) {
            return originSource = v;
          });
        }
      }
    });

    originSource = originSource || new Buffer(0);

    const copies = {};

    var zipfile = new _yazl.ZipFile();

    const writePromise = new Promise(function (resolve, reject) {
      zipfile.outputStream.on('error', function (err) {
        throw err;
      });
      zipfile.outputStream.pipe(fs.createWriteStream(output)).on('close', function () {
        resolve();
      });
    });

    yield enumZipEntries(next, function (entry, nextZipfile) {
      if (/\/$/.test(entry.fileName)) {
        // Directory
        zipfile.addEmptyDirectory(entry.fileName);
      } else if (entry.fileName === 'index.bundlejs') {
        //console.log('Found bundle');
        return readEntire(entry, nextZipfile).then(function (newSource) {
          //console.log('Begin diff');
          zipfile.addBuffer(diff(originSource, newSource), 'index.bundlejs.patch');
          //console.log('End diff');
        });
      } else {
        // If same file.
        if (originEntries[entry.fileName] === entry.crc32) {
          copies[entry.fileName] = '';
          return;
        }
        // If moved from other place
        if (originMap[entry.crc32]) {
          copies[entry.fileName] = originMap[entry.crc32];
          return;
        }

        return new Promise(function (resolve, reject) {
          nextZipfile.openReadStream(entry, function (err, readStream) {
            if (err) {
              return reject(err);
            }
            zipfile.addReadStream(readStream, entry.fileName);
            readStream.on('end', function () {
              //console.log('add finished');
              resolve();
            });
          });
        });
      }
    });

    zipfile.addBuffer(new Buffer(JSON.stringify({ copies })), '__diff.json');
    zipfile.end();
    yield writePromise;
  });

  return function diffFromPackage(_x16, _x17, _x18, _x19) {
    return _ref6.apply(this, arguments);
  };
}();

var _utils = require('./utils');

var _fsExtra = require('fs-extra');

var fs = _interopRequireWildcard(_fsExtra);

var _yazl = require('yazl');

var _yauzl = require('yauzl');

var _app = require('./app');

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) newObj[key] = obj[key]; } } newObj.default = obj; return newObj; } }

function _asyncToGenerator(fn) { return function () { var gen = fn.apply(this, arguments); return new Promise(function (resolve, reject) { function step(key, arg) { try { var info = gen[key](arg); var value = info.value; } catch (error) { reject(error); return; } if (info.done) { resolve(value); } else { return Promise.resolve(value).then(function (value) { step("next", value); }, function (err) { step("throw", err); }); } } return step("next"); }); }; }

/**
 * Created by tdzl2003 on 2/22/16.
 */

const path = require('path');

var _require = require('child_process');

const spawn = _require.spawn,
      spawnSync = _require.spawnSync,
      execSync = _require.execSync;

const g2js = require('gradle-to-js/lib/parser');
const os = require('os');

var diff;
try {
  var bsdiff = require('node-bsdiff');
  diff = typeof bsdiff != 'function' ? bsdiff.diff : bsdiff;
} catch (e) {
  diff = function () {
    console.warn('This function needs "node-bsdiff". Please run "npm i node-bsdiff" from your project directory first!');
    throw new Error('This function needs module "node-bsdiff". Please install it first.');
  };
}

function exec(command) {
  const commandResult = spawnSync(command, {
    shell: true,
    stdio: 'inherit'
  });
  if (commandResult.error) {
    throw commandResult.error;
  }
}

function getHermesOSBin() {
  if (os.platform() === 'win32') return 'win64-bin';
  if (os.platform() === 'darwin') return 'osx-bin';
  if (os.platform() === 'linux') return 'linux64-bin';
}

function readEntire(entry, zipFile) {
  const buffers = [];
  return new Promise(function (resolve, reject) {
    zipFile.openReadStream(entry, function (err, stream) {
      stream.pipe({
        write(chunk) {
          buffers.push(chunk);
        },
        end() {
          resolve(Buffer.concat(buffers));
        },
        prependListener() {},
        on() {},
        once() {},
        emit() {}
      });
    });
  });
}

function basename(fn) {
  const m = /^(.+\/)[^\/]+\/?$/.exec(fn);
  return m && m[1];
}

function enumZipEntries(zipFn, callback) {
  return new Promise(function (resolve, reject) {
    (0, _yauzl.open)(zipFn, { lazyEntries: true }, function (err, zipfile) {
      if (err) {
        return reject(err);
      }
      zipfile.on('end', resolve);
      zipfile.on('error', reject);
      zipfile.on('entry', function (entry) {
        const result = callback(entry, zipfile);
        if (result && typeof result.then === 'function') {
          result.then(function () {
            return zipfile.readEntry();
          });
        } else {
          zipfile.readEntry();
        }
      });
      zipfile.readEntry();
    });
  });
}

const commands = exports.commands = {
  bundle: function () {
    var _ref7 = _asyncToGenerator(function* (_ref8) {
      let options = _ref8.options;

      const platform = (0, _app.checkPlatform)(options.platform || (yield (0, _utils.question)('Platform(ios/android):')));

      var _translateOptions = (0, _utils.translateOptions)(_extends({}, options, {
        platform
      }));

      let bundleName = _translateOptions.bundleName,
          entryFile = _translateOptions.entryFile,
          intermediaDir = _translateOptions.intermediaDir,
          output = _translateOptions.output,
          dev = _translateOptions.dev,
          verbose = _translateOptions.verbose;

      // const sourcemapOutput = path.join(intermediaDir, bundleName + ".map");

      const realOutput = output.replace(/\$\{time\}/g, '' + Date.now());

      if (!platform) {
        throw new Error('Platform must be specified.');
      }

      var _getRNVersion = (0, _utils.getRNVersion)();

      const version = _getRNVersion.version,
            major = _getRNVersion.major,
            minor = _getRNVersion.minor;


      console.log('Bundling with React Native version: ', version);

      yield runReactNativeBundleCommand(bundleName, dev, entryFile, intermediaDir, platform);

      yield pack(path.resolve(intermediaDir), realOutput);

      const v = yield (0, _utils.question)('Would you like to publish it?(Y/N)');
      if (v.toLowerCase() === 'y') {
        yield this.publish({
          args: [realOutput],
          options: {
            platform
          }
        });
      }
    });

    return function bundle(_x21) {
      return _ref7.apply(this, arguments);
    };
  }(),

  diff(_ref9) {
    let args = _ref9.args,
        options = _ref9.options;
    return _asyncToGenerator(function* () {
      var _args = _slicedToArray(args, 2);

      const origin = _args[0],
            next = _args[1];
      const output = options.output;


      const realOutput = output.replace(/\$\{time\}/g, '' + Date.now());

      if (!origin || !next) {
        console.error('pushy diff <origin> <next>');
        process.exit(1);
      }

      yield diffFromPPK(origin, next, realOutput, 'index.bundlejs');
      console.log(`${realOutput} generated.`);
    })();
  },

  diffFromApk(_ref10) {
    let args = _ref10.args,
        options = _ref10.options;
    return _asyncToGenerator(function* () {
      var _args2 = _slicedToArray(args, 2);

      const origin = _args2[0],
            next = _args2[1];
      const output = options.output;


      const realOutput = output.replace(/\$\{time\}/g, '' + Date.now());

      if (!origin || !next) {
        console.error('pushy diffFromApk <origin> <next>');
        process.exit(1);
      }

      yield diffFromPackage(origin, next, realOutput, 'assets/index.android.bundle');
      console.log(`${realOutput} generated.`);
    })();
  },

  diffFromIpa(_ref11) {
    let args = _ref11.args,
        options = _ref11.options;
    return _asyncToGenerator(function* () {
      var _args3 = _slicedToArray(args, 2);

      const origin = _args3[0],
            next = _args3[1];
      const output = options.output;


      const realOutput = output.replace(/\$\{time\}/g, '' + Date.now());

      if (!origin || !next) {
        console.error('pushy diffFromIpa <origin> <next>');
        process.exit(1);
      }

      yield diffFromPackage(origin, next, realOutput, 'main.jsbundle', function (v) {
        const m = /^Payload\/[^/]+\/(.+)$/.exec(v);
        return m && m[1];
      });

      console.log(`${realOutput} generated.`);
    })();
  }
};