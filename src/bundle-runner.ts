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

type SentryUploadArtifacts = {
  bundlePath: string;
  sourcemapPath: string;
};

type BuildSentrySourcemapsUploadArgsOptions = {
  sentryCliPath: string;
  bundlePath: string;
  sourcemapPath: string;
  release?: string;
  dist?: string;
  stripPrefix?: string;
  debugIdReference?: boolean;
  useStandaloneSourcemapsCommand?: boolean;
};

const ANDROID_SENTRY_BUNDLE_NAME = 'index.android.bundle';

export interface SentryUploadOptions {
  sentryRelease?: string;
  sentryDist?: string;
}

type SentryUploadMode =
  | {
      type: 'debug-id';
      debugId: string;
    }
  | {
      type: 'release';
      release: string;
      dist?: string;
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
    } else if (
      platform === 'harmony' &&
      fs.existsSync('harmony/sentry.properties')
    ) {
      process.env.SENTRY_PROPERTIES = 'harmony/sentry.properties';
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

    reactNativeBundleProcess.once('error', reject);

    reactNativeBundleProcess.on('close', async (exitCode) => {
      if (exitCode) {
        reject(new Error(t('bundleCommandError', { code: exitCode })));
        return;
      }

      try {
        let hermesEnabled: boolean | undefined = false;

        if (forceHermes) {
          hermesEnabled = true;
          console.log(t('forceHermes'));
        } else if (platform === 'android') {
          const gradleProperties = await new Promise<{
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
                  return;
                }
                resolve(props);
              },
            );
          });
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
          fs.copySync(outputFolder, harmonyRawAssetsPath, {
            overwrite: true,
            // sourcemaps must not ship inside the native package
            filter: (src) => !src.endsWith('.map'),
          });
          fs.moveSync(
            `${harmonyRawAssetsPath}/bundle.harmony.js`,
            `${harmonyRawAssetsPath}/../bundle.harmony.js`,
            { overwrite: true },
          );
        }

        resolve();
      } catch (error) {
        reject(error);
      }
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

