import path from 'path';
import { getPlatform, getSelectedApp } from './app';
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

function parseCacheMaxMb(value: unknown): number | undefined {
  const parsed = typeof value === 'string' ? Number(value) : (value as number);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

type PublishBundlePayload = {
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

    checkLockFiles();
    addGitIgnore();

    const bundleParams = await checkPlugins();
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

    await cleanStaleTmp().catch(() => {});
    // the hermes base lookup needs the app; resolve it up front but never
    // fail the bundle over it (publishing resolves it again and reports)
    let appIdForBase: string | undefined =
      typeof options.appId === 'string' && options.appId
        ? options.appId
        : undefined;
    if (!appIdForBase && normalized.hermesBase === 'auto') {
      try {
        appIdForBase = (
          await getSelectedApp(platform, options.config as string | undefined)
        ).appId;
      } catch {
        appIdForBase = undefined;
      }
    }

    const hermesResult = await runReactNativeBundleCommand({
      bundleName: normalized.bundleName,
      dev: normalized.dev,
      entryFile: normalized.entryFile,
      outputFolder: normalized.intermediaDir,
      platform,
      sourcemapOutput:
        normalized.sourcemap || bundleParams.sourcemap ? sourcemapOutput : '',
      forceHermes: normalized.hermes,
      hermesBase:
        normalized.dev === 'true'
          ? undefined
          : {
              option: normalized.hermesBase,
              appId: appIdForBase,
              verify: normalized.verifyHermesBase,
              cacheMaxMb: normalized.cacheMaxMb,
            },
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
