import path from 'path';
import { AppNotSelectedError, getPlatform, resolveAppId } from './app';
import { packBundle } from './bundle-pack';
import {
  copyDebugidForSentry,
  runReactNativeBundleCommand,
  type SentryUploadOptions,
  uploadSourcemapForSentry,
} from './bundle-runner';
import type { Platform } from './types';
import { checkPlugins, question, translateOptions } from './utils';
import { addGitIgnore } from './utils/add-gitignore';
import { checkLockFiles } from './utils/check-lockfile';
import { tempDir } from './utils/constants';
import { depVersions } from './utils/dep-versions';
import {
  cleanStaleTmp,
  type HermesBaseMeta,
  hermesBaseMeta,
} from './utils/hermes-base';
import { t } from './utils/i18n';
import {
  getBooleanOption,
  getOptionalStringOption,
  getStringOption,
} from './utils/options';
import { versionCommands } from './versions';

type NormalizedBundleOptions = {
  bundleName: string;
  entryFile: string;
  intermediaDir: string;
  output: string;
  dev: string;
  sourcemap: boolean;
  taro: boolean;
  expo: boolean;
  rncli: boolean;
  hermes: boolean;
  hermesBase: string;
  verifyHermesBase: boolean;
  resetCache: boolean;
  cacheMaxMb?: number;
  appId?: string;
  config?: string;
  name?: string;
  description?: string;
  metaInfo?: string;
  packageId?: string;
  packageVersion?: string;
  minPackageVersion?: string;
  maxPackageVersion?: string;
  packageVersionRange?: string;
  rollout?: string;
  dryRun: boolean;
  sentryRelease?: string;
  sentryDist?: string;
};