function normalizeString(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
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
    let composerPath: string;
    try {
      // resolve through the project so hoisted node_modules (monorepos) work
      composerPath = require.resolve(
        'react-native/scripts/compose-source-maps.js',
        { paths: [process.cwd()] },
      );
    } catch {
      console.warn(t('composeSourceMapsNotFound'));
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
      console.error(t('sentryReactNativeNotFound'));
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

export async function prepareSentryUploadArtifacts(
  bundleName: string,
  outputFolder: string,
  platform: string,
): Promise<SentryUploadArtifacts> {
  const bundlePath = path.join(outputFolder, bundleName);
  const sourcemapPath = path.join(outputFolder, `${bundleName}.map`);

  if (platform !== 'android' || bundleName === ANDROID_SENTRY_BUNDLE_NAME) {
    return {
      bundlePath,
      sourcemapPath,
    };
  }

  const androidBundlePath = path.join(outputFolder, ANDROID_SENTRY_BUNDLE_NAME);
  const androidSourcemapPath = path.join(
    outputFolder,
    `${ANDROID_SENTRY_BUNDLE_NAME}.map`,
  );
  await fs.promises.copyFile(bundlePath, androidBundlePath);

  const sourcemap = JSON.parse(
    await fs.promises.readFile(sourcemapPath, 'utf8'),
  ) as Record<string, unknown>;
  sourcemap.file = ANDROID_SENTRY_BUNDLE_NAME;
  await fs.promises.writeFile(androidSourcemapPath, JSON.stringify(sourcemap));

  return {
    bundlePath: androidBundlePath,
    sourcemapPath: androidSourcemapPath,
  };
}

export async function readSourcemapDebugId(
  sourcemapPath: string,
): Promise<string | undefined> {
  try {
    const sourcemap = JSON.parse(
      await fs.promises.readFile(sourcemapPath, 'utf8'),
    ) as Record<string, unknown>;
    const debugId = sourcemap.debugId ?? sourcemap.debug_id;
    return typeof debugId === 'string' ? normalizeString(debugId) : undefined;
  } catch {
    return undefined;
  }
}

function resolveSentryReleaseFromValues(
  releaseValue: string | undefined,
  distValue: string | undefined,
): { release: string; dist?: string } | undefined {
  const release = normalizeString(releaseValue);
  if (!release) {
    return undefined;
  }
  return {
    release,
    dist: normalizeString(distValue),
  };
}

export async function resolveSentryUploadMode(
  sourcemapPath: string,
  options: SentryUploadOptions = {},
): Promise<SentryUploadMode> {
  const optionRelease = resolveSentryReleaseFromValues(
    options.sentryRelease,
    options.sentryDist,
  );
  if (optionRelease) {
    return {
      type: 'release',
      ...optionRelease,
    };
  }

  const debugId = await readSourcemapDebugId(sourcemapPath);
  if (debugId) {
    return {
      type: 'debug-id',
      debugId,
    };
  }

  const environmentRelease = resolveSentryReleaseFromValues(
    process.env.SENTRY_RELEASE,
    process.env.SENTRY_DIST,
  );
  if (environmentRelease) {
    return {
      type: 'release',
      ...environmentRelease,
    };
  }

  throw new Error(
    '[pushy/sentry] Generated source map does not contain a Debug ID. ' +
      'Add @sentry/react-native/metro to metro.config.js so the OTA bundle can be matched by Debug ID, ' +
      'or set --sentry-release/--sentry-dist (or SENTRY_RELEASE/SENTRY_DIST) for legacy release matching.',
  );
}

export function buildSentrySourcemapsUploadArgs({
  sentryCliPath,
  bundlePath,
  sourcemapPath,
  release,
  dist,
  stripPrefix = process.cwd(),
  debugIdReference = false,
  useStandaloneSourcemapsCommand = true,
}: BuildSentrySourcemapsUploadArgsOptions): string[] {
  const uploadArgs = ['--strip-prefix', stripPrefix, bundlePath, sourcemapPath];

  if (debugIdReference) {
    if (!useStandaloneSourcemapsCommand) {
      throw new Error(
        '[pushy/sentry] Debug ID upload requires sentry-cli sourcemaps upload.',
      );
    }
    return [
      sentryCliPath,
      'sourcemaps',
      'upload',
      '--debug-id-reference',
      ...uploadArgs,
    ];
  }

  if (!release) {
    throw new Error(
      '[pushy/sentry] Legacy Sentry sourcemap upload requires a release.',
    );
  }

  if (!useStandaloneSourcemapsCommand) {
    return [
      sentryCliPath,
      'releases',
      'files',
      release,
      'upload-sourcemaps',
      ...(dist ? ['--dist', dist] : []),
      ...uploadArgs,
    ];
  }

  return [
    sentryCliPath,
    'sourcemaps',
    'upload',
    '--release',
    release,
    ...(dist ? ['--dist', dist] : []),
    ...uploadArgs,
  ];
}

function supportsStandaloneSentrySourcemapsUpload(sentryCliPath: string) {
  const result = spawnJavaScriptSync(
    [sentryCliPath, 'sourcemaps', 'upload', '--help'],
    {
      stdio: 'ignore',
    },
  );
  return !result.error && result.status === 0;
}

function supportsSentryDebugIdReference(sentryCliPath: string) {
  const result = spawnJavaScriptSync(
    [sentryCliPath, 'sourcemaps', 'upload', '--help'],
    {
      encoding: 'utf8',
    },
  );
  return (
    !result.error &&
    result.status === 0 &&
    typeof result.stdout === 'string' &&
    result.stdout.includes('--debug-id-reference')
  );
}

function runSentryCli(args: string[]): SyncProcessResult {
  return spawnJavaScriptSync(args, {
    stdio: 'inherit',
  });
}

function uploadSourcemapsWithRelease({
  sentryCliPath,
  bundlePath,
  sourcemapPath,
  release,
  dist,
  useStandaloneSourcemapsCommand,
}: {
  sentryCliPath: string;
  bundlePath: string;
  sourcemapPath: string;
  release: string;
  dist?: string;
  useStandaloneSourcemapsCommand: boolean;
}): void {
  assertSuccessfulSyncProcess(
    runSentryCli([sentryCliPath, 'releases', 'set-commits', release, '--auto']),
    sentryCliPath,
  );
  console.log(t('sentryReleaseCreated', { version: release }));

  console.log(t('uploadingSourcemap'));
  assertSuccessfulSyncProcess(
    runSentryCli(
      buildSentrySourcemapsUploadArgs({
        sentryCliPath,
        bundlePath,
        sourcemapPath,
        release,
        dist,
        useStandaloneSourcemapsCommand,
      }),
    ),
    sentryCliPath,
  );
}

export async function uploadSourcemapForSentry(
  bundleName: string,
  outputFolder: string,
  sourcemapOutput: string,
  platform = '',
  sentryOptions: SentryUploadOptions = {},
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

  const { bundlePath, sourcemapPath } = await prepareSentryUploadArtifacts(
    bundleName,
    outputFolder,
    platform,
  );
  const uploadMode = await resolveSentryUploadMode(
    sourcemapPath,
    sentryOptions,
  );
  const useStandaloneSourcemapsCommand =
    supportsStandaloneSentrySourcemapsUpload(sentryCliPath);

  if (uploadMode.type === 'release') {
    uploadSourcemapsWithRelease({
      sentryCliPath,
      bundlePath,
      sourcemapPath,
      release: uploadMode.release,
      dist: uploadMode.dist,
      useStandaloneSourcemapsCommand,
    });
    return;
  }

  console.log(t('uploadingSourcemap'));
  if (
    !useStandaloneSourcemapsCommand ||
    !supportsSentryDebugIdReference(sentryCliPath)
  ) {
    const explicitRelease =
      resolveSentryReleaseFromValues(
        sentryOptions.sentryRelease,
        sentryOptions.sentryDist,
      ) ??
      resolveSentryReleaseFromValues(
        process.env.SENTRY_RELEASE,
        process.env.SENTRY_DIST,
      );
    if (!explicitRelease) {
      throw new Error(
        '[pushy/sentry] sentry-cli does not support Debug ID source map upload. ' +
          'Upgrade @sentry/cli, or set --sentry-release/--sentry-dist for legacy release matching.',
      );
    }
    uploadSourcemapsWithRelease({
      sentryCliPath,
      bundlePath,
      sourcemapPath,
      release: explicitRelease.release,
      dist: explicitRelease.dist,
      useStandaloneSourcemapsCommand,
    });
    return;
  }

  console.log(
    `[pushy/sentry] Using source map Debug ID: ${uploadMode.debugId}`,
  );
  const debugIdResult = runSentryCli(
    buildSentrySourcemapsUploadArgs({
      sentryCliPath,
      bundlePath,
      sourcemapPath,
      debugIdReference: true,
      useStandaloneSourcemapsCommand,
    }),
  );

  if (debugIdResult.status === 0 && !debugIdResult.error) {
    return;
  }

  const explicitRelease =
    resolveSentryReleaseFromValues(
      sentryOptions.sentryRelease,
      sentryOptions.sentryDist,
    ) ??
    resolveSentryReleaseFromValues(
      process.env.SENTRY_RELEASE,
      process.env.SENTRY_DIST,
    );
  if (!explicitRelease) {
    assertSuccessfulSyncProcess(debugIdResult, sentryCliPath);
    return;
  }

  console.warn(
    '[pushy/sentry] Debug ID source map upload failed; falling back to explicit release/dist upload.',
  );
  uploadSourcemapsWithRelease({
    sentryCliPath,
    bundlePath,
    sourcemapPath,
    release: explicitRelease.release,
    dist: explicitRelease.dist,
    useStandaloneSourcemapsCommand,
  });
}
