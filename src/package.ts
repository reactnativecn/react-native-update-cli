import { get, getAllPackages, post, uploadFile } from './api';
import { question, saveToLocal } from './utils';
import { t } from './utils/i18n';

import { getPlatform, getSelectedApp } from './app';

import Table from 'tty-table';
import type { Platform } from './types';
import { getApkInfo, getAppInfo, getIpaInfo } from './utils';
import { depVersions } from './utils/dep-versions';
import { getCommitInfo } from './utils/git';

export async function listPackage(appId: string) {
  const allPkgs = await getAllPackages(appId);

  const header = [
    { value: t('nativePackageId') },
    { value: t('nativeVersion') },
  ];
  const rows = [];
  for (const pkg of allPkgs) {
    const { version } = pkg;
    let versionInfo = '';
    if (version) {
      const versionObj = version as any;
      versionInfo = t('boundTo', { 
        name: versionObj.name || version, 
        id: versionObj.id || version 
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

  while (true) {
    const id = await question(t('enterNativePackageId'));
    const app = list.find((v) => v.id.toString() === id);
    if (app) {
      return app;
    }
  }
}

export const packageCommands = {
  uploadIpa: async ({ args }: { args: string[] }) => {
    const fn = args[0];
    if (!fn || !fn.endsWith('.ipa')) {
      throw new Error(t('usageUploadIpa'));
    }
    const ipaInfo = await getIpaInfo(fn);
    const {
      versionName,
      buildTime,
    } = ipaInfo;
    const appIdInPkg = (ipaInfo as any).appId;
    const appKeyInPkg = (ipaInfo as any).appKey;
    const { appId, appKey } = await getSelectedApp('ios');

    if (appIdInPkg && appIdInPkg != appId) {
      throw new Error(t('appIdMismatchIpa', { appIdInPkg, appId }));
    }

    if (appKeyInPkg && appKeyInPkg !== appKey) {
      throw new Error(t('appKeyMismatchIpa', { appKeyInPkg, appKey }));
    }

    const { hash } = await uploadFile(fn);

    const { id } = await post(`/app/${appId}/package/create`, {
      name: versionName,
      hash,
      buildTime,
      deps: depVersions,
      commit: await getCommitInfo(),
    });
    saveToLocal(fn, `${appId}/package/${id}.ipa`);
    console.log(
      t('ipaUploadSuccess', { id, version: versionName, buildTime }),
    );
  },
  uploadApk: async ({ args }: { args: string[] }) => {
    const fn = args[0];
    if (!fn || !fn.endsWith('.apk')) {
      throw new Error(t('usageUploadApk'));
    }
    const apkInfo = await getApkInfo(fn);
    const {
      versionName,
      buildTime,
    } = apkInfo;
    const appIdInPkg = (apkInfo as any).appId;
    const appKeyInPkg = (apkInfo as any).appKey;
    const { appId, appKey } = await getSelectedApp('android');

    if (appIdInPkg && appIdInPkg != appId) {
      throw new Error(t('appIdMismatchApk', { appIdInPkg, appId }));
    }

    if (appKeyInPkg && appKeyInPkg !== appKey) {
      throw new Error(t('appKeyMismatchApk', { appKeyInPkg, appKey }));
    }

    const { hash } = await uploadFile(fn);

    const { id } = await post(`/app/${appId}/package/create`, {
      name: versionName,
      hash,
      buildTime,
      deps: depVersions,
      commit: await getCommitInfo(),
    });
    saveToLocal(fn, `${appId}/package/${id}.apk`);
    console.log(
      t('apkUploadSuccess', { id, version: versionName, buildTime }),
    );
  },
  uploadApp: async ({ args }: { args: string[] }) => {
    const fn = args[0];
    if (!fn || !fn.endsWith('.app')) {
      throw new Error(t('usageUploadApp'));
    }
    const appInfo = await getAppInfo(fn);
    const {
      versionName,
      buildTime,
    } = appInfo;
    const appIdInPkg = (appInfo as any).appId;
    const appKeyInPkg = (appInfo as any).appKey;
    const { appId, appKey } = await getSelectedApp('harmony');

    if (appIdInPkg && appIdInPkg != appId) {
      throw new Error(t('appIdMismatchApp', { appIdInPkg, appId }));
    }

    if (appKeyInPkg && appKeyInPkg !== appKey) {
      throw new Error(t('appKeyMismatchApp', { appKeyInPkg, appKey }));
    }

    const { hash } = await uploadFile(fn);

    const { id } = await post(`/app/${appId}/package/create`, {
      name: versionName,
      hash,
      buildTime,
      deps: depVersions,
      commit: await getCommitInfo(),
    });
    saveToLocal(fn, `${appId}/package/${id}.app`);
    console.log(
      t('appUploadSuccess', { id, version: versionName, buildTime }),
    );
  },
  parseApp: async ({ args }: { args: string[] }) => {
    const fn = args[0];
    if (!fn || !fn.endsWith('.app')) {
      throw new Error(t('usageParseApp'));
    }
    console.log(await getAppInfo(fn));
  },
  parseIpa: async ({ args }: { args: string[] }) => {
    const fn = args[0];
    if (!fn || !fn.endsWith('.ipa')) {
      throw new Error(t('usageParseIpa'));
    }
    console.log(await getIpaInfo(fn));
  },
  parseApk: async ({ args }: { args: string[] }) => {
    const fn = args[0];
    if (!fn || !fn.endsWith('.apk')) {
      throw new Error(t('usageParseApk'));
    }
    console.log(await getApkInfo(fn));
  },
  packages: async ({ options }: { options: { platform: Platform } }) => {
    const platform = await getPlatform(options.platform);
    const { appId } = await getSelectedApp(platform);
    await listPackage(appId);
  },
};
