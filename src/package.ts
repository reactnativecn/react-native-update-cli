import fs from 'fs';
import os from 'os';
import path from 'path';
import { doDelete, getAllPackages, post, uploadFile } from './api';
import { getSelectedApp, resolveAppId } from './app';
import { createSlimNativePackage } from './native-package';
import type { Package, Platform } from './types';
import {
  getAabInfo,
  getApkInfo,
  getAppInfo,
  getIpaInfo,
  isNonInteractive,
  loadTtyTable,
  question,
} from './utils';
import { updateJson } from './utils/constants';
import { getDepVersions } from './utils/dep-versions';
import { remove } from './utils/fs-helpers';
import { getCommitInfo } from './utils/git';
import {
  bundleEntryMatcher,
  cachePut,
  reportedBytecodeVersion,
} from './utils/hermes-base';
import { t } from './utils/i18n';
import { getBooleanOption, getStringListOption } from './utils/options';
import { bundleLocationFields, locateZipEntry } from './utils/zip-range';

// parse* output is JSON so the bundleHash (content fingerprint) can be piped
// into jq; the raw bundle bytes are dropped — a Buffer preview is just noise.
function printPackageInfo({
  bundleFile: _bundleFile,
  ...info
}: Record<string, unknown>) {
  console.log(JSON.stringify(info, null, 2));
}

type PackageCommandOptions = Record<string, unknown> & {
  appId?: string;
  appKey?: string;
  config?: string;
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
  /** sha256 of the JS bundle embedded in the package (content identity) */
  bundleHash?: string;
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
};

// the AAB parser drags in protobufjs; load it only for the aab commands
function loadExtractApk() {
  return (
    require('./utils/app-info-parser/aab') as typeof import('./utils/app-info-parser/aab')
  ).extractApk;
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

export function toNumericIds(ids: string[]) {
  return ids.map((id) => {
    const numericId = Number(id);
    if (!Number.isInteger(numericId) || numericId <= 0) {
      throw new Error(t('invalidId', { id }));
    }
    return numericId;
  });
}

const deleteMessages = {
  version: {
    one: 'deleteVersionSuccess',
    many: 'deleteVersionsSuccess',
    error: 'deleteVersionError',
  },
  package: {
    one: 'deletePackageSuccess',
    many: 'deletePackagesSuccess',
    error: 'deletePackageError',
  },
} as const;

/**
 * Delete versions or packages of an app: one id through
 * `DELETE /app/:appId/<kind>/:id`, several in one `DELETE /app/:appId/<kind>`.
 */
export async function deleteByIds(
  appId: string | number,
  kind: 'version' | 'package',
  ids: string[],
) {
  const messages = deleteMessages[kind];
  try {
    if (ids.length === 1) {
      const [id] = ids;
      await doDelete(`/app/${appId}/${kind}/${id}`);
      console.log(t(messages.one, { [`${kind}Id`]: id }));
    } else {
      await doDelete(`/app/${appId}/${kind}`, {
        [`${kind}Ids`]: toNumericIds(ids),
      });
      console.log(
        t(messages.many, { count: ids.length, [`${kind}Ids`]: ids.join(', ') }),
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      t(messages.error, { [`${kind}Id`]: ids.join(', '), error: message }),
    );
  }
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
  const { versionName: extractedVersionName, buildTime, bundleHash } = info;
  const bundleFile = (info as { bundleFile?: Buffer }).bundleFile;
  const { appId: appIdInPkg, appKey: appKeyInPkg } = info;
  const selectedApp = options.appId
    ? {
        appId: String(options.appId),
        appKey: typeof options.appKey === 'string' ? options.appKey : undefined,
      }
    : await getSelectedApp(config.platform, options.config);
  const { appId, appKey } = selectedApp;
  // where the expected app came from, for the mismatch messages
  const source = options.appId ? '--appId' : options.config || updateJson;

  if (appIdInPkg && String(appIdInPkg) !== appId) {
    throw new Error(t(config.appIdMismatchKey, { appIdInPkg, appId, source }));
  }

  if (appKeyInPkg && appKey && appKeyInPkg !== appKey) {
    throw new Error(
      t(config.appKeyMismatchKey, { appKeyInPkg, appKey, source }),
    );
  }

  const customVersion =
    typeof options.version === 'string' && options.version
      ? options.version
      : undefined;
  const versionName = customVersion ?? extractedVersionName;
  if (customVersion !== undefined) {
    console.log(t('usingCustomVersion', { version: versionName }));
  }

  const tempRoot = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'rnu-native-package-upload-'),
  );
  const slimPackagePath = path.join(tempRoot, `package${config.extension}`);
  try {
    await createSlimNativePackage(filePath, slimPackagePath, config.platform);
    const { hash } = await uploadFile(slimPackagePath, appId);
    // where the bundle sits inside the uploaded (slim) archive, so a later
    // `bundle` that falls back to this package as hermes base fetches only
    // the bundle with one HTTP Range request. Harmony .app nests a second
    // zip, so no location is reported for it.
    const bundleLocation =
      config.extension === '.app'
        ? {}
        : bundleLocationFields(
            await locateZipEntry(
              slimPackagePath,
              bundleEntryMatcher(config.extension.slice(1) as 'apk' | 'ipa'),
            ).catch(() => null),
          );
    if (bundleFile) {
      // keep the embedded bundle locally so a later `bundle` can use it as
      // hermes base without downloading it back (see hermes-base.ts); getInfo
      // already hashed the bundle, so pass that hash instead of hashing twice
      await cachePut(bundleFile, undefined, bundleHash).catch(() => {});
    }

    const { id } = await post(`/app/${appId}/package/create`, {
      name: versionName,
      hash,
      buildTime: String(buildTime),
      // Content identity of the embedded JS bundle; the server matches it
      // against the client-reported bundleHash to decide pdiff applicability.
      // Old servers strip unknown fields, so this is forward-compatible.
      ...(bundleHash ? { bundleHash } : {}),
      // HBC version of the embedded bundle (0 = plain JS), so the server
      // offers this package as hermes base only to a matching compile
      ...(bundleFile
        ? { bytecodeVersion: reportedBytecodeVersion(bundleFile) }
        : {}),
      ...bundleLocation,
      deps: getDepVersions(),
      commit: await getCommitInfo(),
    });
    console.log(
      t(config.successKey, {
        id,
        version: versionName,
        buildTime: String(buildTime),
      }),
    );
  } finally {
    await remove(tempRoot);
  }
}

