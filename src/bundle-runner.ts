import { spawn, spawnSync } from 'child_process';
import { satisfies } from 'compare-versions';
import * as fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { getHermesBase } from './api';
import {
  classifyHermesCommand,
  type HermesBaseOption,
  type HermesBaseSelection,
  hermescArgsWithBase,
  probeHbcVersion,
  resolveHermesBase,
  verifyHermesBaseEquivalence,
} from './utils/hermes-base';
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
  /** Hermes -base-bytecode settings; omitted → compile without a base */
  hermesBase?: HermesBaseRequest;
  cli: BundleCliOptions;
  isSentry: boolean;
}

export interface HermesBaseRequest {
  option: HermesBaseOption;
  appId?: string;
  verify: boolean;
  cacheMaxMb?: number;
}

export interface HermesCompileResult {
  bytecodeVersion: number | null;
  base: HermesBaseSelection | null;
  /** true when --verifyHermesBase ran and passed; false when it failed (base dropped) */
  verified?: boolean;
}

/** Outcome of picking a base: what to compile with, plus the log lines. */
export interface HermesBaseSelectionResult {
  base: HermesBaseSelection | null;
  bytecodeVersion: number | null;
  /** messages to print when the compile phase starts (kept out of Metro's output) */
  logs: string[];
  /** hermesc could not be resolved; the compile phase will report it */
  commandUnavailable?: boolean;
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
  hermesBase,
  cli,
  isSentry,
}: RunBundleCommandOptions): Promise<HermesCompileResult | null> {
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

  // Decide about Hermes before Metro runs so the base lookup (server query,
  // Range download, cache) overlaps the bundling instead of following it.
  const hermesEnabled = await detectHermesEnabled(
    platform,
    forceHermes,
    gradleConfig,
  );
  const pendingBase =
    hermesEnabled && hermesBase
      ? startHermesBaseSelection(hermesBase)
      : undefined;

  const jsRuntime = getJavaScriptRuntime();
  const reactNativeBundleProcess = spawnJavaScript(reactNativeBundleArgs);
  console.log(
    `Running bundle command: ${jsRuntime} ${reactNativeBundleArgs.join(' ')}`,
  );

  let hermesResult: HermesCompileResult | null = null;
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
        if (hermesEnabled) {
          hermesResult = await compileHermesByteCode({
            bundleName,
            outputFolder,
            sourcemapOutput,
            shouldCleanSourcemap: !isSentry,
            baseRequest: hermesBase,
            pendingBase,
          });
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
  return hermesResult;
}

async function detectHermesEnabled(
  platform: string,
  forceHermes: boolean | undefined,
  gradleConfig: GradleConfig,
): Promise<boolean> {
  if (forceHermes) {
    console.log(t('forceHermes'));
    return true;
  }
  if (platform === 'android') {
    const gradleProperties = await new Promise<{ hermesEnabled?: boolean }>(
      (resolve) => {
        properties.parse(
          './android/gradle.properties',
          { path: true },
          (error: Error | null, props: { hermesEnabled?: boolean } = {}) => {
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
    if (typeof gradleProperties.hermesEnabled === 'boolean') {
      return gradleProperties.hermesEnabled;
    }
    return Boolean(gradleConfig.enableHermes);
  }
  if (platform === 'ios' && fs.existsSync('ios/Pods/hermes-engine')) {
    return true;
  }
  return false;
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
    throw new Error(
      t('unsupportedPlatformForHermes', { platform: os.platform() }),
    );
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

/**
 * hermesc argument policy. `-output-source-map` is always passed: hermesc then
 * strips the debug info section from the bytecode (like React Native's own
 * release builds, 15-40% smaller bytecode and smaller hot-update patches) and
 * writes its own `<bundle>.map` next to the output. When the user asked for a
 * sourcemap that file is composed with the packager map as before; otherwise it
 * simply stays in the intermediate directory (never packed into the ppk) so
 * `address at` stack frames can still be symbolicated later.
 */
/**
 * hermesc echoes every diagnostic as three lines (header, the offending source
 * line, a caret line). Minified bundles put a whole module on one line, so a
 * single warning can be 100k+ characters and blindly keeping the tail of stderr
 * buries the actual error under warning noise. Keep the diagnostic headers,
 * prefer errors over warnings, and cap the length of whatever survives.
 */
export function summarizeHermescStderr(stderr: string): string {
  const raw = String(stderr ?? '').split(/\r?\n/);
  const kept: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const line = raw[i].trim();
    if (!line) continue;
    if (/^\^~*$/.test(line)) continue; // caret line
    // the line before a caret is the echoed source, never the message
    const next = raw[i + 1]?.trim();
    if (next && /^\^~*$/.test(next)) continue;
    kept.push(line.length > 300 ? `${line.slice(0, 300)}…` : line);
  }
  if (kept.length === 0) return '';
  const isError = (line: string) =>
    /(?::\s*|^)(?:fatal error|error)\b/i.test(line) ||
    /^(?:Assertion|Stack dump|PLEASE submit a bug report)/i.test(line);
  const errors = kept.filter(isError);
  if (errors.length > 0) return errors.slice(-3).join(' ');
  const notWarnings = kept.filter(
    (line) => !/:\s*(?:warning|note):/i.test(line),
  );
  return (notWarnings.length > 0 ? notWarnings : kept).slice(-3).join(' ');
}

export function buildHermescArgs(bundlePath: string): string[] {
  return [
    '-emit-binary',
    '-out',
    bundlePath,
    bundlePath,
    '-O',
    '-output-source-map',
  ];
}

interface ProcessOutcome {
  status: number | null;
  signal: NodeJS.Signals | null;
  stderr: string;
  error?: Error;
}

/** spawn without blocking the event loop, so two hermesc runs can overlap */
function runProcess(
  command: string,
  args: string[],
  captureStderr: boolean,
): Promise<ProcessOutcome> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'ignore', captureStderr ? 'pipe' : 'ignore'],
    });
    const chunks: Buffer[] = [];
    child.stderr?.on('data', (chunk: Buffer) => chunks.push(chunk));
    let settled = false;
    const finish = (outcome: ProcessOutcome) => {
      if (settled) return;
      settled = true;
      resolve(outcome);
    };
    child.once('error', (error) =>
      finish({ status: null, signal: null, stderr: '', error }),
    );
    child.once('close', (status, signal) =>
      finish({ status, signal, stderr: Buffer.concat(chunks).toString() }),
    );
  });
}

