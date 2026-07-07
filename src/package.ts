import * as fs from 'fs-extra';
import os from 'os';
import path from 'path';
import Table from 'tty-table';
import { doDelete, getAllPackages, post, uploadFile } from './api';
import { getPlatform, getSelectedApp } from './app';
import type { Platform } from './types';
import {
  getAabInfo,
  getApkInfo,
  getAppInfo,
  getIpaInfo,
  question,
} from './utils';
import { AabParser } from './utils/app-info-parser/aab';
import { depVersions } from './utils/dep-versions';
import { getCommitInfo } from './utils/git';
import { t } from './utils/i18n';
import { getStringListOption } from './utils/options';

type PackageCommandOptions = Record<string, unknown> & {
  appId?: string;
  appKey?: string;
  platform?: Platform;
  version?: string;
  packageId?: string;
  packageIds?: string;
  packageVersion?: string;
  includeAllSplits?: boolean | string;
  splits?: string;
  output?: string;
};

type PackageVersionRef = {
  id?: string | number;
  name?: string | number;
};

type NativePackageInfo = {
  versionName?: string | number;
  buildTime?: string | number;
  appId?: string;
  appKey?: string;
  [key: string]: unknown;
};

type NativeUploadConfig = {
  extension: '.ipa' | '.apk' | '.app';
  platform: Platform;
  appIdMismatchKey: string;
  appKeyMismatchKey: string;
  successKey: string;
  getInfo: (filePath: string) => Promise<NativePackageInfo>;
  normalizeBuildTime?: (
    buildTime: NativePackageInfo['buildTime'],
  ) => string | number | undefined;
};

export function normalizeUploadBuildTime(value: unknown): string {
  return String(value);
}

function ensureFileByExt(
  filePath: string | undefined,
  extension: NativeUploadConfig['extension'] | '.aab',
  usageKey: string,
): string {
  if (!filePath?.endsWith(extension)) {
    throw new Error(t(usageKey));
  }
  return filePath;
}

function parseBooleanOption(value: unknown): boolean {
  return value === true || value === 'true';
}

function parseCsvOption(value: unknown): string[] | null {
  if (typeof value !== 'string') {
    return null;
  }
  const parsed = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : null;
}

function toNumericIds(ids: string[]) {
  return ids.map((id) => {
    const numericId = Number(id);
    if (!Number.isInteger(numericId) || numericId <= 0) {
      throw new Error(t('invalidId', { id }));
    }
    return numericId;
  });
}

function getVersionBinding(version: unknown): PackageVersionRef | undefined {
  if (!version || typeof version !== 'object') {
    return undefined;
  }

  const v = version as PackageVersionRef;
  return { id: v.id, name: v.name };
}

async function uploadNativePackage(
  filePath: string,
  options: PackageCommandOptions,
  config: NativeUploadConfig,
): Promise<void> {
  const info = await config.getInfo(filePath);
  const { versionName: extractedVersionName, buildTime } = info;
  const { appId: appIdInPkg, appKey: appKeyInPkg } = info;
  const selectedApp = options.appId
    ? {
        appId: String(options.appId),
        appKey: typeof options.appKey === 'string' ? options.appKey : undefined,
      }
    : await getSelectedApp(
        config.platform,
        options.config as string | undefined,
      );
  const { appId, appKey } = selectedApp;

  if (appIdInPkg && String(appIdInPkg) !== appId) {
    throw new Error(t(config.appIdMismatchKey, { appIdInPkg, appId }));
  }

  if (appKeyInPkg && appKey && appKeyInPkg !== appKey) {
    throw new Error(t(config.appKeyMismatchKey, { appKeyInPkg, appKey }));
  }

  const customVersion =
    typeof options.version === 'string' && options.version
      ? options.version
      : undefined;
  const versionName = customVersion ?? extractedVersionName;
  if (customVersion !== undefined) {
    console.log(t('usingCustomVersion', { version: versionName }));
  }

  const { hash } = await uploadFile(filePath);
  const normalizedBuildTime = config.normalizeBuildTime
    ? config.normalizeBuildTime(buildTime)
    : buildTime;
  const uploadBuildTime = normalizeUploadBuildTime(normalizedBuildTime);

  const { id } = await post(`/app/${appId}/package/create`, {
    name: versionName,
    hash,
    buildTime: uploadBuildTime,
    deps: depVersions,
    commit: await getCommitInfo(),
  });
  console.log(
    t(config.successKey, {
      id,
      version: versionName,
      buildTime: uploadBuildTime,
    }),
  );
}

