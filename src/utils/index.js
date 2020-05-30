/**
 * Created by tdzl2003 on 2/13/16.
 */

import fs from 'fs-extra';
import os from 'os';
import path from 'path';
const pkg = require('../../package.json');
const AppInfoParser = require('app-info-parser');

var read = require('read');

export function question(query, password) {
  if (NO_INTERACTIVE) {
    return Promise.resolve('');
  }
  return new Promise((resolve, reject) =>
    read(
      {
        prompt: query,
        silent: password,
        replace: password ? '*' : undefined,
      },
      (err, result) => (err ? reject(err) : resolve(result)),
    ),
  );
}

export function translateOptions(options) {
  const ret = {};
  for (let key in options) {
    const v = options[key];
    if (typeof v === 'string') {
      ret[key] = v.replace(/\$\{(\w+)\}/g, function (v, n) {
        return options[n] || process.env[n] || v;
      });
    } else {
      ret[key] = v;
    }
  }
  return ret;
}

export function getRNVersion() {
  const version = JSON.parse(
    fs.readFileSync(path.resolve('node_modules/react-native/package.json')),
  ).version;

  // We only care about major and minor version.
  const match = /^(\d+)\.(\d+)\./.exec(version);
  return {
    version,
    major: match[1] | 0,
    minor: match[2] | 0,
  };
}

export async function getApkInfo(fn) {
  const appInfoParser = new AppInfoParser(fn);
  const bundleFile = await appInfoParser.parser.getEntry(
    /assets\/index.android.bundle/,
  );
  if (!bundleFile) {
    throw new Error(
      '找不到bundle文件。请确保此apk为release版本，且bundle文件名为默认的index.android.bundle',
    );
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
      '无法获取此包的编译时间戳。请更新react-native-update到最新版本后重新打包上传。',
    );
  }
  return { versionName, buildTime };
}

export async function getIpaInfo(fn) {
  const appInfoParser = new AppInfoParser(fn);
  const bundleFile = await appInfoParser.parser.getEntry(
    /payload\/.+?\.app\/main.jsbundle/,
  );
  if (!bundleFile) {
    throw new Error(
      '找不到bundle文件。请确保此ipa为release版本，且bundle文件名为默认的main.jsbundle',
    );
  }
  const {
    CFBundleShortVersionString: versionName,
  } = await appInfoParser.parse();
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
      '无法获取此包的编译时间戳。请更新react-native-update到最新版本后重新打包上传。',
    );
  }
  const buildTime = buildTimeTxtBuffer.toString().replace('\n', '');
  return { versionName, buildTime };
}

const localDir = path.resolve(os.homedir(), '.pushy');
fs.ensureDirSync(localDir);
export function saveToLocal(originPath, destName) {
  // TODO
  // const destPath = path.join(localDir, destName);
  // fs.ensureDirSync(path.dirname(destPath));
  // fs.copyFileSync(originPath, destPath);
}

export function printVersionCommand() {
  console.log('react-native-update-cli: ' + pkg.version);
  try {
    const PACKAGE_JSON_PATH = path.resolve(
      process.cwd(),
      'node_modules',
      'react-native-update',
      'package.json',
    );
    console.log('react-native-update: ' + require(PACKAGE_JSON_PATH).version);
  } catch (e) {
    console.log('react-native-update: 无法获取版本号，请在项目目录中运行命令');
  }
}

export const pricingPageUrl = 'https://pushy.reactnative.cn/pricing.html';