export interface CompileHermesOptions {
  bundleName: string;
  outputFolder: string;
  sourcemapOutput: string;
  shouldCleanSourcemap: boolean;
  baseRequest?: HermesBaseRequest;
  /** base selection started before Metro (see startHermesBaseSelection) */
  pendingBase?: Promise<HermesBaseSelectionResult>;
  /** defaults to the project's hermesc */
  hermesCommand?: string;
}

export async function compileHermesByteCode({
  bundleName,
  outputFolder,
  sourcemapOutput,
  shouldCleanSourcemap,
  baseRequest,
  pendingBase,
  hermesCommand = resolveHermesCommand(),
}: CompileHermesOptions): Promise<HermesCompileResult> {
  console.log(t('hermesEnabledCompiling'));

  const bundlePath = path.join(outputFolder, bundleName);
  const plainArgs = buildHermescArgs(bundlePath);
  if (sourcemapOutput) {
    fs.copyFileSync(
      sourcemapOutput,
      path.join(outputFolder, `${bundleName}.txt.map`),
    );
  } else {
    console.log(t('hermesSourcemapKept', { file: `${bundlePath}.map` }));
  }

  let selection = pendingBase ? await pendingBase : null;
  if (!selection || selection.commandUnavailable) {
    selection = await selectHermesBase(hermesCommand, baseRequest);
  }
  for (const line of selection.logs) console.log(line);
  const result: HermesCompileResult = {
    bytecodeVersion: selection.bytecodeVersion,
    base: null,
  };
  const base = selection.base;

  if (base) {
    // hermesc reads its input in full before writing, so compiling in place is
    // safe; keep the JS bundle aside while a base compile may still fail or be
    // rejected by the equivalence check. With verification on, the plain
    // compile the check needs runs concurrently in a sibling directory (same
    // file name, so its sourcemap looks identical) and simply becomes the
    // result when the base is rejected — no third compile.
    const jsBackup = `${bundlePath}.js.bak`;
    fs.copyFileSync(bundlePath, jsBackup);
    const plainDir = path.join(outputFolder, '.hermes-plain');
    const plainPath = path.join(plainDir, bundleName);
    const wantPlain = Boolean(baseRequest?.verify);
    if (wantPlain) {
      fs.ensureDirSync(plainDir);
      fs.copyFileSync(bundlePath, plainPath);
    }
    const args = hermescArgsWithBase(plainArgs, base.path);
    console.log(
      t('runningHermesc', { command: hermesCommand, args: args.join(' ') }),
    );
    const [attempt, plain] = await Promise.all([
      runProcess(hermesCommand, args, true),
      wantPlain
        ? runProcess(hermesCommand, buildHermescArgs(plainPath), false)
        : Promise.resolve<ProcessOutcome | null>(null),
    ]);
    let usedBase = attempt.status === 0 && !attempt.error;
    if (!usedBase) {
      const fullStderr = attempt.error
        ? String(attempt.error.message ?? attempt.error)
        : attempt.stderr;
      const reason = summarizeHermescStderr(fullStderr);
      console.warn(
        t('hermesBaseCompileFailed', {
          reason: reason || `exit ${attempt.status}`,
        }),
      );
      if (fullStderr.trim()) {
        // the summary drops warning noise; keep everything for bug reports
        const logPath = path.join(outputFolder, 'hermes-base-error.log');
        try {
          fs.writeFileSync(logPath, fullStderr);
          console.warn(t('hermesBaseCompileFailedLog', { file: logPath }));
        } catch {}
      }
    }
    const plainOk = plain !== null && plain.status === 0 && !plain.error;
    if (usedBase && wantPlain) {
      // compare disassembly, keep whichever is right
      let ok = plainOk;
      if (ok) {
        try {
          ok = await verifyHermesBaseEquivalence(
            hermesCommand,
            bundlePath,
            plainPath,
          );
        } catch {
          ok = false;
        }
      }
      result.verified = ok;
      if (ok) {
        console.log(t('hermesBaseVerified'));
      } else {
        console.warn(t('hermesBaseVerifyFailed'));
        usedBase = false;
      }
    }
    if (!usedBase) {
      if (plainOk) {
        fs.moveSync(plainPath, bundlePath, { overwrite: true });
        if (fs.existsSync(`${plainPath}.map`)) {
          fs.moveSync(`${plainPath}.map`, `${bundlePath}.map`, {
            overwrite: true,
          });
        }
      } else {
        fs.copyFileSync(jsBackup, bundlePath);
        console.log(
          t('runningHermesc', {
            command: hermesCommand,
            args: plainArgs.join(' '),
          }),
        );
        assertSuccessfulSyncProcess(
          spawnSync(hermesCommand, plainArgs, { stdio: 'ignore' }),
          hermesCommand,
        );
      }
    }
    fs.removeSync(jsBackup);
    fs.removeSync(plainDir);
    result.base = usedBase ? base : null;
  } else {
    console.log(
      t('runningHermesc', {
        command: hermesCommand,
        args: plainArgs.join(' '),
      }),
    );
    assertSuccessfulSyncProcess(
      spawnSync(hermesCommand, plainArgs, {
        stdio: 'ignore',
      }),
      hermesCommand,
    );
  }
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
      return result;
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
  return result;
}

