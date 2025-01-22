import path from 'node:path';
import { getRNVersion, translateOptions } from './utils';
import * as fs from 'fs-extra';
import { ZipFile } from 'yazl';
import { open as openZipFile } from 'yauzl';
import { question, checkPlugins } from './utils';
import { checkPlatform } from './app';
import { spawn, spawnSync } from 'node:child_process';
import semverSatisfies from 'semver/functions/satisfies';
const g2js = require('gradle-to-js/lib/parser');
import os from 'node:os';
const properties = require('properties');

let bsdiff;
let hdiff;
let diff;
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
    if (gradleConfig.crunchPngs !== false) {
      console.warn(
        'android 的 crunchPngs 选项似乎尚未禁用（如已禁用则请忽略此提示），这可能导致热更包体积异常增大，具体请参考 https://pushy.reactnative.cn/docs/getting-started.html#%E7%A6%81%E7%94%A8-android-%E7%9A%84-crunch-%E4%BC%98%E5%8C%96 \n',
      );
    }
  }

  const reactNativeBundleArgs = [];

  const envArgs = process.env.PUSHY_ENV_ARGS;

  if (envArgs) {
    Array.prototype.push.apply(
      reactNativeBundleArgs,
      envArgs.trim().split(/\s+/),
    );
  }

  fs.emptyDirSync(outputFolder);

  let cliPath;

  let usingExpo = false;
  try {
    cliPath = require.resolve('@expo/cli', {
      paths: [process.cwd()],
    });
    const expoCliVersion = JSON.parse(
      fs.readFileSync(
        require.resolve('@expo/cli/package.json', {
          paths: [process.cwd()],
        }),
      ),
    ).version;
    // expo cli 0.10.17 (expo 49) 开始支持 bundle:embed
    if (semverSatisfies(expoCliVersion, '>= 0.10.17')) {
      usingExpo = true;
    }
  } catch (e) {}
  if (!usingExpo) {
    try {
      // rn >= 0.75
      cliPath = require.resolve('@react-native-community/cli/build/bin.js', {
        paths: [process.cwd()],
      });
    } catch (e) {
      // rn < 0.75
      cliPath = require.resolve('react-native/local-cli/cli.js', {
        paths: [process.cwd()],
      });
    }
  }
  const bundleParams = await checkPlugins();
  const minifyOption = bundleParams.minify;
  const isSentry = bundleParams.sentry;
  const bundleCommand = usingExpo
    ? 'export:embed'
    : platform === 'harmony'
    ? 'bundle-harmony'
    : 'bundle';
  if (platform === 'harmony') {
    Array.prototype.push.apply(reactNativeBundleArgs, [
      cliPath,
      bundleCommand,
      '--dev',
      development,
      '--entry-file',
      entryFile,
    ]);

    if (sourcemapOutput) {
      reactNativeBundleArgs.push('--sourcemap-output', sourcemapOutput);
    }

    if (config) {
      reactNativeBundleArgs.push('--config', config);
    }
  } else {
    Array.prototype.push.apply(reactNativeBundleArgs, [
      cliPath,
      bundleCommand,
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
      '--minify',
      minifyOption,
    ]);

    if (sourcemapOutput) {
      reactNativeBundleArgs.push('--sourcemap-output', sourcemapOutput);
    }

    if (config) {
      reactNativeBundleArgs.push('--config', config);
    }
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
        let hermesEnabled = false;

        if (platform === 'android') {
          const gradlePropeties = await new Promise((resolve) => {
            properties.parse(
              './android/gradle.properties',
              { path: true },
              (error, props) => {
                if (error) {
                  console.error(error);
                  resolve(null);
                }

                resolve(props);
              },
            );
          });
          hermesEnabled = gradlePropeties.hermesEnabled;

          if (typeof hermesEnabled !== 'boolean')
            hermesEnabled = gradleConfig.enableHermes;
        } else if (
          platform === 'ios' &&
          fs.existsSync('ios/Pods/hermes-engine')
        ) {
          hermesEnabled = true;
        } else if (platform === 'harmony') {
          await copyHarmonyBundle(outputFolder);
        }
        if (hermesEnabled) {
          await compileHermesByteCode(
            bundleName,
            outputFolder,
            sourcemapOutput,
            !isSentry,
          );
          if (isSentry) {
            await copyDebugidForSentry(
              bundleName,
              outputFolder,
              sourcemapOutput,
            );
            await uploadSourcemapForSentry(
              bundleName,
              outputFolder,
              sourcemapOutput,
            );
          }
        }
        resolve(null);
      }
    });
  });
}

