import { spawn, spawnSync } from 'child_process';
import path from 'path';
import { satisfies } from 'compare-versions';
import * as fs from 'fs-extra';
import { ZipFile as YazlZipFile } from 'yazl';
import { getPlatform } from './app';
import { translateOptions } from './utils';
import { checkPlugins, question } from './utils';
const g2js = require('gradle-to-js/lib/parser');
const properties = require('properties');
import os from 'os';
import { addGitIgnore } from './utils/add-gitignore';
import { checkLockFiles } from './utils/check-lockfile';
import { tempDir } from './utils/constants';
import { depVersions } from './utils/dep-versions';
import { t } from './utils/i18n';
import { versionCommands } from './versions';

async function runReactNativeBundleCommand({
  bundleName,
  dev,
  entryFile,
  outputFolder,
  platform,
  sourcemapOutput,
  config,
  forceHermes,
  cli,
}: {
  bundleName: string;
  dev: string;
  entryFile: string;
  outputFolder: string;
  platform: string;
  sourcemapOutput: string;
  config?: string;
  forceHermes?: boolean;
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
    reactNativeBundleArgs.push(...envArgs.trim().split(/\s+/));
  }

  fs.emptyDirSync(outputFolder);

  let cliPath = '';
  let usingExpo = false;

  const getExpoCli = () => {
    try {
      const searchPaths = [process.cwd()];

      // 尝试添加 expo 包的路径作为额外的搜索路径
      try {
        const expoPath = require.resolve('expo/package.json', {
          paths: [process.cwd()],
        });
        // 获取 expo 包的目录路径
        const expoDir = expoPath.replace(/\/package\.json$/, '');
        searchPaths.push(expoDir);
      } catch {
        // expo 包不存在，忽略
      }

      // 尝试从搜索路径中解析 @expo/cli
      cliPath = require.resolve('@expo/cli', {
        paths: searchPaths,
      });

      const expoCliVersion = JSON.parse(
        fs
          .readFileSync(
            require.resolve('@expo/cli/package.json', {
              paths: searchPaths,
            }),
          )
          .toString(),
      ).version;
      // expo cli 0.10.17 (expo 49) 开始支持 bundle:embed
      if (satisfies(expoCliVersion, '>= 0.10.17')) {
        usingExpo = true;
      } else {
        cliPath = '';
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

  if (isSentry) {
    if (platform === 'ios') {
      process.env.SENTRY_PROPERTIES = 'ios/sentry.properties';
    } else if (platform === 'android') {
      process.env.SENTRY_PROPERTIES = 'android/sentry.properties';
    }
  }

  let bundleCommand = 'bundle';
  if (usingExpo) {
    bundleCommand = 'export:embed';
  } else if (platform === 'harmony') {
    bundleCommand = 'bundle-harmony';
  } else if (cli.taro) {
    bundleCommand = 'build';
  }

  if (platform === 'harmony') {
    bundleName = 'bundle.harmony.js';
    if (forceHermes === undefined) {
      // enable hermes by default for harmony
      forceHermes = true;
    }
  }

  reactNativeBundleArgs.push(
    cliPath,
    bundleCommand,
    '--assets-dest',
    outputFolder,
    '--bundle-output',
    path.join(outputFolder, bundleName),
  );

  if (platform !== 'harmony') {
    reactNativeBundleArgs.push('--platform', platform, '--reset-cache');
  }

  if (cli.taro) {
    reactNativeBundleArgs.push('--type', 'rn');
  } else {
    reactNativeBundleArgs.push('--dev', dev, '--entry-file', entryFile);
  }

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
        reject(new Error(t('bundleCommandError', { code: exitCode })));
      } else {
        let hermesEnabled: boolean | undefined = false;

        if (forceHermes) {
          hermesEnabled = true;
          console.log(t('forceHermes'));
        } else if (platform === 'android') {
          const gradlePropeties = await new Promise<{
            hermesEnabled?: boolean;
          }>((resolve) => {
            properties.parse(
              './android/gradle.properties',
              { path: true },
              (
                error: Error | null,
                props: { hermesEnabled?: boolean } = {},
              ) => {
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
        }
        if (hermesEnabled) {
          await compileHermesByteCode(
            bundleName,
            outputFolder,
            sourcemapOutput,
            !isSentry,
          );
        }
        if (platform === 'harmony') {
          const harmonyRawAssetsPath =
            'harmony/entry/src/main/resources/rawfile/assets';
          // copy all files in outputFolder to harmonyRawPath
          // assets should be in rawfile/assets
          fs.ensureDirSync(harmonyRawAssetsPath);
          fs.copySync(outputFolder, harmonyRawAssetsPath, { overwrite: true });
          fs.moveSync(
            `${harmonyRawAssetsPath}/bundle.harmony.js`,
            `${harmonyRawAssetsPath}/../bundle.harmony.js`,
            { overwrite: true },
          );
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

const ignorePackingFileNames = [
  '.',
  '..',
  'index.bundlejs.map',
  'bundle.harmony.js.map',
];
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

    zipfile.outputStream.on('error', (err: unknown) => reject(err));
    zipfile.outputStream.pipe(fs.createWriteStream(output)).on('close', () => {
      resolve(void 0);
    });
    zipfile.end();
  });
  console.log(t('fileGenerated', { file: output }));
}

function getBooleanOption(
  options: Record<string, unknown>,
  key: string,
  fallback = false,
): boolean {
  const value = options[key];
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    return value.toLowerCase() === 'true';
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  return fallback;
}

function getStringOption(
  options: Record<string, unknown>,
  key: string,
  fallback = '',
): string {
  const value = options[key];
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return fallback;
}

function getOptionalStringOption(
  options: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = options[key];
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return undefined;
}

export const bundleCommands = {
  bundle: async ({
    options,
  }: {
    args?: string[];
    options: Record<string, unknown>;
  }) => {
    const platform = await getPlatform(
      typeof options.platform === 'string' ? options.platform : undefined,
    );

    const translatedOptions = translateOptions({
      ...options,
      tempDir,
      platform,
    });
    const bundleName = getStringOption(
      translatedOptions,
      'bundleName',
      'index.bundlejs',
    );
    const entryFile = getStringOption(
      translatedOptions,
      'entryFile',
      'index.js',
    );
    const intermediaDir = getStringOption(
      translatedOptions,
      'intermediaDir',
      `${tempDir}/intermedia/${platform}`,
    );
    const output = getStringOption(
      translatedOptions,
      'output',
      `${tempDir}/output/${platform}.${Date.now()}.ppk`,
    );
    const dev = getBooleanOption(translatedOptions, 'dev', false)
      ? 'true'
      : 'false';
    const sourcemap = getBooleanOption(translatedOptions, 'sourcemap', false);
    const taro = getBooleanOption(translatedOptions, 'taro', false);
    const expo = getBooleanOption(translatedOptions, 'expo', false);
    const rncli = getBooleanOption(translatedOptions, 'rncli', false);
    const hermes = getBooleanOption(translatedOptions, 'hermes', false);
    const name = getOptionalStringOption(translatedOptions, 'name');
    const description = getOptionalStringOption(
      translatedOptions,
      'description',
    );
    const metaInfo = getOptionalStringOption(translatedOptions, 'metaInfo');
    const packageId = getOptionalStringOption(translatedOptions, 'packageId');
    const packageVersion = getOptionalStringOption(
      translatedOptions,
      'packageVersion',
    );
    const minPackageVersion = getOptionalStringOption(
      translatedOptions,
      'minPackageVersion',
    );
    const maxPackageVersion = getOptionalStringOption(
      translatedOptions,
      'maxPackageVersion',
    );
    const packageVersionRange = getOptionalStringOption(
      translatedOptions,
      'packageVersionRange',
    );
    const rollout = getOptionalStringOption(translatedOptions, 'rollout');
    const dryRun = getBooleanOption(translatedOptions, 'dryRun', false);

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
      forceHermes: hermes,
      cli: {
        taro,
        expo,
        rncli,
      },
    });

    await pack(path.resolve(intermediaDir), realOutput);

    if (name) {
      const versionName = await versionCommands.publish({
        args: [realOutput],
        options: {
          platform,
          name,
          description,
          metaInfo,
          packageId,
          packageVersion,
          minPackageVersion,
          maxPackageVersion,
          packageVersionRange,
          rollout,
          dryRun: Boolean(dryRun),
        },
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
    } else if (!getBooleanOption(options, 'no-interactive', false)) {
      const v = await question(t('uploadBundlePrompt'));
      if (v.toLowerCase() === 'y') {
        const versionName = await versionCommands.publish({
          args: [realOutput],
          options: {
            platform,
          },
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
};