/**
 * Begin resolving the base right away (before Metro); the compile phase awaits
 * the result. Never rejects: any failure is reported there instead.
 */
export function startHermesBaseSelection(
  request: HermesBaseRequest,
): Promise<HermesBaseSelectionResult> {
  return (async () => {
    let hermesCommand: string;
    try {
      hermesCommand = resolveHermesCommand();
    } catch {
      return {
        base: null,
        bytecodeVersion: null,
        logs: [],
        commandUnavailable: true,
      };
    }
    try {
      return await selectHermesBase(hermesCommand, request);
    } catch (error: any) {
      return {
        base: null,
        bytecodeVersion: null,
        logs: [
          t('hermesBaseNone', { reason: error?.message ?? String(error) }),
        ],
      };
    }
  })();
}

async function selectHermesBase(
  hermesCommand: string,
  request: HermesBaseRequest | undefined,
): Promise<HermesBaseSelectionResult> {
  const logs: string[] = [];
  const none = (bytecodeVersion: number | null = null) => ({
    base: null,
    bytecodeVersion,
    logs,
  });
  if (!request || request.option === 'none') {
    if (request) {
      logs.push(t('hermesBaseNone', { reason: 'disabled by option' }));
    }
    return none();
  }
  const gate = classifyHermesCommand(hermesCommand);
  if (!gate.allowed) {
    logs.push(
      t('hermesBaseNone', { reason: gate.reason ?? 'hermesc not eligible' }),
    );
    return none();
  }
  const bytecodeVersion = probeHbcVersion(hermesCommand);
  if (bytecodeVersion === null) {
    logs.push(t('hermesBaseNone', { reason: 'could not probe HBC version' }));
    return none();
  }
  try {
    const base = await resolveHermesBase({
      option: request.option,
      hermesCommand,
      bytecodeVersion,
      appId: request.appId,
      cacheMaxMb: request.cacheMaxMb,
      fetchBase: getHermesBase,
      log: (message) => logs.push(message),
    });
    return { base, bytecodeVersion, logs };
  } catch (error: any) {
    logs.push(t('hermesBaseNone', { reason: error?.message ?? String(error) }));
    return none(bytecodeVersion);
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
