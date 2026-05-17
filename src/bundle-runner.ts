import { spawnSync } from 'child_process';
import { satisfies } from 'compare-versions';
import * as fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { t } from './utils/i18n';
import {
  getJavaScriptRuntime,
  spawnJavaScript,
  spawnJavaScriptSync,
} from './utils/runtime';

const g2js = require('gradle-to-js/lib/parser');
const properties = require('properties');

export interface BundleCliOptions {
  taro?: boolean;
  expo?: boolean;
  rncli?: boolean;
}

export interface RunBundleCommandOptions {
  bundleName: string;
  dev: string;
  entryFile: string;
  outputFolder: string;
  platform: string;
  sourcemapOutput: string;
  config?: string;
  forceHermes?: boolean;
  cli: BundleCliOptions;
  isSentry: boolean;
}

interface GradleConfig {
  crunchPngs?: boolean;
  enableHermes?: boolean;
}

const dependencyFields = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const;

type SyncProcessResult = {
  status: number | null;
  signal: NodeJS.Signals | null;
  error?: Error;
};

type ResolvedExpoCli = {
  cliPath: string;
  usingExpo: boolean;
};

export function hasProjectDependency(
  dependencyName: string,
  projectRoot = process.cwd(),
): boolean {
  try {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'),
    ) as Record<string, unknown>;

    return dependencyFields.some((field) => {
      const dependencies = packageJson[field];
      if (typeof dependencies !== 'object' || dependencies === null) {
        return false;
      }
      return dependencyName in dependencies;
    });
  } catch {
    return false;
  }
}

export function resolveExpoCli(projectRoot = process.cwd()): ResolvedExpoCli {
  if (!hasProjectDependency('expo', projectRoot)) {
    return {
      cliPath: '',
      usingExpo: false,
    };
  }

  try {
    const searchPaths = [projectRoot];

    try {
      const expoPackageJsonPath = require.resolve('expo/package.json', {
        paths: [projectRoot],
      });
      searchPaths.push(path.dirname(expoPackageJsonPath));
    } catch {
      // expo 包不存在，忽略
    }

    const cliPath = require.resolve('@expo/cli', {
      paths: searchPaths,
    });
    const expoCliVersion = JSON.parse(
      fs.readFileSync(
        require.resolve('@expo/cli/package.json', {
          paths: searchPaths,
        }),
        'utf8',
      ),
    ).version;

    if (!satisfies(expoCliVersion, '>= 0.10.17')) {
      return {
        cliPath: '',
        usingExpo: false,
      };
    }

    return {
      cliPath,
      usingExpo: true,
    };
  } catch {
    return {
      cliPath: '',
      usingExpo: false,
    };
  }
}

export async function runReactNativeBundleCommand({
  bundleName,
  dev,
  entryFile,
  outputFolder,
  platform,
  sourcemapOutput,
  config,
  forceHermes,
  cli,
  isSentry,
}: RunBundleCommandOptions): Promise<void> {
  let gradleConfig: GradleConfig = {};
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
    const resolvedExpoCli = resolveExpoCli();
    cliPath = resolvedExpoCli.cliPath;
    usingExpo = resolvedExpoCli.usingExpo;
  };

  const getRnCli = () => {
    try {
      cliPath = require.resolve('react-native/local-cli/cli.js', {
        paths: [process.cwd()],
      });
    } catch {
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
    } catch {
      // fallback 到 RN CLI
    }
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

  const jsRuntime = getJavaScriptRuntime();
  const reactNativeBundleProcess = spawnJavaScript(reactNativeBundleArgs);
  console.log(
    `Running bundle command: ${jsRuntime} ${reactNativeBundleArgs.join(' ')}`,
  );

  await new Promise<void>((resolve, reject) => {
    reactNativeBundleProcess.stdout.on('data', (data) => {
      console.log(data.toString().trim());
    });

    reactNativeBundleProcess.stderr.on('data', (data) => {
      console.error(data.toString().trim());
    });

    reactNativeBundleProcess.on('close', async (exitCode) => {
      if (exitCode) {
        reject(new Error(t('bundleCommandError', { code: exitCode })));
        return;
      }

      let hermesEnabled: boolean | undefined = false;

      if (forceHermes) {
        hermesEnabled = true;
        console.log(t('forceHermes'));
      } else if (platform === 'android') {
        const gradleProperties = await new Promise<{ hermesEnabled?: boolean }>(
          (resolve) => {
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
                  return;
                }
                resolve(props);
              },
            );
          },
        );
        hermesEnabled = gradleProperties.hermesEnabled;

        if (typeof hermesEnabled !== 'boolean') {
          hermesEnabled = gradleConfig.enableHermes;
        }
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
        fs.ensureDirSync(harmonyRawAssetsPath);
        fs.copySync(outputFolder, harmonyRawAssetsPath, { overwrite: true });
        fs.moveSync(
          `${harmonyRawAssetsPath}/bundle.harmony.js`,
          `${harmonyRawAssetsPath}/../bundle.harmony.js`,
          { overwrite: true },
        );
      }

      resolve();
    });
  });
}

function getHermesOSBin() {
  if (os.platform() === 'win32') return 'win64-bin';
  if (os.platform() === 'darwin') return 'osx-bin';
  if (os.platform() === 'linux') return 'linux64-bin';
}

