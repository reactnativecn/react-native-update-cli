import { get, post, uploadFile } from './api';
import { question, saveToLocal } from './utils';

import { checkPlatform, getSelectedApp } from './app';

import { getApkInfo, getIpaInfo, getAppInfo } from './utils';
import Table from 'tty-table';
import { depVersions } from './utils/dep-versions';

export async function listPackage(appId: string) {
  const { data } = await get(`/app/${appId}/package/list?limit=1000`);

  const header = [{ value: '原生包 Id' }, { value: '原生版本' }];
  const rows = [];
  for (const pkg of data) {
    const { version } = pkg;
    let versionInfo = '';
    if (version) {
      versionInfo = `, 已绑定：${version.name} (${version.id})`;
    } else {
      // versionInfo = ' (newest)';
    }
    let output = pkg.name;
    if (pkg.status === 'paused') {
      output += '(已暂停)';
    }
    if (pkg.status === 'expired') {
      output += '(已过期)';
    }
    output += versionInfo;
    rows.push([pkg.id, output]);
  }

  console.log(Table(header, rows).render());
  console.log(`\n共 ${data.length} 个包`);
  return data;
}

export async function choosePackage(appId: string) {
  const list = await listPackage(appId);

  while (true) {
    const id = await question('输入原生包 id:');
    const app = list.find((v) => v.id === Number(id));
    if (app) {
      return app;
    }
  }
}

export const commands = {
  uploadIpa: async ({ args }: { args: string[] }) => {
    const fn = args[0];
    if (!fn || !fn.endsWith('.ipa')) {
      throw new Error('使用方法: pushy uploadIpa ipa后缀文件');
    }
    const {
      versionName,
      buildTime,
      appId: appIdInPkg,
      appKey: appKeyInPkg,
    } = await getIpaInfo(fn);
    const { appId, appKey } = await getSelectedApp('ios');

    if (appIdInPkg && appIdInPkg != appId) {
      throw new Error(
        `appId不匹配！当前ipa: ${appIdInPkg}, 当前update.json: ${appId}`,
      );
    }

    if (appKeyInPkg && appKeyInPkg !== appKey) {
      throw new Error(
        `appKey不匹配！当前ipa: ${appKeyInPkg}, 当前update.json: ${appKey}`,
      );
    }

    const { hash } = await uploadFile(fn);

    const { id } = await post(`/app/${appId}/package/create`, {
      name: versionName,
      hash,
      buildTime,
      deps: depVersions,
    });
    saveToLocal(fn, `${appId}/package/${id}.ipa`);
    console.log(
      `已成功上传ipa原生包（id: ${id}, version: ${versionName}, buildTime: ${buildTime}）`,
    );
  },
  uploadApk: async ({ args }) => {
    const fn = args[0];
    if (!fn || !fn.endsWith('.apk')) {
      throw new Error('使用方法: pushy uploadApk apk后缀文件');
    }
    const {
      versionName,
      buildTime,
      appId: appIdInPkg,
      appKey: appKeyInPkg,
    } = await getApkInfo(fn);
    const { appId, appKey } = await getSelectedApp('android');

    if (appIdInPkg && appIdInPkg != appId) {
      throw new Error(
        `appId不匹配！当前apk: ${appIdInPkg}, 当前update.json: ${appId}`,
      );
    }

    if (appKeyInPkg && appKeyInPkg !== appKey) {
      throw new Error(
        `appKey不匹配！当前apk: ${appKeyInPkg}, 当前update.json: ${appKey}`,
      );
    }

    const { hash } = await uploadFile(fn);

    const { id } = await post(`/app/${appId}/package/create`, {
      name: versionName,
      hash,
      buildTime,
      deps: depVersions,
    });
    saveToLocal(fn, `${appId}/package/${id}.apk`);
    console.log(
      `已成功上传apk原生包（id: ${id}, version: ${versionName}, buildTime: ${buildTime}）`,
    );
  },
  uploadApp: async ({ args }) => {
    const fn = args[0];
    if (!fn || !fn.endsWith('.app')) {
      throw new Error('使用方法: pushy uploadApp app后缀文件');
    }
    const {
      versionName,
      buildTime,
      appId: appIdInPkg,
      appKey: appKeyInPkg,
    } = await getAppInfo(fn);
    const { appId, appKey } = await getSelectedApp('harmony');

    if (appIdInPkg && appIdInPkg != appId) {
      throw new Error(
        `appId不匹配！当前app: ${appIdInPkg}, 当前update.json: ${appId}`,
      );
    }

    if (appKeyInPkg && appKeyInPkg !== appKey) {
      throw new Error(
        `appKey不匹配！当前app: ${appKeyInPkg}, 当前update.json: ${appKey}`,
      );
    }

    const { hash } = await uploadFile(fn);

    const { id } = await post(`/app/${appId}/package/create`, {
      name: versionName,
      hash,
      buildTime,
      deps: depVersions,
    });
    saveToLocal(fn, `${appId}/package/${id}.app`);
    console.log(
      `已成功上传app原生包（id: ${id}, version: ${versionName}, buildTime: ${buildTime}）`,
    );
  },
  parseApp: async ({ args }) => {
    const fn = args[0];
    if (!fn || !fn.endsWith('.app')) {
      throw new Error('使用方法: pushy parseApp app后缀文件');
    }
    console.log(await getAppInfo(fn));
  },
  parseIpa: async ({ args }) => {
    const fn = args[0];
    if (!fn || !fn.endsWith('.ipa')) {
      throw new Error('使用方法: pushy parseIpa ipa后缀文件');
    }
    console.log(await getIpaInfo(fn));
  },
  parseApk: async ({ args }) => {
    const fn = args[0];
    if (!fn || !fn.endsWith('.apk')) {
      throw new Error('使用方法: pushy parseApk apk后缀文件');
    }
    console.log(await getApkInfo(fn));
  },
  packages: async ({ options }) => {
    const platform = checkPlatform(
      options.platform || (await question('平台(ios/android/harmony):')),
    );
    const { appId } = await getSelectedApp(platform);
    await listPackage(appId);
  },
};
