import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import pkg from '../../package.json';
import AppInfoParser from './app-info-parser';
import semverSatisfies from 'semver/functions/satisfies';
import chalk from 'chalk';
import latestVersion from '@badisi/latest-version';
import { checkPlugins } from './check-plugin';

import { read } from 'read';
import { tempDir } from './constants';
import { depVersions } from './dep-versions';
import { getCommitInfo } from './git';

export async function question(query: string, password?: boolean) {
  if (NO_INTERACTIVE) {
    return '';
  }
  return read({
    prompt: query,
    silent: password,
    replace: password ? '*' : undefined,
  });
}

export function translateOptions(options: Record<string, string>) {
  const ret: Record<string, string> = {};
  for (const key in options) {
    const v = options[key];
    if (typeof v === 'string') {
      ret[key] = v.replace(
        /\$\{(\w+)\}/g,
        (v, n) => options[n] || process.env[n] || v,
      );
    } else {
      ret[key] = v;
    }
  }
  return ret;
}

export async function getApkInfo(fn: string) {
  const appInfoParser = new AppInfoParser(fn);
  const bundleFile = await appInfoParser.parser.getEntry(
    /assets\/index.android.bundle/,
  );
  if (!bundleFile) {
    throw new Error(
      '找不到bundle文件。请确保此apk为release版本，且bundle文件名为默认的index.android.bundle',
    );
  }
  const updateJsonFile = await appInfoParser.parser.getEntry(
    /res\/raw\/update.json/,
  );
  let appCredential = {};
  if (updateJsonFile) {
    appCredential = JSON.parse(updateJsonFile.toString()).android;
  }
  const { versionName, application } = await appInfoParser.parse();
  let buildTime = 0;
  if (Array.isArray(application.metaData)) {
    for (const meta of application.metaData) {
      if (meta.name === 'pushy_build_time') {
        buildTime = meta.value[0];
      }
    }
  }
  if (buildTime == 0) {
    throw new Error(
      '无法获取此包的编译时间戳。请更新 react-native-update 到最新版本后重新打包上传。',
    );
  }
  return { versionName, buildTime, ...appCredential };
}

export async function getAppInfo(fn) {
  const appInfoParser = new AppInfoParser(fn);
  const bundleFile = await appInfoParser.parser.getEntryFromHarmonyApp(
    /rawfile\/bundle.harmony.js/,
  );
  if (!bundleFile) {
    throw new Error(
      '找不到bundle文件。请确保此app为release版本，且bundle文件名为默认的bundle.harmony.js',
    );
  }
  const updateJsonFile = await appInfoParser.parser.getEntryFromHarmonyApp(
    /rawfile\/update.json/,
  );
  let appCredential = {};
  if (updateJsonFile) {
    appCredential = JSON.parse(updateJsonFile.toString()).harmony;
  }
  const metaJsonFile = await appInfoParser.parser.getEntryFromHarmonyApp(
    /rawfile\/meta.json/,
  );
  let metaData = {};
  if (metaJsonFile) {
    metaData = JSON.parse(metaJsonFile.toString());
  }
  const { versionName, pushy_build_time } = metaData;
  let buildTime = 0;
  if (pushy_build_time) {
    buildTime = pushy_build_time;
  }
  if (buildTime == 0) {
    throw new Error(
      '无法获取此包的编译时间戳。请更新 react-native-update 到最新版本后重新打包上传。',
    );
  }
  return { versionName, buildTime, ...appCredential };
}

export async function getIpaInfo(fn: string) {
  const appInfoParser = new AppInfoParser(fn);
  const bundleFile = await appInfoParser.parser.getEntry(
    /payload\/.+?\.app\/main.jsbundle/,
  );
  if (!bundleFile) {
    throw new Error(
      '找不到bundle文件。请确保此ipa为release版本，且bundle文件名为默认的main.jsbundle',
    );
  }
  const updateJsonFile = await appInfoParser.parser.getEntry(
    /payload\/.+?\.app\/assets\/update.json/,
  );
  let appCredential = {};
  if (updateJsonFile) {
    appCredential = JSON.parse(updateJsonFile.toString()).ios;
  }
  const { CFBundleShortVersionString: versionName } =
    await appInfoParser.parse();
  let buildTimeTxtBuffer = await appInfoParser.parser.getEntry(
    /payload\/.+?\.app\/pushy_build_time.txt/,
  );
  if (!buildTimeTxtBuffer) {
    // Not in root bundle when use `use_frameworks`
    buildTimeTxtBuffer = await appInfoParser.parser.getEntry(
      /payload\/.+?\.app\/frameworks\/react_native_update.framework\/pushy_build_time.txt/,
    );
  }
  if (!buildTimeTxtBuffer) {
    throw new Error(
      '无法获取此包的编译时间戳。请更新 react-native-update 到最新版本后重新打包上传。',
    );
  }
  const buildTime = buildTimeTxtBuffer.toString().replace('\n', '');
  return { versionName, buildTime, ...appCredential };
}

const localDir = path.resolve(os.homedir(), tempDir);
fs.ensureDirSync(localDir);
export function saveToLocal(originPath: string, destName: string) {
  // TODO
  // const destPath = path.join(localDir, destName);
  // fs.ensureDirSync(path.dirname(destPath));
  // fs.copyFileSync(originPath, destPath);
}

async function getLatestVersion(pkgNames: string[]) {
  return latestVersion(pkgNames, {
    useCache: true,
    requestOptions: {
      timeout: 2000,
    },
  })
    .then((pkgs) => pkgs.map((pkg) => pkg.latest))
    .catch(() => []);
}

export async function printVersionCommand() {
  const result = await getCommitInfo();
  console.log(JSON.stringify(result, null, 2));
  let [latestPushyCliVersion, latestPushyVersion] = await getLatestVersion([
    'react-native-update-cli',
    'react-native-update',
  ]);
  latestPushyCliVersion = latestPushyCliVersion
    ? ` （最新：${chalk.green(latestPushyCliVersion)}）`
    : '';
  console.log(
    `react-native-update-cli: ${pkg.version}${latestPushyCliVersion}`,
  );
  let pushyVersion = '';
  pushyVersion = depVersions['react-native-update'];
  latestPushyVersion = latestPushyVersion
    ? ` （最新：${chalk.green(latestPushyVersion)}）`
    : '';
  console.log(`react-native-update: ${pushyVersion}${latestPushyVersion}`);
  if (pushyVersion) {
    if (semverSatisfies(pushyVersion, '<8.5.2')) {
      console.warn(
        `当前版本已不再支持，请至少升级到 v8 的最新小版本后重新打包（代码无需改动）: npm i react-native-update@8 .
        如有使用安装 apk 的功能，请注意添加所需权限 https://pushy.reactnative.cn/docs/api#async-function-downloadandinstallapkurl`,
      );
    } else if (semverSatisfies(pushyVersion, '9.0.0 - 9.2.1')) {
      console.warn(
        `当前版本已不再支持，请至少升级到 v9 的最新小版本后重新打包（代码无需改动，可直接热更）: npm i react-native-update@9 .
        如有使用安装 apk 的功能，请注意添加所需权限 https://pushy.reactnative.cn/docs/api#async-function-downloadandinstallapkurl`,
      );
    } else if (semverSatisfies(pushyVersion, '10.0.0 - 10.17.0')) {
      console.warn(
        '当前版本已不再支持，请升级到 v10 的最新小版本（代码无需改动，可直接热更）: npm i react-native-update@10',
      );
    }
  } else {
    console.log('react-native-update: 无法获取版本号，请在项目目录中运行命令');
  }
}

export { checkPlugins };