function getHermesExecutableName() {
  return os.platform() === 'win32' ? 'hermesc.exe' : 'hermesc';
}

function dirnameOfPackage(
  packageJsonPath: string,
  projectRoot = process.cwd(),
) {
  return path.dirname(
    require.resolve(packageJsonPath, {
      paths: [projectRoot],
    }),
  );
}

function assertSuccessfulSyncProcess(
  result: SyncProcessResult,
  command: string,
) {
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `${command} failed with ${
        result.status === null
          ? `signal ${result.signal}`
          : `exit code ${result.status}`
      }`,
    );
  }
}

export function resolveHermesCommand(projectRoot = process.cwd()): string {
  const osBin = getHermesOSBin();
  if (!osBin) {
    throw new Error(`Unsupported platform for Hermes: ${os.platform()}`);
  }

  const executableName = getHermesExecutableName();
  const candidates: string[] = [];

  try {
    const rnDir = dirnameOfPackage('react-native/package.json', projectRoot);
    candidates.push(path.join(rnDir, 'sdks', 'hermesc', osBin, executableName));
  } catch {
    // react-native is required for normal RN projects; keep looking so the
    // final error can include all candidates we were able to infer.
  }

  try {
    const hermesCompilerDir = dirnameOfPackage(
      'hermes-compiler/package.json',
      projectRoot,
    );
    candidates.push(
      path.join(hermesCompilerDir, 'hermesc', osBin, executableName),
    );
  } catch {
    // RN 0.85+ uses hermes-compiler, older projects may still use other paths.
  }

  try {
    const hermesEngineDir = dirnameOfPackage(
      'hermes-engine/package.json',
      projectRoot,
    );
    candidates.push(
      path.join(hermesEngineDir, osBin, executableName),
      path.join(hermesEngineDir, 'hermesc', osBin, executableName),
    );
  } catch {
    // RN 0.70-era projects commonly used hermes-engine; optional for newer RN.
  }

  const hermesCommand = candidates.find((candidate) =>
    fs.existsSync(candidate),
  );
  if (hermesCommand) {
    return hermesCommand;
  }

  throw new Error(
    `Cannot find hermesc. Tried:\n${candidates.map((candidate) => `- ${candidate}`).join('\n')}`,
  );
}

async function checkGradleConfig(): Promise<GradleConfig> {
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
  } catch {
    // ignore parsing failures
  }
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
  const hermesCommand = resolveHermesCommand();

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
  assertSuccessfulSyncProcess(
    spawnSync(hermesCommand, args, {
      stdio: 'ignore',
    }),
    hermesCommand,
  );
  if (sourcemapOutput) {
    const composerPath =
      'node_modules/react-native/scripts/compose-source-maps.js';
    if (!fs.existsSync(composerPath)) {
      return;
    }
    console.log(t('composingSourceMap'));
    assertSuccessfulSyncProcess(
      spawnJavaScriptSync(
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
      ),
      composerPath,
    );
  }
  if (shouldCleanSourcemap) {
    fs.removeSync(path.join(outputFolder, `${bundleName}.txt.map`));
  }
}

export async function copyDebugidForSentry(
  bundleName: string,
  outputFolder: string,
  sourcemapOutput: string,
): Promise<void> {
  if (sourcemapOutput) {
    let copyDebugidPath: string | undefined;
    try {
      copyDebugidPath = require.resolve(
        '@sentry/react-native/scripts/copy-debugid.js',
        {
          paths: [process.cwd()],
        },
      );
    } catch {
      console.error(t('sentryCliNotFound'));
      return;
    }

    if (!fs.existsSync(copyDebugidPath)) {
      return;
    }
    console.log(t('copyingDebugId'));
    assertSuccessfulSyncProcess(
      spawnJavaScriptSync(
        [
          copyDebugidPath,
          path.join(outputFolder, `${bundleName}.txt.map`),
          path.join(outputFolder, `${bundleName}.map`),
        ],
        {
          stdio: 'ignore',
        },
      ),
      copyDebugidPath,
    );
  }
  fs.removeSync(path.join(outputFolder, `${bundleName}.txt.map`));
}

export async function uploadSourcemapForSentry(
  bundleName: string,
  outputFolder: string,
  sourcemapOutput: string,
  version: string,
): Promise<void> {
  if (!sourcemapOutput) {
    return;
  }

  let sentryCliPath: string | undefined;
  try {
    sentryCliPath = require.resolve('@sentry/cli/bin/sentry-cli', {
      paths: [process.cwd()],
    });
  } catch {
    console.error(t('sentryCliNotFound'));
    return;
  }

  if (!fs.existsSync(sentryCliPath)) {
    return;
  }

  assertSuccessfulSyncProcess(
    spawnJavaScriptSync(
      [sentryCliPath, 'releases', 'set-commits', version, '--auto'],
      {
        stdio: 'inherit',
      },
    ),
    sentryCliPath,
  );
  console.log(t('sentryReleaseCreated', { version }));

  console.log(t('uploadingSourcemap'));
  assertSuccessfulSyncProcess(
    spawnJavaScriptSync(
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
    ),
    sentryCliPath,
  );
}