async function copyHarmonyBundle(outputFolder) {
  const harmonyRawPath = 'harmony/entry/src/main/resources/rawfile';
  try {
    await fs.ensureDir(harmonyRawPath);
    try {
      await fs.access(harmonyRawPath, fs.constants.W_OK);
    } catch (error) {
      await fs.chmod(harmonyRawPath, 0o755);
    }
    await fs.remove(path.join(harmonyRawPath, 'update.json'));
    await fs.copy('update.json', path.join(harmonyRawPath, 'update.json'));

    await fs.ensureDir(outputFolder);
    await fs.copy(harmonyRawPath, outputFolder);
  } catch (error) {
    console.error('copyHarmonyBundle 错误:', error);
    throw new Error(`复制文件失败: ${error.message}`);
  }
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
    crunchPngs = gradleConfig.android.buildTypes.release.crunchPngs;
    const projectConfig = gradleConfig['project.ext.react'];
    if (projectConfig) {
      for (const packagerConfig of projectConfig) {
        if (
          packagerConfig.includes('enableHermes') &&
          packagerConfig.includes('true')
        ) {
          enableHermes = true;
          break;
        }
      }
    }
  } catch (e) {}
  return {
    enableHermes,
    crunchPngs,
  };
}

async function compileHermesByteCode(
  bundleName,
  outputFolder,
  sourcemapOutput,
  shouldCleanSourcemap,
) {
  console.log('Hermes enabled, now compiling to hermes bytecode:\n');
  // >= rn 0.69
  const rnDir = path.dirname(
    require.resolve('react-native', {
      paths: [process.cwd()],
    }),
  );
  let hermesPath = path.join(rnDir, `/sdks/hermesc/${getHermesOSBin()}`);

  // < rn 0.69
  if (!fs.existsSync(hermesPath)) {
    hermesPath = `node_modules/hermes-engine/${getHermesOSBin()}`;
  }

  const hermesCommand = `${hermesPath}/hermesc`;

  const args = [
    '-emit-binary',
    '-out',
    path.join(outputFolder, bundleName),
    path.join(outputFolder, bundleName),
    '-O',
  ];
  if (sourcemapOutput) {
    fs.copyFileSync(
      sourcemapOutput,
      path.join(outputFolder, `${bundleName}.txt.map`),
    );
    args.push('-output-source-map');
  }
  console.log(`Running hermesc: ${hermesCommand} ${args.join(' ')}`);
  spawnSync(hermesCommand, args, {
    stdio: 'ignore',
  });
  if (sourcemapOutput) {
    const composerPath =
      'node_modules/react-native/scripts/compose-source-maps.js';
    if (!fs.existsSync(composerPath)) {
      return;
    }
    console.log('Composing source map');
    spawnSync(
      'node',
      [
        composerPath,
        path.join(outputFolder, `${bundleName}.txt.map`),
        path.join(outputFolder, `${bundleName}.map`),
        '-o',
        sourcemapOutput,
      ],
      {
        stdio: 'ignore',
      },
    );
  }
  if (shouldCleanSourcemap) {
    fs.removeSync(path.join(outputFolder, `${bundleName}.txt.map`));
  }
}

async function copyDebugidForSentry(bundleName, outputFolder, sourcemapOutput) {
  if (sourcemapOutput) {
    const copyDebugidPath = require.resolve(
      '@sentry/react-native/scripts/copy-debugid.js',
      {
        paths: [process.cwd()],
      },
    );
    if (!fs.existsSync(copyDebugidPath)) {
      return;
    }
    console.log('Copying debugid');
    spawnSync(
      'node',
      [
        copyDebugidPath,
        path.join(outputFolder, `${bundleName}.txt.map`),
        path.join(outputFolder, `${bundleName}.map`),
      ],
      {
        stdio: 'ignore',
      },
    );
  }
  fs.removeSync(path.join(outputFolder, `${bundleName}.txt.map`));
}

async function uploadSourcemapForSentry(
  bundleName,
  outputFolder,
  sourcemapOutput,
) {
  if (sourcemapOutput) {
    const uploadSourcemapPath = require.resolve(
      '@sentry/cli/bin/sentry-cli',
      {
        paths: [process.cwd()],
      },
    );
    if (!fs.existsSync(uploadSourcemapPath)) {
      return;
    }
    console.log('Uploading sourcemap');
    spawnSync(
      'node',
      [
        uploadSourcemapPath,
        'sourcemaps',
        'upload',
        '--debug-id-reference',
        '--strip-prefix',
        path.join(process.cwd(), outputFolder),
        path.join(outputFolder, bundleName),
        path.join(outputFolder, `${bundleName}.map`),
      ],
      {
        stdio: 'ignore',
      },
    );
  }
  fs.removeSync(path.join(outputFolder, `${bundleName}.map`));
}

async function pack(dir, output) {
  console.log('Packing');
  fs.ensureDirSync(path.dirname(output));
  await new Promise((resolve, reject) => {
    const zipfile = new ZipFile();

    function addDirectory(root, rel) {
      if (rel) {
        zipfile.addEmptyDirectory(rel);
      }
      const childs = fs.readdirSync(root);
      for (const name of childs) {
        if (name === '.' || name === '..' || name === 'index.bundlejs.map') {
          continue;
        }
        const fullPath = path.join(root, name);
        const stat = fs.statSync(fullPath);
        if (stat.isFile()) {
          //console.log('adding: ' + rel+name);
          zipfile.addFile(fullPath, rel + name);
        } else if (stat.isDirectory()) {
          //console.log('adding: ' + rel+name+'/');
          addDirectory(fullPath, `${rel}${name}/`);
        }
      }
    }

    addDirectory(dir, '');

    zipfile.outputStream.on('error', (err) => reject(err));
    zipfile.outputStream.pipe(fs.createWriteStream(output)).on('close', () => {
      resolve();
    });
    zipfile.end();
  });
  console.log(`ppk热更包已生成并保存到: ${output}`);
}