/**
 * Print the app's native packages. Pass `packages` when the caller already
 * fetched them (every page of the list), to skip fetching them again.
 */
export async function listPackage(appId: string, packages?: Package[]) {
  const allPkgs = packages ?? (await getAllPackages(appId)) ?? [];

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

  // tty-table is ~25 ms to load; only pay for it when a table is rendered
  const Table = loadTtyTable();
  console.log(Table(header, rows).render());
  console.log(t('totalPackages', { count: allPkgs.length }));
  return allPkgs;
}

export async function choosePackage(appId: string, packages?: Package[]) {
  // Fail before fetching or rendering the package list when no prompt exists.
  if (isNonInteractive()) {
    throw new Error(t('packageIdRequired'));
  }
  const list = await listPackage(appId, packages);
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

    // private temp dir: unpredictable path, safe against symlink squatting in
    // the shared tmpdir and against concurrent uploads of same-named AABs
    const tempRoot = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'rnu-aab-upload-'),
    );
    const output = path.join(tempRoot, 'universal.apk');

    const includeAllSplits = getBooleanOption(options, 'includeAllSplits');
    const splits = getStringListOption(options, 'splits');

    try {
      await loadExtractApk()(source, output, {
        includeAllSplits,
        splits,
      });
      await packageCommands.uploadApk({
        args: [output],
        options,
      });
    } finally {
      await remove(tempRoot);
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
    });
  },
  parseApp: async ({ args }: { args: string[] }) => {
    const fn = args[0];
    if (!fn?.endsWith('.app')) {
      throw new Error(t('usageParseApp'));
    }
    printPackageInfo(await getAppInfo(fn));
  },
  parseIpa: async ({ args }: { args: string[] }) => {
    const fn = args[0];
    if (!fn?.endsWith('.ipa')) {
      throw new Error(t('usageParseIpa'));
    }
    printPackageInfo(await getIpaInfo(fn));
  },
  parseApk: async ({ args }: { args: string[] }) => {
    const fn = args[0];
    if (!fn?.endsWith('.apk')) {
      throw new Error(t('usageParseApk'));
    }
    printPackageInfo(await getApkInfo(fn));
  },
  parseAab: async ({ args }: { args: string[] }) => {
    const fn = args[0];
    if (!fn?.endsWith('.aab')) {
      throw new Error(t('usageParseAab'));
    }
    printPackageInfo(await getAabInfo(fn));
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

    const includeAllSplits = getBooleanOption(options, 'includeAllSplits');
    const splits = getStringListOption(options, 'splits');

    await loadExtractApk()(source, output, {
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
    await listPackage(await resolveAppId(options));
  },
  deletePackage: async ({ options }: { options: PackageCommandOptions }) => {
    const appId = await resolveAppId(options);
    let packageIds =
      getStringListOption(options, 'packageIds') ??
      getStringListOption(options, 'packageId');

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

    await deleteByIds(appId, 'package', packageIds);
  },
};