export async function listPackage(appId: string) {
  const allPkgs = (await getAllPackages(appId)) || [];

  const header = [
    { value: t('nativePackageId') },
    { value: t('nativeVersion') },
  ];
  const rows = [];
  for (const pkg of allPkgs) {
    const { version } = pkg;
    let versionInfo = '';
    if (version) {
      const versionObj = getVersionBinding(version);
      versionInfo = t('boundTo', {
        name: versionObj?.name ?? version,
        id: versionObj?.id ?? version,
      });
    }
    let output = pkg.name;
    if (pkg.status === 'paused') {
      output += t('pausedStatus');
    }
    if (pkg.status === 'expired') {
      output += t('expiredStatus');
    }
    output += versionInfo;
    rows.push([pkg.id, output]);
  }

  console.log(Table(header, rows).render());
  console.log(t('totalPackages', { count: allPkgs.length }));
  return allPkgs;
}

export async function choosePackage(appId: string) {
  const list = await listPackage(appId);
  const packageMap = new Map(list?.map((v) => [v.id.toString(), v]));

  while (true) {
    const id = await question(t('enterNativePackageId'));
    const app = packageMap.get(id);
    if (app) {
      return app;
    }
  }
}

export const packageCommands = {
  uploadIpa: async ({
    args,
    options,
  }: {
    args: string[];
    options: PackageCommandOptions;
  }) => {
    const fn = ensureFileByExt(args[0], '.ipa', 'usageUploadIpa');
    await uploadNativePackage(fn, options, {
      extension: '.ipa',
      platform: 'ios',
      appIdMismatchKey: 'appIdMismatchIpa',
      appKeyMismatchKey: 'appKeyMismatchIpa',
      successKey: 'ipaUploadSuccess',
      getInfo: (filePath) => getIpaInfo(filePath),
    });
  },
  uploadApk: async ({
    args,
    options,
  }: {
    args: string[];
    options: PackageCommandOptions;
  }) => {
    const fn = ensureFileByExt(args[0], '.apk', 'usageUploadApk');
    await uploadNativePackage(fn, options, {
      extension: '.apk',
      platform: 'android',
      appIdMismatchKey: 'appIdMismatchApk',
      appKeyMismatchKey: 'appKeyMismatchApk',
      successKey: 'apkUploadSuccess',
      getInfo: (filePath) => getApkInfo(filePath),
    });
  },
  uploadAab: async ({
    args,
    options,
  }: {
    args: string[];
    options: PackageCommandOptions;
  }) => {
    const source = ensureFileByExt(args[0], '.aab', 'usageUploadAab');

    const output = path.join(
      os.tmpdir(),
      `${path.basename(source, path.extname(source))}-${Date.now()}.apk`,
    );

    const includeAllSplits = parseBooleanOption(options.includeAllSplits);
    const splits = parseCsvOption(options.splits);

    const parser = new AabParser(source);
    try {
      await parser.extractApk(output, {
        includeAllSplits,
        splits,
      });
      await packageCommands.uploadApk({
        args: [output],
        options,
      });
    } finally {
      if (await fs.pathExists(output)) {
        await fs.remove(output);
      }
    }
  },
  uploadApp: async ({
    args,
    options,
  }: {
    args: string[];
    options: PackageCommandOptions;
  }) => {
    const fn = ensureFileByExt(args[0], '.app', 'usageUploadApp');
    await uploadNativePackage(fn, options, {
      extension: '.app',
      platform: 'harmony',
      appIdMismatchKey: 'appIdMismatchApp',
      appKeyMismatchKey: 'appKeyMismatchApp',
      successKey: 'appUploadSuccess',
      getInfo: (filePath) => getAppInfo(filePath),
      normalizeBuildTime: (buildTime) => String(buildTime),
    });
  },
  parseApp: async ({ args }: { args: string[] }) => {
    const fn = args[0];
    if (!fn?.endsWith('.app')) {
      throw new Error(t('usageParseApp'));
    }
    console.log(await getAppInfo(fn));
  },
  parseIpa: async ({ args }: { args: string[] }) => {
    const fn = args[0];
    if (!fn?.endsWith('.ipa')) {
      throw new Error(t('usageParseIpa'));
    }
    console.log(await getIpaInfo(fn));
  },
  parseApk: async ({ args }: { args: string[] }) => {
    const fn = args[0];
    if (!fn?.endsWith('.apk')) {
      throw new Error(t('usageParseApk'));
    }
    console.log(await getApkInfo(fn));
  },
  parseAab: async ({ args }: { args: string[] }) => {
    const fn = args[0];
    if (!fn?.endsWith('.aab')) {
      throw new Error(t('usageParseAab'));
    }
    console.log(await getAabInfo(fn));
  },
  extractApk: async ({
    args,
    options,
  }: {
    args: string[];
    options: PackageCommandOptions;
  }) => {
    const source = ensureFileByExt(args[0], '.aab', 'usageExtractApk');

    const output =
      options.output ||
      path.join(
        path.dirname(source),
        `${path.basename(source, path.extname(source))}.apk`,
      );

    const includeAllSplits = parseBooleanOption(options.includeAllSplits);
    const splits = parseCsvOption(options.splits);

    const parser = new AabParser(source);
    await parser.extractApk(output, {
      includeAllSplits,
      splits,
    });

    console.log(t('apkExtracted', { output }));
  },
  packages: async ({
    options,
  }: {
    options: { platform: Platform; appId?: string; config?: string };
  }) => {
    let appId = options.appId;
    if (!appId) {
      const platform = await getPlatform(options.platform);
      appId = (
        await getSelectedApp(platform, options.config as string | undefined)
      ).appId;
    }
    await listPackage(String(appId));
  },
  deletePackage: async ({ options }: { options: PackageCommandOptions }) => {
    let { appId } = options;
    let packageIds =
      getStringListOption(options, 'packageIds') ??
      getStringListOption(options, 'packageId');

    if (!appId) {
      const platform = await getPlatform(options.platform);
      appId = (
        await getSelectedApp(platform, options.config as string | undefined)
      ).appId;
    }

    if (!packageIds) {
      const packageVersions = getStringListOption(options, 'packageVersion');
      if (!packageVersions) {
        throw new Error(t('usageDeletePackage'));
      }

      const allPkgs = await getAllPackages(appId);
      if (!allPkgs) {
        throw new Error(t('noPackagesFound', { appId }));
      }

      const allPkgsMap = new Map(allPkgs.map((pkg) => [pkg.name, pkg]));

      packageIds = packageVersions.map((packageVersion) => {
        const selectedPackage = allPkgsMap.get(packageVersion);
        if (!selectedPackage) {
          throw new Error(t('packageNotFound', { packageVersion }));
        }
        return String(selectedPackage.id);
      });
    }

    // Confirm deletion
    // const confirmDelete = await question(
    //   t('confirmDeletePackage', { packageId }),
    // );

    // if (
    //   confirmDelete.toLowerCase() !== 'y' &&
    //   confirmDelete.toLowerCase() !== 'yes'
    // ) {
    //   console.log(t('cancelled'));
    //   return;
    // }

    try {
      if (packageIds.length === 1) {
        const [packageId] = packageIds;
        await doDelete(`/app/${appId}/package/${packageId}`);
        console.log(t('deletePackageSuccess', { packageId }));
      } else {
        await doDelete(`/app/${appId}/package`, {
          packageIds: toNumericIds(packageIds),
        });
        console.log(
          t('deletePackagesSuccess', {
            count: packageIds.length,
            packageIds: packageIds.join(', '),
          }),
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        t('deletePackageError', {
          packageId: packageIds.join(', '),
          error: message,
        }),
      );
    }
  },
};
