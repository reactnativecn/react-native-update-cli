import path from 'path';
import { translateOptions } from './utils';
import * as fs from 'fs-extra';
import { ZipFile as YazlZipFile } from 'yazl';
import {
  type Entry,
  open as openZipFile,
  type ZipFile as YauzlZipFile,
} from 'yauzl';
import { question, checkPlugins } from './utils';
import { getPlatform } from './app';
import { spawn, spawnSync } from 'child_process';
import { satisfies } from 'compare-versions';
const g2js = require('gradle-to-js/lib/parser');
import os from 'os';
const properties = require('properties');
import { depVersions } from './utils/dep-versions';
import { t } from './utils/i18n';
import { tempDir } from './utils/constants';
import { checkLockFiles } from './utils/check-lockfile';
import { addGitIgnore } from './utils/add-gitignore';
import { commands as versionCommands } from './versions';

type Diff = (oldSource?: Buffer, newSource?: Buffer) => Buffer;

let bsdiff: Diff;
let hdiff: Diff;
let diff: Diff;
try {
  bsdiff = require('node-bsdiff').diff;
} catch (e) {}

try {
  hdiff = require('node-hdiffpatch').diff;
} catch (e) {}

async function runReactNativeBundleCommand({
  bundleName,
  dev,
  entryFile,
  outputFolder,
  platform,
  sourcemapOutput,
  config,
  disableHermes,
  cli,
}: {
  bundleName: string;
  dev: string;
  entryFile: string;
  outputFolder: string;
  platform: string;
  sourcemapOutput: string;
  config?: string;
  disableHermes?: boolean;
  cli: {
    taro?: boolean;
    expo?: boolean;
    rncli?: boolean;
  };
}) {
  let gradleConfig: {
    crunchPngs?: boolean;
    enableHermes?: boolean;
  } = {};
  if (platform === 'android') {
    gradleConfig = await checkGradleConfig();
    if (gradleConfig.crunchPngs !== false) {
      console.warn(t('androidCrunchPngsWarning'));
    }
  }

  const reactNativeBundleArgs: string[] = [];

  const envArgs = process.env.PUSHY_ENV_ARGS;

  if (envArgs) {
    Array.prototype.push.apply(
      reactNativeBundleArgs,
      envArgs.trim().split(/\s+/),
    );
  }

  fs.emptyDirSync(outputFolder);

  let cliPath: string | undefined;
  let usingExpo = false;

  const getExpoCli = () => {
    try {
      cliPath = require.resolve('@expo/cli', {
        paths: [process.cwd()],
      });
      const expoCliVersion = JSON.parse(
        fs
          .readFileSync(
            require.resolve('@expo/cli/package.json', {
              paths: [process.cwd()],
            }),
          )
          .toString(),
      ).version;
      // expo cli 0.10.17 (expo 49) 开始支持 bundle:embed
      if (satisfies(expoCliVersion, '>= 0.10.17')) {
        usingExpo = true;
      } else {
        cliPath = undefined;
      }
    } catch (e) {}
  };

  const getRnCli = () => {
    try {
      // rn < 0.75
      cliPath = require.resolve('react-native/local-cli/cli.js', {
        paths: [process.cwd()],
      });
    } catch (e) {
      // rn >= 0.75
      cliPath = require.resolve('@react-native-community/cli/build/bin.js', {
        paths: [process.cwd()],
      });
    }
  };

  const getTaroCli = () => {
    try {
      cliPath = require.resolve('@tarojs/cli/bin/taro', {
        paths: [process.cwd()],
      });
    } catch (e) {}
  };

  if (cli.expo) {
    getExpoCli();
  } else if (cli.taro) {
    getTaroCli();
  } else if (cli.rncli) {
    getRnCli();
  }

  if (!cliPath) {
    getExpoCli();
    if (!usingExpo) {
      getRnCli();
    }
  }

  const bundleParams = await checkPlugins();
  const isSentry = bundleParams.sentry;

  let bundleCommand = 'bundle';
  if (usingExpo) {
    bundleCommand = 'export:embed';
  } else if (platform === 'harmony') {
    bundleCommand = 'bundle-harmony';
  } else if (cli.taro) {
    bundleCommand = 'build';
  }

  if (platform === 'harmony') {
    Array.prototype.push.apply(reactNativeBundleArgs, [
      cliPath,
      bundleCommand,
      '--dev',
      dev,
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
      '--platform',
      platform,
      '--reset-cache',
    ]);

    if (cli.taro) {
      reactNativeBundleArgs.push(...['--type', 'rn']);
    } else {
      reactNativeBundleArgs.push(...['--dev', dev, '--entry-file', entryFile]);
    }

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
        reject(new Error(t('bundleCommandError', { code: exitCode })));
      } else {
        let hermesEnabled: boolean | undefined = false;

        if (disableHermes) {
          hermesEnabled = false;
          console.log(t('hermesDisabled'));
        } else if (platform === 'android') {
          const gradlePropeties = await new Promise<{
            hermesEnabled?: boolean;
          }>((resolve) => {
            properties.parse(
              './android/gradle.properties',
              { path: true },
              (error: any, props: { hermesEnabled?: boolean }) => {
                if (error) {
                  console.error(error);
                  resolve({});
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
        }
        resolve(null);
      }
    });
  });
}

async function copyHarmonyBundle(outputFolder: string) {
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
  } catch (error: any) {
    console.error(t('copyHarmonyBundleError', { error }));
    throw new Error(t('copyFileFailed', { error: error.message }));
  }
}

