const path = require('path');
import { getRNVersion, translateOptions } from './utils';
import * as fs from 'fs-extra';
import { ZipFile } from 'yazl';
import { open as openZipFile } from 'yauzl';
import { question, printVersionCommand } from './utils';
import { checkPlatform } from './app';
const { spawn, spawnSync } = require('child_process');
const g2js = require('gradle-to-js/lib/parser');
const os = require('os');

var bsdiff, hdiff, diff;
try {
  bsdiff = require('node-bsdiff').diff;
} catch (e) {}

try {
  hdiff = require('node-hdiffpatch').diff;
} catch (e) {}

async function runReactNativeBundleCommand(
  bundleName,
  development,
  entryFile,
  outputFolder,
  platform,
  sourcemapOutput,
  config,
) {
  let gradleConfig = {};
  if (platform === 'android') {
    gradleConfig = await checkGradleConfig();
    // if (gradleConfig.crunchPngs !== false) {
    //   throw new Error('请先禁用android的crunchPngs优化，具体请参考 https://pushy.reactnative.cn/docs/getting-started.html#%E7%A6%81%E7%94%A8android%E7%9A%84crunch%E4%BC%98%E5%8C%96')
    // }
  }

  let reactNativeBundleArgs = [];

  let envArgs = process.env.PUSHY_ENV_ARGS;

  if (envArgs) {
    Array.prototype.push.apply(
      reactNativeBundleArgs,
      envArgs.trim().split(/\s+/),
    );
  }

  fs.emptyDirSync(outputFolder);

  // TODO sourcemap
  Array.prototype.push.apply(reactNativeBundleArgs, [
    path.join('node_modules', 'react-native', 'local-cli', 'cli.js'),
    'bundle',
    '--assets-dest',
    outputFolder,
    '--bundle-output',
    path.join(outputFolder, bundleName),
    '--dev',
    development,
    '--entry-file',
    entryFile,
    '--platform',
    platform,
    '--reset-cache',
  ]);

  if (sourcemapOutput) {
    reactNativeBundleArgs.push('--sourcemap-output', sourcemapOutput);
  }

  if (config) {
    reactNativeBundleArgs.push('--config', config);
  }

  const reactNativeBundleProcess = spawn('node', reactNativeBundleArgs);
  console.log(
    `Running bundle command: node ${reactNativeBundleArgs.join(' ')}`,
  );

  return new Promise((resolve, reject) => {
    reactNativeBundleProcess.stdout.on('data', (data) => {
      console.log(data.toString().trim());
    });

    reactNativeBundleProcess.stderr.on('data', (data) => {
      console.error(data.toString().trim());
    });

    reactNativeBundleProcess.on('close', async (exitCode) => {
      if (exitCode) {
        reject(
          new Error(
            `"react-native bundle" command exited with code ${exitCode}.`,
          ),
        );
      } else {
        if (
          (platform === 'android' && gradleConfig.enableHermes) ||
          (platform === 'ios' && fs.existsSync('ios/Pods/hermes-engine'))
        ) {
          await compileHermesByteCode(bundleName, outputFolder);
        }
        resolve(null);
      }
    });
  });
}

function getHermesOSBin() {
  if (os.platform() === 'win32') return 'win64-bin';
  if (os.platform() === 'darwin') return 'osx-bin';
  if (os.platform() === 'linux') return 'linux64-bin';
}

async function checkGradleConfig() {
  let enableHermes = false;
  let crunchPngs;
  try {
    const gradleConfig = await g2js.parseFile('android/app/build.gradle');
    const projectConfig = gradleConfig['project.ext.react'];
    for (const packagerConfig of projectConfig) {
      if (
        packagerConfig.includes('enableHermes') &&
        packagerConfig.includes('true')
      ) {
        enableHermes = true;
        break;
      }
    }
    crunchPngs = gradleConfig.android.buildTypes.release.crunchPngs;
  } catch (e) {}
  return {
    enableHermes,
    crunchPngs,
  };
}

async function compileHermesByteCode(bundleName, outputFolder) {
  console.log(`Hermes enabled, now compiling to hermes bytecode:\n`);
  // >= rn 0.69
  let hermesCommand = `node_modules/react-native/sdks/hermesc/${getHermesOSBin()}/hermesc`;
  // < rn 0.69
  if (!fs.existsSync(hermesCommand)) {
    const hermesPackage = fs.existsSync('node_modules/hermes-engine')
      ? 'node_modules/hermes-engine' // 0.2+
      : 'node_modules/hermesvm'; // < 0.2
    const hermesPath = `${hermesPackage}/${getHermesOSBin()}`;

    hermesCommand = fs.existsSync(`${hermesPath}/hermesc`)
      ? `${hermesPath}/hermesc` // 0.5+
      : `${hermesPath}/hermes`; // < 0.5
  }

  // TODO sourcemap
  spawnSync(
    path.join.apply(null, hermesCommand.split('/')),
    [
      '-emit-binary',
      '-out',
      path.join(outputFolder, bundleName),
      path.join(outputFolder, bundleName),
      '-O',
    ],
    { stdio: 'ignore' },
  );
}

