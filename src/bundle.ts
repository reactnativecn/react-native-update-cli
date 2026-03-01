import path from 'path';
import { getPlatform } from './app';
import { packBundle } from './bundle-pack';
import {
  copyDebugidForSentry,
  runReactNativeBundleCommand,
  uploadSourcemapForSentry,
} from './bundle-runner';
import type { Platform } from './types';
import { checkPlugins, question, translateOptions } from './utils';
import { addGitIgnore } from './utils/add-gitignore';
import { checkLockFiles } from './utils/check-lockfile';
import { tempDir } from './utils/constants';
import { depVersions } from './utils/dep-versions';
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
};

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
};

function normalizeBundleOptions(
  translatedOptions: Record<string, unknown>,
  platform: string,
): NormalizedBundleOptions {
  return {
    bundleName: getStringOption(
      translatedOptions,
      'bundleName',
      'index.bundlejs',
    ),
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
  };
}

async function uploadSentryArtifactsIfNeeded(
  shouldUpload: boolean,
  bundleName: string,
  intermediaDir: string,
  sourcemapOutput: string,
  versionName: string,
): Promise<void> {
  if (!shouldUpload) {
    return;
  }

  await copyDebugidForSentry(bundleName, intermediaDir, sourcemapOutput);
  await uploadSourcemapForSentry(
    bundleName,
    intermediaDir,
    sourcemapOutput,
    versionName,
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

    console.log(`Bundling with react-native: ${depVersions['react-native']}`);

    await runReactNativeBundleCommand({
      bundleName: normalized.bundleName,
      dev: normalized.dev,
      entryFile: normalized.entryFile,
      outputFolder: normalized.intermediaDir,
      platform,
      sourcemapOutput:
        normalized.sourcemap || bundleParams.sourcemap ? sourcemapOutput : '',
      forceHermes: normalized.hermes,
      cli: {
        taro: normalized.taro,
        expo: normalized.expo,
        rncli: normalized.rncli,
      },
      isSentry: bundleParams.sentry,
    });

    await packBundle(path.resolve(normalized.intermediaDir), realOutput);

    if (normalized.name) {
      const versionName = await publishBundleVersion(realOutput, platform, {
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
      });
      await uploadSentryArtifactsIfNeeded(
        bundleParams.sentry,
        normalized.bundleName,
        normalized.intermediaDir,
        sourcemapOutput,
        versionName,
      );
      return;
    }

    if (!getBooleanOption(options, 'no-interactive', false)) {
      const v = await question(t('uploadBundlePrompt'));
      if (v.toLowerCase() === 'y') {
        const versionName = await publishBundleVersion(
          realOutput,
          platform,
          {},
        );
        await uploadSentryArtifactsIfNeeded(
          bundleParams.sentry,
          normalized.bundleName,
          normalized.intermediaDir,
          sourcemapOutput,
          versionName,
        );
      }
    }
  },
};