function getHermesOSBin() {
  if (os.platform() === 'win32') return 'win64-bin';
  if (os.platform() === 'darwin') return 'osx-bin';
  if (os.platform() === 'linux') return 'linux64-bin';
}

async function checkGradleConfig() {
  let enableHermes = false;
  let crunchPngs: boolean | undefined;
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
  bundleName: string,
  outputFolder: string,
  sourcemapOutput: string,
  shouldCleanSourcemap: boolean,
) {
  console.log(t('hermesEnabledCompiling'));
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
  console.log(
    t('runningHermesc', { command: hermesCommand, args: args.join(' ') }),
  );
  spawnSync(hermesCommand, args, {
    stdio: 'ignore',
  });
  if (sourcemapOutput) {
    const composerPath =
      'node_modules/react-native/scripts/compose-source-maps.js';
    if (!fs.existsSync(composerPath)) {
      return;
    }
    console.log(t('composingSourceMap'));
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

async function copyDebugidForSentry(
  bundleName: string,
  outputFolder: string,
  sourcemapOutput: string,
) {
  if (sourcemapOutput) {
    let copyDebugidPath: string | undefined;
    try {
      copyDebugidPath = require.resolve(
        '@sentry/react-native/scripts/copy-debugid.js',
        {
          paths: [process.cwd()],
        },
      );
    } catch (error) {
      console.error(t('sentryCliNotFound'));
      return;
    }

    if (!fs.existsSync(copyDebugidPath)) {
      return;
    }
    console.log(t('copyingDebugId'));
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
  bundleName: string,
  outputFolder: string,
  sourcemapOutput: string,
  version: string,
) {
  if (sourcemapOutput) {
    let sentryCliPath: string | undefined;
    try {
      sentryCliPath = require.resolve('@sentry/cli/bin/sentry-cli', {
        paths: [process.cwd()],
      });
    } catch (error) {
      console.error(t('sentryCliNotFound'));
      return;
    }

    if (!fs.existsSync(sentryCliPath)) {
      return;
    }

    spawnSync(
      'node',
      [sentryCliPath, 'releases', 'set-commits', version, '--auto'],
      {
        stdio: 'inherit',
      },
    );
    console.log(t('sentryReleaseCreated', { version }));

    console.log(t('uploadingSourcemap'));
    spawnSync(
      'node',
      [
        sentryCliPath,
        'releases',
        'files',
        version,
        'upload-sourcemaps',
        '--strip-prefix',
        path.join(process.cwd(), outputFolder),
        path.join(outputFolder, bundleName),
        path.join(outputFolder, `${bundleName}.map`),
      ],
      {
        stdio: 'inherit',
      },
    );
  }
}

const ignorePackingFileNames = ['.', '..', 'index.bundlejs.map'];
const ignorePackingExtensions = ['DS_Store', 'txt.map'];
async function pack(dir: string, output: string) {
  console.log(t('packing'));
  fs.ensureDirSync(path.dirname(output));
  await new Promise<void>((resolve, reject) => {
    const zipfile = new YazlZipFile();

    function addDirectory(root: string, rel: string) {
      if (rel) {
        zipfile.addEmptyDirectory(rel);
      }
      const childs = fs.readdirSync(root);
      for (const name of childs) {
        if (
          ignorePackingFileNames.includes(name) ||
          ignorePackingExtensions.some((ext) => name.endsWith(`.${ext}`))
        ) {
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

    zipfile.outputStream.on('error', (err: any) => reject(err));
    zipfile.outputStream.pipe(fs.createWriteStream(output)).on('close', () => {
      resolve();
    });
    zipfile.end();
  });
  console.log(t('fileGenerated', { file: output }));
}

export function readEntry(
  entry: Entry,
  zipFile: YauzlZipFile,
): Promise<Buffer> {
  const buffers: Buffer[] = [];
  return new Promise((resolve, reject) => {
    zipFile.openReadStream(entry, (err, stream) => {
      stream.pipe({
        write(chunk: Buffer) {
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

function basename(fn: string) {
  const m = /^(.+\/)[^\/]+\/?$/.exec(fn);
  return m?.[1];
}

async function diffFromPPKInternal(origin: string, next: string, output: string, diffAlgorithm?: Diff) {
  fs.ensureDirSync(path.dirname(output));

  const selectedDiff = diffAlgorithm || diff; // Use provided algorithm or global 'diff'

  if (!selectedDiff && !bsdiff) {
    throw new Error(
      `Diff algorithm not specified and bsdiff is not available. Please install "node-bsdiff".`,
    );
  }
  const currentDiffTool = selectedDiff || bsdiff; // Default to bsdiff if global 'diff' is not set


  const originEntries = {};
  const originMap = {};

  let originSource: Buffer | undefined;

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
        return readEntry(entry, zipFile).then((v) => (originSource = v));
      }
    }
  });

  if (!originSource) {
    throw new Error(
      'Bundle file not found! Please use default bundle file name and path.',
    );
  }

  const copies = {};

  const zipfile = new YazlZipFile();

  const writePromise = new Promise((resolve, reject) => {
    zipfile.outputStream.on('error', (err) => {
      throw err;
    });
    zipfile.outputStream.pipe(fs.createWriteStream(output)).on('close', () => {
      resolve();
    });
  });

  const addedEntry = {};

  function addEntry(fn: string) {
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
      return readEntry(entry, nextZipfile).then((newSource) => {
        //console.log('Begin diff');
        zipfile.addBuffer(
          currentDiffTool(originSource, newSource),
          'index.bundlejs.patch',
        );
        //console.log('End diff');
      });
    } else if (entry.fileName === 'bundle.harmony.js') {
      //console.log('Found bundle');
      return readEntry(entry, nextZipfile).then((newSource) => {
        //console.log('Begin diff');
        zipfile.addBuffer(
          currentDiffTool(originSource, newSource),
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
      console.log(t('deleteFile', { file: k }));
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
  origin: string,
  next: string,
  output: string,
  originBundleName: string,
  transformPackagePath = (v: string) => v,
) {
  fs.ensureDirSync(path.dirname(output));

  const originEntries = {};
  const originMap = {};

  let originSource: Buffer | undefined;

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
        return readEntry(entry, zipFile).then((v) => (originSource = v));
      }
    }
  });

  if (!originSource) {
    throw new Error(
      'Bundle file not found! Please use default bundle file name and path.',
    );
  }

  const copies = {};

  const zipfile = new YazlZipFile();

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
      return readEntry(entry, nextZipfile).then((newSource) => {
        //console.log('Begin diff');
        zipfile.addBuffer(
          diff(originSource, newSource),
          'index.bundlejs.patch',
        );
        //console.log('End diff');
      });
    } else if (entry.fileName === 'bundle.harmony.js') {
      //console.log('Found bundle');
      return readEntry(entry, nextZipfile).then((newSource) => {
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

export async function enumZipEntries(
  zipFn: string,
  callback: (
    entry: Entry,
    zipFile: YauzlZipFile,
    nestedPath?: string,
  ) => Promise<any>,
  nestedPath = '',
) {
  return new Promise((resolve, reject) => {
    openZipFile(
      zipFn,
      { lazyEntries: true },
      async (err: any, zipfile: YauzlZipFile) => {
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
              const tempDir = path.join(
                os.tmpdir(),
                `nested_zip_${Date.now()}`,
              );
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
            console.error(t('processingError', { error }));
          }

          zipfile.readEntry();
        });

        zipfile.readEntry();
      },
    );
  });
}

function diffArgsCheck(args: string[], options: any, diffFn: string) {
  const [origin, next] = args;

  if (!origin || !next) {
    console.error(t('usageDiff', { command: diffFn }));
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

export async function diffFromPPK(origin: string, next: string, output: string, diffAlgorithm?: 'bsdiff' | 'hdiff') {
  let selectedDiffTool: Diff;
  if (diffAlgorithm === 'hdiff') {
    if (!hdiff) throw new Error('hdiff is not available. Please install node-hdiffpatch.');
    selectedDiffTool = hdiff;
  } else { // Default to bsdiff
    if (!bsdiff) throw new Error('bsdiff is not available. Please install node-bsdiff.');
    selectedDiffTool = bsdiff;
  }
  // The global 'diff' variable is not used here to avoid side effects from other commands.
  return diffFromPPKInternal(origin, next, output, selectedDiffTool);
}

export const commands = {
  bundle: async ({ options }) => {
    const platform = await getPlatform(options.platform);

    // Ensure packageVersion is also translated or retrieved if available in options
    const translatedOpts = translateOptions({
      ...options, // Original options which might include packageVersion
      tempDir,
      platform,
    });

    const {
      bundleName,
      entryFile,
      intermediaDir,
      output,
      dev,
      sourcemap,
      taro,
      expo,
      rncli,
      disableHermes,
      name,            // For bundle naming and publish
      description,     // For publish
      metaInfo,        // For publish
    } = translatedOpts;
    
    // packageVersion for publish should be taken from original options if translateOptions doesn't handle it for bundle
    const packageVersion = options.packageVersion;


    checkLockFiles();
    addGitIgnore();

    const bundleParams = await checkPlugins();
    const sourcemapPlugin = bundleParams.sourcemap;
    const isSentry = bundleParams.sentry;

    const sourcemapOutput = path.join(intermediaDir, `${bundleName}.map`);

    const realOutput = output.replace(/\$\{time\}/g, `${Date.now()}`);

    if (!platform) {
      throw new Error(t('platformRequired'));
    }

    console.log(`Bundling with react-native: ${depVersions['react-native']}`);

    await runReactNativeBundleCommand({
      bundleName,
      dev,
      entryFile,
      outputFolder: intermediaDir,
      platform,
      sourcemapOutput: sourcemap || sourcemapPlugin ? sourcemapOutput : '',
      disableHermes,
      cli: {
        taro,
        expo,
        rncli,
      },
    });

    await pack(path.resolve(intermediaDir), realOutput);

    if (name) { // If name is provided, publish automatically
      const publishOptions: any = { // Type according to what versions.publish expects
        platform,
        name,
        description,
        metaInfo,
      };
      if (packageVersion) {
        publishOptions.packageVersion = packageVersion;
      }

      const versionName = await versionCommands.publish({
        args: [realOutput],
        options: publishOptions,
      });

      if (isSentry) {
        await copyDebugidForSentry(bundleName, intermediaDir, sourcemapOutput);
        await uploadSourcemapForSentry(
          bundleName,
          intermediaDir,
          sourcemapOutput,
          versionName,
        );
      }
    } else if (!options['no-interactive']) { // If name is not provided, retain old prompt behavior
      const v = await question(t('uploadBundlePrompt'));
      if (v.toLowerCase() === 'y') {
        const publishOptions: any = { platform };
        if (packageVersion) { // Also consider packageVersion if prompting
            publishOptions.packageVersion = packageVersion;
        }
        // name, description, metaInfo will be prompted by versionCommands.publish if not provided
        const versionName = await versionCommands.publish({
          args: [realOutput],
          options: publishOptions,
        });
        if (isSentry) {
          await copyDebugidForSentry(
            bundleName,
            intermediaDir,
            sourcemapOutput,
          );
          await uploadSourcemapForSentry(
            bundleName,
            intermediaDir,
            sourcemapOutput,
            versionName,
          );
        }
      }
    }
  },

  async diff({ args, options }) {
    const { origin, next, realOutput } = diffArgsCheck(args, options, 'diff');
    // diffArgsCheck sets the global 'diff' variable to bsdiff
    // diffFromPPKInternal will use the global 'diff' if no algorithm is passed.
    await diffFromPPKInternal(origin, next, realOutput); 
    console.log(`${realOutput} generated.`);
  },

  async hdiff({ args, options }) {
    const { origin, next, realOutput } = diffArgsCheck(args, options, 'hdiff');
    // diffArgsCheck sets the global 'diff' variable to hdiff
    await diffFromPPKInternal(origin, next, realOutput);
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
