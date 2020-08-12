/**
 * Created by tdzl2003 on 4/2/16.
 */

const { get, post, uploadFile } = require('./api');
import { question, saveToLocal } from './utils';

import { checkPlatform, getSelectedApp } from './app';

import { getApkInfo, getIpaInfo } from './utils';
const Table = require('tty-table');

export async function listPackage(appId) {
  const { data } = await get(`/app/${appId}/package/list?limit=1000`);

  const header = [{ value: 'Package Id' }, { value: 'Version' }];
  const rows = [];
  for (const pkg of data) {
    const { version } = pkg;
    let versionInfo = '';
    if (version) {
      versionInfo = ` - ${version.id} ${version.hash.slice(0, 8)} ${version.name}`;
    } else {
      versionInfo = ' (newest)';
    }

    rows.push([pkg.id, `${pkg.name}(${pkg.status})${versionInfo}`]);
  }

  console.log(Table(header, rows).render());
  console.log(`\nTotal ${data.length} package(s).`);
  return data;
}

export async function choosePackage(appId) {
  const list = await listPackage(appId);

  while (true) {
    const id = await question('Enter Package Id:');
    const app = list.find(v => v.id === (id | 0));
    if (app) {
      return app;
    }
  }
}

export const commands = {
  uploadIpa: async function({ args }) {
    const fn = args[0];
    if (!fn || !fn.endsWith('.ipa')) {
      throw new Error('Usage: pushy uploadIpa <ipaFile>');
    }
    const { versionName, buildTime } = await getIpaInfo(fn);
    const { appId } = await getSelectedApp('ios');

    const { hash } = await uploadFile(fn);

    const { id } = await post(`/app/${appId}/package/create`, {
      name: versionName,
      hash,
      buildTime,
    });
    saveToLocal(fn, `${appId}/package/${id}.ipa`);
    console.log(`Ipa uploaded: ${id}`);
  },
  uploadApk: async function({ args }) {
    const fn = args[0];
    if (!fn || !fn.endsWith('.apk')) {
      throw new Error('Usage: pushy uploadApk <apkFile>');
    }
    const { versionName, buildTime } = await getApkInfo(fn);
    const { appId } = await getSelectedApp('android');

    const { hash } = await uploadFile(fn);

    const { id } = await post(`/app/${appId}/package/create`, {
      name: versionName,
      hash,
      buildTime,
    });
    saveToLocal(fn, `${appId}/package/${id}.apk`);
    console.log(`Apk uploaded: ${id}`);
  },
  parseIpa:  async function({ args }) {
    const fn = args[0];
    if (!fn || !fn.endsWith('.ipa')) {
      throw new Error('Usage: pushy parseIpa <ipaFile>');
    }
    const { versionName, buildTime } = await getIpaInfo(fn);
    console.log(`版本号: ${versionName}, 编译时间戳: ${buildTime}`);
  },
  parseApk:  async function({ args }) {
    const fn = args[0];
    if (!fn || !fn.endsWith('.apk')) {
      throw new Error('Usage: pushy parseApk <apkFile>');
    }
    const { versionName, buildTime } = await getApkInfo(fn);
    console.log(`版本号: ${versionName}, 编译时间戳: ${buildTime}`);
  },
  packages: async function({ options }) {
    const platform = checkPlatform(options.platform || (await question('Platform(ios/android):')));
    const { appId } = await getSelectedApp(platform);
    await listPackage(appId);
  },
};
