/**
 * Created by tdzl2003 on 2/13/16.
 */

import * as fs from 'fs-extra';
import os from 'os';
import path from 'path';
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
      ret[key] = v.replace(/\$\{(\w+)\}/g, function(v, n) {
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
    throw new Error('无法获取此包的编译时间戳。请更新react-native-update到最新版本后重新打包上传。');
  }
  return { versionName, buildTime };
}

export async function getIpaInfo(fn) {
  const appInfoParser = new AppInfoParser(fn);
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
    throw new Error('无法获取此包的编译时间戳。请更新react-native-update到最新版本后重新打包上传。');
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