/** Parse a positive cache-size option expressed in megabytes. */
function parseCacheMaxMb(value: unknown): number | undefined {
  const parsed = typeof value === 'string' ? Number(value) : (value as number);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

type PublishBundlePayload = {
  appId: string;
  name?: string;
  description?: string;
  metaInfo?: string;
  packageId?: string;
  packageVersion?: string;
  minPackageVersion?: string;
  maxPackageVersion?: string;
  packageVersionRange?: string;
  rollout?: string;
  dryRun?: boolean;
  hermesBase?: HermesBaseMeta;
};

/** Read either spelling of an aliased optional CLI string option. */
function getAliasedOptionalStringOption(
  options: Record<string, unknown>,
  key: string,
  alias: string,
): string | undefined {
  return (
    getOptionalStringOption(options, key) ??
    getOptionalStringOption(options, alias)
  );
}

/** Normalize translated CLI values into the bundle command's typed options. */
export function normalizeBundleOptions(
  translatedOptions: Record<string, unknown>,
  platform: string,
): NormalizedBundleOptions {
  return {
    // harmony bundles always use this fixed name (runReactNativeBundleCommand
    // forces it), so sourcemap paths and Sentry uploads must match
    bundleName:
      platform === 'harmony'
        ? 'bundle.harmony.js'
        : getStringOption(translatedOptions, 'bundleName', 'index.bundlejs'),
    entryFile: getStringOption(translatedOptions, 'entryFile', 'index.js'),
    intermediaDir: getStringOption(
      translatedOptions,
      'intermediaDir',
      `${tempDir}/intermedia/${platform}`,
    ),
    output: getStringOption(
      translatedOptions,
      'output',
      `${tempDir}/output/${platform}.\${time}.ppk`,
    ),
    dev: getBooleanOption(translatedOptions, 'dev', false) ? 'true' : 'false',
    sourcemap: getBooleanOption(translatedOptions, 'sourcemap', false),
    taro: getBooleanOption(translatedOptions, 'taro', false),
    expo: getBooleanOption(translatedOptions, 'expo', false),
    rncli: getBooleanOption(translatedOptions, 'rncli', false),
    hermes: getBooleanOption(translatedOptions, 'hermes', false),
    hermesBase: getStringOption(translatedOptions, 'hermesBase', 'auto'),
    verifyHermesBase: getBooleanOption(
      translatedOptions,
      'verifyHermesBase',
      true,
    ),
    resetCache: getBooleanOption(translatedOptions, 'resetCache', true),
    cacheMaxMb: parseCacheMaxMb(translatedOptions.cacheMaxMb),
    appId: getOptionalStringOption(translatedOptions, 'appId'),
    config: getOptionalStringOption(translatedOptions, 'config'),
    name: getOptionalStringOption(translatedOptions, 'name'),
    description: getOptionalStringOption(translatedOptions, 'description'),
    metaInfo: getOptionalStringOption(translatedOptions, 'metaInfo'),
    packageId: getOptionalStringOption(translatedOptions, 'packageId'),
    packageVersion: getOptionalStringOption(
      translatedOptions,
      'packageVersion',
    ),
    minPackageVersion: getOptionalStringOption(
      translatedOptions,
      'minPackageVersion',
    ),
    maxPackageVersion: getOptionalStringOption(
      translatedOptions,
      'maxPackageVersion',
    ),
    packageVersionRange: getOptionalStringOption(
      translatedOptions,
      'packageVersionRange',
    ),
    rollout: getOptionalStringOption(translatedOptions, 'rollout'),
    dryRun: getBooleanOption(translatedOptions, 'dryRun', false),
    sentryRelease: getAliasedOptionalStringOption(
      translatedOptions,
      'sentry-release',
      'sentryRelease',
    ),
    sentryDist: getAliasedOptionalStringOption(
      translatedOptions,
      'sentry-dist',
      'sentryDist',
    ),
  };
}

/** Upload generated Sentry artifacts when the detected plugin requires them. */
async function uploadSentryArtifactsIfNeeded(
  shouldUpload: boolean,
  bundleName: string,
  intermediaDir: string,
  sourcemapOutput: string,
  platform: Platform,
  sentryOptions: SentryUploadOptions,
): Promise<void> {
  if (!shouldUpload) {
    return;
  }

  await copyDebugidForSentry(bundleName, intermediaDir, sourcemapOutput);
  await uploadSourcemapForSentry(
    bundleName,
    intermediaDir,
    sourcemapOutput,
    platform,
    sentryOptions,
  );
}

/** Publish a packed bundle through the version command implementation. */
async function publishBundleVersion(
  outputPath: string,
  platform: Platform,
  payload: PublishBundlePayload,
): Promise<string> {
  return versionCommands.publish({
    args: [outputPath],
    options: {
      platform,
      ...payload,
    },
  });
}

export const bundleCommands = {
  /** Build a bundle and optionally publish it to one operation-scoped app. */
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
    const normalized = normalizeBundleOptions(translatedOptions, platform);

    // One app per operation: the Hermes base lookup and the publish step must
    // never see different apps, so the target is resolved once and reused.
    let appId: string | undefined;
    const getAppId = async () =>
      (appId ??= await resolveAppId({
        appId: normalized.appId,
        config: normalized.config,
        platform,
      }));
    const hermesBase =
      normalized.dev === 'true'
        ? undefined
        : {
            option: normalized.hermesBase,
            verify: normalized.verifyHermesBase,
            cacheMaxMb: normalized.cacheMaxMb,
          };

    // Resolve before any side effect or expensive work. A named bundle is
    // published, so a missing app fails right here; a bundle-only run only
    // needs the app for the remote Hermes base lookup and may go on without
    // one (it then compiles a full bundle). Any other config error (e.g.
    // malformed JSON) is reported immediately either way.
    if (normalized.name) {
      await getAppId();
    } else if (hermesBase?.option === 'auto') {
      try {
        await getAppId();
      } catch (error) {
        if (!(error instanceof AppNotSelectedError)) {
          throw error;
        }
      }
    }

    checkLockFiles();
    addGitIgnore();

    const [bundleParams] = await Promise.all([
      checkPlugins(),
      cleanStaleTmp().catch(() => {}),
    ]);
    const sourcemapOutput = path.join(
      normalized.intermediaDir,
      `${normalized.bundleName}.map`,
    );
    const realOutput = normalized.output.replace(
      /\$\{time\}/g,
      `${Date.now()}`,
    );

    if (!platform) {
      throw new Error(t('platformRequired'));
    }

    console.log(t('bundlingWithRN', { version: depVersions['react-native'] }));

    const hermesResult = await runReactNativeBundleCommand({
      bundleName: normalized.bundleName,
      dev: normalized.dev,
      entryFile: normalized.entryFile,
      outputFolder: normalized.intermediaDir,
      platform,
      sourcemapOutput:
        normalized.sourcemap || bundleParams.sourcemap ? sourcemapOutput : '',
      forceHermes: normalized.hermes,
      hermesBase: hermesBase ? { ...hermesBase, appId } : undefined,
      resetCache: normalized.resetCache,
      cli: {
        taro: normalized.taro,
        expo: normalized.expo,
        rncli: normalized.rncli,
      },
      isSentry: bundleParams.sentry,
    });

    await packBundle(
      path.resolve(normalized.intermediaDir),
      realOutput,
      normalized.bundleName,
    );
    const baseMeta = hermesResult
      ? hermesBaseMeta(hermesResult.base, hermesResult.bytecodeVersion)
      : undefined;

    if (normalized.name) {
      await publishBundleVersion(realOutput, platform, {
        appId: await getAppId(),
        name: normalized.name,
        description: normalized.description,
        metaInfo: normalized.metaInfo,
        packageId: normalized.packageId,
        packageVersion: normalized.packageVersion,
        minPackageVersion: normalized.minPackageVersion,
        maxPackageVersion: normalized.maxPackageVersion,
        packageVersionRange: normalized.packageVersionRange,
        rollout: normalized.rollout,
        dryRun: normalized.dryRun,
        hermesBase: baseMeta,
      });
      await uploadSentryArtifactsIfNeeded(
        bundleParams.sentry,
        normalized.bundleName,
        normalized.intermediaDir,
        sourcemapOutput,
        platform,
        {
          sentryRelease: normalized.sentryRelease,
          sentryDist: normalized.sentryDist,
        },
      );
      return;
    }

    if (!getBooleanOption(options, 'no-interactive', false)) {
      const v = await question(t('uploadBundlePrompt'));
      if (v.toLowerCase() === 'y') {
        await publishBundleVersion(realOutput, platform, {
          appId: await getAppId(),
          hermesBase: baseMeta,
        });
        await uploadSentryArtifactsIfNeeded(
          bundleParams.sentry,
          normalized.bundleName,
          normalized.intermediaDir,
          sourcemapOutput,
          platform,
          {
            sentryRelease: normalized.sentryRelease,
            sentryDist: normalized.sentryDist,
          },
        );
      }
    }
  },
};