export function readEntire(entry, zipFile) {
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
  return m?.[1];
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

      if (
        entry.fileName === 'index.bundlejs' ||
        entry.fileName === 'bundle.harmony.js'
      ) {
        // This is source.
        return readEntire(entry, zipFile).then((v) => (originSource = v));
      }
    }
  });

  if (!originSource) {
    throw new Error(
      'Bundle file not found! Please use default bundle file name and path.',
    );
  }

  const copies = {};

  const zipfile = new ZipFile();

  const writePromise = new Promise((resolve, reject) => {
    zipfile.outputStream.on('error', (err) => {
      throw err;
    });
    zipfile.outputStream.pipe(fs.createWriteStream(output)).on('close', () => {
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
    } else if (entry.fileName === 'bundle.harmony.js') {
      //console.log('Found bundle');
      return readEntire(entry, nextZipfile).then((newSource) => {
        //console.log('Begin diff');
        zipfile.addBuffer(
          diff(originSource, newSource),
          'bundle.harmony.js.patch',
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
        nextZipfile.openReadStream(entry, (err, readStream) => {
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

  for (const k in originEntries) {
    if (!newEntries[k]) {
      console.log(`Delete ${k}`);
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
      'Bundle file not found! Please use default bundle file name and path.',
    );
  }

  const copies = {};

  const zipfile = new ZipFile();

  const writePromise = new Promise((resolve, reject) => {
    zipfile.outputStream.on('error', (err) => {
      throw err;
    });
    zipfile.outputStream.pipe(fs.createWriteStream(output)).on('close', () => {
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
    } else if (entry.fileName === 'bundle.harmony.js') {
      //console.log('Found bundle');
      return readEntire(entry, nextZipfile).then((newSource) => {
        //console.log('Begin diff');
        zipfile.addBuffer(
          diff(originSource, newSource),
          'bundle.harmony.js.patch',
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
        nextZipfile.openReadStream(entry, (err, readStream) => {
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

export async function enumZipEntries(zipFn, callback, nestedPath = '') {
  return new Promise((resolve, reject) => {
    openZipFile(zipFn, { lazyEntries: true }, async (err, zipfile) => {
      if (err) {
        return reject(err);
      }

      zipfile.on('end', resolve);
      zipfile.on('error', reject);
      zipfile.on('entry', async (entry) => {
        const fullPath = nestedPath + entry.fileName;

        try {
          if (
            !entry.fileName.endsWith('/') &&
            entry.fileName.toLowerCase().endsWith('.hap')
          ) {
            const tempDir = path.join(os.tmpdir(), `nested_zip_${Date.now()}`);
            await fs.ensureDir(tempDir);
            const tempZipPath = path.join(tempDir, 'temp.zip');

            await new Promise((res, rej) => {
              zipfile.openReadStream(entry, async (err, readStream) => {
                if (err) return rej(err);
                const writeStream = fs.createWriteStream(tempZipPath);
                readStream.pipe(writeStream);
                writeStream.on('finish', res);
                writeStream.on('error', rej);
              });
            });

            await enumZipEntries(tempZipPath, callback, `${fullPath}/`);

            await fs.remove(tempDir);
          }

          const result = callback(entry, zipfile, fullPath);
          if (result && typeof result.then === 'function') {
            await result;
          }
        } catch (error) {
          console.error('处理文件时出错:', error);
        }

        zipfile.readEntry();
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
    realOutput: output.replace(/\$\{time\}/g, `${Date.now()}`),
  };
}

export const commands = {
  bundle: async function ({ options }) {
    const platform = checkPlatform(
      options.platform || (await question('平台(ios/android/harmony):')),
    );

    const { bundleName, entryFile, intermediaDir, output, dev } =
      translateOptions({
        ...options,
        platform,
      });

    const bundleParams = await checkPlugins();
    const sourcemap = bundleParams.sourcemap;

    const sourcemapOutput = path.join(intermediaDir, `${bundleName}.map`);

    const realOutput = output.replace(/\$\{time\}/g, `${Date.now()}`);

    if (!platform) {
      throw new Error('Platform must be specified.');
    }

    const { version, major, minor } = getRNVersion();

    console.log(`Bundling with react-native: ${version}`);

    await runReactNativeBundleCommand(
      bundleName,
      dev,
      entryFile,
      intermediaDir,
      platform,
      sourcemap ? sourcemapOutput : '',
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

  async hdiffFromApp({ args, options }) {
    const { origin, next, realOutput } = diffArgsCheck(
      args,
      options,
      'hdiffFromApp',
    );
    await diffFromPackage(
      origin,
      next,
      realOutput,
      'resources/rawfile/bundle.harmony.js',
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
      return m?.[1];
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
      return m?.[1];
    });

    console.log(`${realOutput} generated.`);
  },
};