async function pack(dir, output) {
  console.log('Packing');
  fs.ensureDirSync(path.dirname(output));
  await new Promise((resolve, reject) => {
    var zipfile = new ZipFile();

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

    zipfile.outputStream.on('error', (err) => reject(err));
    zipfile.outputStream
      .pipe(fs.createWriteStream(output))
      .on('close', function () {
        resolve();
      });
    zipfile.end();
  });
  console.log('ppk热更包已生成并保存到: ' + output);
}

function readEntire(entry, zipFile) {
  const buffers = [];
  return new Promise((resolve, reject) => {
    zipFile.openReadStream(entry, (err, stream) => {
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
        emit() {},
      });
    });
  });
}

function basename(fn) {
  const m = /^(.+\/)[^\/]+\/?$/.exec(fn);
  return m && m[1];
}

async function diffFromPPK(origin, next, output) {
  fs.ensureDirSync(path.dirname(output));

  const originEntries = {};
  const originMap = {};

  let originSource;

  await enumZipEntries(origin, (entry, zipFile) => {
    originEntries[entry.fileName] = entry;
    if (!/\/$/.test(entry.fileName)) {
      // isFile
      originMap[entry.crc32] = entry.fileName;

      if (entry.fileName === 'index.bundlejs') {
        // This is source.
        return readEntire(entry, zipFile).then((v) => (originSource = v));
      }
    }
  });

  if (!originSource) {
    throw new Error(
      `Bundle file not found! Please use default bundle file name and path.`,
    );
  }

  const copies = {};

  var zipfile = new ZipFile();

  const writePromise = new Promise((resolve, reject) => {
    zipfile.outputStream.on('error', (err) => {
      throw err;
    });
    zipfile.outputStream
      .pipe(fs.createWriteStream(output))
      .on('close', function () {
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

  await enumZipEntries(next, (entry, nextZipfile) => {
    newEntries[entry.fileName] = entry;

    if (/\/$/.test(entry.fileName)) {
      // Directory
      if (!originEntries[entry.fileName]) {
        addEntry(entry.fileName);
      }
    } else if (entry.fileName === 'index.bundlejs') {
      //console.log('Found bundle');
      return readEntire(entry, nextZipfile).then((newSource) => {
        //console.log('Begin diff');
        zipfile.addBuffer(
          diff(originSource, newSource),
          'index.bundlejs.patch',
        );
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

      return new Promise((resolve, reject) => {
        nextZipfile.openReadStream(entry, function (err, readStream) {
          if (err) {
            return reject(err);
          }
          zipfile.addReadStream(readStream, entry.fileName);
          readStream.on('end', () => {
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
  zipfile.addBuffer(
    Buffer.from(JSON.stringify({ copies, deletes })),
    '__diff.json',
  );
  zipfile.end();
  await writePromise;
}

async function diffFromPackage(
  origin,
  next,
  output,
  originBundleName,
  transformPackagePath = (v) => v,
) {
  fs.ensureDirSync(path.dirname(output));

  const originEntries = {};
  const originMap = {};

  let originSource;

  await enumZipEntries(origin, (entry, zipFile) => {
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
        return readEntire(entry, zipFile).then((v) => (originSource = v));
      }
    }
  });

  if (!originSource) {
    throw new Error(
      `Bundle file not found! Please use default bundle file name and path.`,
    );
  }

  const copies = {};

  var zipfile = new ZipFile();

  const writePromise = new Promise((resolve, reject) => {
    zipfile.outputStream.on('error', (err) => {
      throw err;
    });
    zipfile.outputStream
      .pipe(fs.createWriteStream(output))
      .on('close', function () {
        resolve();
      });
  });

  await enumZipEntries(next, (entry, nextZipfile) => {
    if (/\/$/.test(entry.fileName)) {
      // Directory
      zipfile.addEmptyDirectory(entry.fileName);
    } else if (entry.fileName === 'index.bundlejs') {
      //console.log('Found bundle');
      return readEntire(entry, nextZipfile).then((newSource) => {
        //console.log('Begin diff');
        zipfile.addBuffer(
          diff(originSource, newSource),
          'index.bundlejs.patch',
        );
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

      return new Promise((resolve, reject) => {
        nextZipfile.openReadStream(entry, function (err, readStream) {
          if (err) {
            return reject(err);
          }
          zipfile.addReadStream(readStream, entry.fileName);
          readStream.on('end', () => {
            //console.log('add finished');
            resolve();
          });
        });
      });
    }
  });

  zipfile.addBuffer(Buffer.from(JSON.stringify({ copies })), '__diff.json');
  zipfile.end();
  await writePromise;
}

function enumZipEntries(zipFn, callback) {
  return new Promise((resolve, reject) => {
    openZipFile(zipFn, { lazyEntries: true }, (err, zipfile) => {
      if (err) {
        return reject(err);
      }
      zipfile.on('end', resolve);
      zipfile.on('error', reject);
      zipfile.on('entry', (entry) => {
        const result = callback(entry, zipfile);
        if (result && typeof result.then === 'function') {
          result.then(() => zipfile.readEntry());
        } else {
          zipfile.readEntry();
        }
      });
      zipfile.readEntry();
    });
  });
}

function diffArgsCheck(args, options, diffFn) {
  const [origin, next] = args;

  if (!origin || !next) {
    console.error(`Usage: pushy ${diffFn} <origin> <next>`);
    process.exit(1);
  }

  if (diffFn.startsWith('hdiff')) {
    if (!hdiff) {
      console.error(
        `This function needs "node-hdiffpatch". 
        Please run "npm i node-hdiffpatch" to install`,
      );
      process.exit(1);
    }
    diff = hdiff;
  } else {
    if (!bsdiff) {
      console.error(
        `This function needs "node-bsdiff". 
        Please run "npm i node-bsdiff" to install`,
      );
      process.exit(1);
    }
    diff = bsdiff;
  }
  const { output } = options;

  return {
    origin,
    next,
    realOutput: output.replace(/\$\{time\}/g, '' + Date.now()),
  };
}

export const commands = {
  bundle: async function ({ options }) {
    const platform = checkPlatform(
      options.platform || (await question('平台(ios/android):')),
    );

    let { bundleName, entryFile, intermediaDir, output, dev, verbose } =
      translateOptions({
        ...options,
        platform,
      });

    // const sourcemapOutput = path.join(intermediaDir, bundleName + ".map");

    const realOutput = output.replace(/\$\{time\}/g, '' + Date.now());

    if (!platform) {
      throw new Error('Platform must be specified.');
    }

    const { version, major, minor } = getRNVersion();

    console.log('Bundling with react-native: ', version);
    printVersionCommand();

    await runReactNativeBundleCommand(
      bundleName,
      dev,
      entryFile,
      intermediaDir,
      platform,
    );

    await pack(path.resolve(intermediaDir), realOutput);

    const v = await question('是否现在上传此热更包?(Y/N)');
    if (v.toLowerCase() === 'y') {
      await this.publish({
        args: [realOutput],
        options: {
          platform,
        },
      });
    }
  },

  async diff({ args, options }) {
    const { origin, next, realOutput } = diffArgsCheck(args, options, 'diff');

    await diffFromPPK(origin, next, realOutput, 'index.bundlejs');
    console.log(`${realOutput} generated.`);
  },

  async hdiff({ args, options }) {
    const { origin, next, realOutput } = diffArgsCheck(args, options, 'hdiff');

    await diffFromPPK(origin, next, realOutput, 'index.bundlejs');
    console.log(`${realOutput} generated.`);
  },

  async diffFromApk({ args, options }) {
    const { origin, next, realOutput } = diffArgsCheck(
      args,
      options,
      'diffFromApk',
    );

    await diffFromPackage(
      origin,
      next,
      realOutput,
      'assets/index.android.bundle',
    );
    console.log(`${realOutput} generated.`);
  },

  async hdiffFromApk({ args, options }) {
    const { origin, next, realOutput } = diffArgsCheck(
      args,
      options,
      'hdiffFromApk',
    );

    await diffFromPackage(
      origin,
      next,
      realOutput,
      'assets/index.android.bundle',
    );
    console.log(`${realOutput} generated.`);
  },

  async diffFromIpa({ args, options }) {
    const { origin, next, realOutput } = diffArgsCheck(
      args,
      options,
      'diffFromIpa',
    );

    await diffFromPackage(origin, next, realOutput, 'main.jsbundle', (v) => {
      const m = /^Payload\/[^/]+\/(.+)$/.exec(v);
      return m && m[1];
    });

    console.log(`${realOutput} generated.`);
  },

  async hdiffFromIpa({ args, options }) {
    const { origin, next, realOutput } = diffArgsCheck(
      args,
      options,
      'hdiffFromIpa',
    );

    await diffFromPackage(origin, next, realOutput, 'main.jsbundle', (v) => {
      const m = /^Payload\/[^/]+\/(.+)$/.exec(v);
      return m && m[1];
    });

    console.log(`${realOutput} generated.`);
  },
};
