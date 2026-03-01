import os from 'os';
import path from 'path';
import chalk from 'chalk';
import { satisfies } from 'compare-versions';
import fs from 'fs-extra';
import type { Root as ProtobufRoot } from 'protobufjs';
import { type Entry as YauzlEntry, open as openZipFile } from 'yauzl';
import pkg from '../../package.json';
import latestVersion from '../utils/latest-version';
import AppInfoParser from './app-info-parser';
import { checkPlugins } from './check-plugin';

import { read } from 'read';
import { IS_CRESC, tempDir } from './constants';
import { depVersions } from './dep-versions';
import { t } from './i18n';

type ApkMetaEntry = {
  name?: string;
  value?: string | number | Array<string | number>;
};

type ParsedApkInfo = {
  versionName: string;
  application: {
    metaData?: ApkMetaEntry[];
  };
};

type ParsedIpaInfo = {
  CFBundleShortVersionString: string;
};

type ParsedAppMetaInfo = {
  versionName?: string;
  pushy_build_time?: number | string;
};

type AabXmlAttr = {
  name: string;
  value: string;
  compiledItem?: {
    ref?: {
      id?: number;
    };
    prim?: {
      intDecimalValue?: number;
    };
  };
};

type AabXmlElement = {
  name: string;
  attribute: AabXmlAttr[];
  child: Array<{ element?: AabXmlElement }>;
};

type AabXmlNodeObject = {
  element: AabXmlElement;
};

type AabResourceEntry = {
  entryId: number;
  configValue?: Array<{
    value?: {
      item?: {
        str?: {
          value?: string;
        };
      };
    };
  }>;
};

type AabResourceType = {
  typeId: number;
  entry: AabResourceEntry[];
};

type AabResourcePackage = {
  packageId: number;
  type: AabResourceType[];
};

type AabResourceTableObject = {
  package: AabResourcePackage[];
};

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

export function translateOptions<T extends Record<string, unknown>>(
  options: T,
): T & Record<string, unknown> {
  const ret: Record<string, unknown> = {};
  for (const key in options) {
    const value = options[key];
    if (typeof value === 'string') {
      ret[key] = value.replace(/\$\{(\w+)\}/g, (placeholder, name) => {
        const replacement = options[name] ?? process.env[name];
        if (
          typeof replacement === 'string' ||
          typeof replacement === 'number' ||
          typeof replacement === 'boolean'
        ) {
          return String(replacement);
        }
        return placeholder;
      });
    } else {
      ret[key] = value;
    }
  }
  return ret as T & Record<string, unknown>;
}

export async function getApkInfo(fn: string) {
  const appInfoParser = new AppInfoParser(fn);
  const bundleFile = await appInfoParser.parser.getEntry(
    /assets\/index.android.bundle/,
  );
  if (!bundleFile) {
    throw new Error(
      t('bundleNotFound', {
        packageType: 'apk',
        entryFile: 'index.android.bundle',
      }),
    );
  }
  const updateJsonFile = await appInfoParser.parser.getEntry(
    /res\/raw\/update.json/,
  );
  let appCredential = {};
  if (updateJsonFile) {
    appCredential = JSON.parse(updateJsonFile.toString()).android;
  }
  const { versionName, application } =
    await appInfoParser.parse<ParsedApkInfo>();
  let buildTime = 0;
  if (Array.isArray(application.metaData)) {
    for (const meta of application.metaData) {
      if (meta.name === 'pushy_build_time') {
        if (Array.isArray(meta.value)) {
          const firstValue = meta.value[0];
          buildTime = Number(firstValue);
        } else if (meta.value !== undefined) {
          buildTime = Number(meta.value);
        }
      }
    }
  }
  if (buildTime == 0) {
    throw new Error(t('buildTimeNotFound'));
  }
  return { versionName, buildTime, ...appCredential };
}

export async function getAppInfo(fn: string) {
  const appInfoParser = new AppInfoParser(fn);
  const bundleFile = await appInfoParser.parser.getEntryFromHarmonyApp(
    /rawfile\/bundle.harmony.js/,
  );
  if (!bundleFile) {
    throw new Error(
      t('bundleNotFound', {
        packageType: 'app',
        entryFile: 'bundle.harmony.js',
      }),
    );
  }
  const updateJsonFile =
    await appInfoParser.parser.getEntryFromHarmonyApp(/rawfile\/update.json/);
  let appCredential = {};
  if (updateJsonFile) {
    appCredential = JSON.parse(updateJsonFile.toString()).harmony;
  }
  const metaJsonFile =
    await appInfoParser.parser.getEntryFromHarmonyApp(/rawfile\/meta.json/);
  let metaData: ParsedAppMetaInfo = {};
  if (metaJsonFile) {
    metaData = JSON.parse(metaJsonFile.toString()) as ParsedAppMetaInfo;
  }
  const { versionName, pushy_build_time } = metaData;
  let buildTime = 0;
  if (pushy_build_time) {
    buildTime = Number(pushy_build_time);
  }
  if (buildTime == 0) {
    throw new Error(t('buildTimeNotFound'));
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
      t('bundleNotFound', {
        packageType: 'ipa',
        entryFile: 'main.jsbundle',
      }),
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
    await appInfoParser.parse<ParsedIpaInfo>();
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
    throw new Error(t('buildTimeNotFound'));
  }
  const buildTime = buildTimeTxtBuffer.toString().replace('\n', '');
  return { versionName, buildTime, ...appCredential };
}

export async function getAabInfo(fn: string) {
  const protobuf = require('protobufjs') as typeof import('protobufjs');
  const root = await protobuf.load(
    path.join(__dirname, '../../proto/Resources.proto'),
  );
  const XmlNode = root.lookupType('aapt.pb.XmlNode');

  const buffer = await readZipEntry(fn, 'base/manifest/AndroidManifest.xml');

  const message = XmlNode.decode(buffer);
  const object = XmlNode.toObject(message, {
    enums: String,
    longs: String,
    bytes: String,
    defaults: true,
    arrays: true,
  }) as AabXmlNodeObject;

  const manifestElement = object.element;
  if (manifestElement.name !== 'manifest') {
    throw new Error('Invalid manifest');
  }

  let versionName = '';
  for (const attr of manifestElement.attribute) {
    if (attr.name === 'versionName') {
      versionName = attr.value;
    }
  }

  let buildTime = 0;
  const appCredential = {};

  // Find application node
  const applicationNode = manifestElement.child.find(
    (child) => child.element?.name === 'application',
  );
  const applicationElement = applicationNode?.element;
  if (applicationElement) {
    const metaDataNodes = applicationElement.child.filter(
      (child) => child.element?.name === 'meta-data',
    );
    for (const meta of metaDataNodes) {
      let name = '';
      let value = '';
      let resourceId = 0;

      const metaElement = meta.element;
      if (!metaElement) {
        continue;
      }
      for (const attr of metaElement.attribute) {
        if (attr.name === 'name') {
          name = attr.value;
        }
        if (attr.name === 'value') {
          value = attr.value;
          if (attr.compiledItem?.ref?.id) {
            resourceId = attr.compiledItem.ref.id;
          } else if (attr.compiledItem?.prim?.intDecimalValue) {
            value = attr.compiledItem.prim.intDecimalValue.toString();
          }
        }
      }

      if (name === 'pushy_build_time') {
        if (resourceId > 0) {
          const resolvedValue = await resolveResource(fn, resourceId, root);
          if (resolvedValue) {
            value = resolvedValue;
          }
        }
        buildTime = Number(value);
      }
    }
  }

  if (buildTime === 0) {
    throw new Error(t('buildTimeNotFound'));
  }

  return { versionName, buildTime, ...appCredential };
}

async function readZipEntry(fn: string, entryName: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    openZipFile(fn, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) {
        reject(err ?? new Error('Failed to open zip file'));
        return;
      }
      let found = false;
      zipfile.readEntry();
      zipfile.on('entry', (entry: YauzlEntry) => {
        if (entry.fileName === entryName) {
          found = true;
          zipfile.openReadStream(entry, (streamError, readStream) => {
            if (streamError || !readStream) {
              reject(streamError ?? new Error('Failed to read zip entry'));
              return;
            }
            const chunks: Buffer[] = [];
            readStream.on('data', (chunk: Buffer) => chunks.push(chunk));
            readStream.on('end', () => resolve(Buffer.concat(chunks)));
            readStream.on('error', reject);
          });
        } else {
          zipfile.readEntry();
        }
      });
      zipfile.on('end', () => {
        if (!found) reject(new Error(`${entryName} not found in AAB`));
      });
      zipfile.on('error', reject);
    });
  });
}

async function resolveResource(
  fn: string,
  resourceId: number,
  root: ProtobufRoot,
): Promise<string | null> {
  const pkgId = (resourceId >> 24) & 0xff;
  const typeId = (resourceId >> 16) & 0xff;
  const entryId = resourceId & 0xffff;

  try {
    const buffer = await readZipEntry(fn, 'base/resources.pb');
    const ResourceTable = root.lookupType('aapt.pb.ResourceTable');
    const message = ResourceTable.decode(buffer);
    const object = ResourceTable.toObject(message, {
      enums: String,
      longs: String,
      bytes: String,
      defaults: true,
      arrays: true,
    }) as AabResourceTableObject;

    // Find package
    const pkg = object.package.find((pkgItem) => pkgItem.packageId === pkgId);
    if (!pkg) return null;

    // Find type
    const type = pkg.type.find((typeItem) => typeItem.typeId === typeId);
    if (!type) return null;

    // Find entry
    const entry = type.entry.find((entryItem) => entryItem.entryId === entryId);
    if (!entry) return null;

    // Get value from configValue
    if (entry.configValue && entry.configValue.length > 0) {
      const val = entry.configValue[0]?.value;
      const stringValue = val?.item?.str?.value;
      if (typeof stringValue === 'string') {
        return stringValue;
      }
    }
  } catch (e) {
    console.warn('Failed to resolve resource:', e);
  }
  return null;
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
    // useCache: true,
    requestOptions: {
      timeout: 2000,
    },
  })
    .then((pkgs) => pkgs.map((pkg) => pkg.latest))
    .catch(() => []);
}

export async function printVersionCommand() {
  let [latestRnuCliVersion, latestRnuVersion] = await getLatestVersion([
    'react-native-update-cli',
    'react-native-update',
  ]);
  latestRnuCliVersion = latestRnuCliVersion
    ? ` ${t('latestVersionTag', {
        version: chalk.green(latestRnuCliVersion),
      })}`
    : '';
  console.log(`react-native-update-cli: ${pkg.version}${latestRnuCliVersion}`);
  const rnuVersion = depVersions['react-native-update'];
  if (rnuVersion) {
    latestRnuVersion = latestRnuVersion
      ? ` ${t('latestVersionTag', { version: chalk.green(latestRnuVersion) })}`
      : '';
    console.log(`react-native-update: ${rnuVersion}${latestRnuVersion}`);
    if (IS_CRESC) {
      if (satisfies(rnuVersion, '<10.27.0')) {
        console.error(
          'Unsupported version, please update to the latest version: npm i react-native-update@latest',
        );
        process.exit(1);
      }
    } else {
      if (satisfies(rnuVersion, '<8.5.2')) {
        console.warn(
          `当前版本已不再支持，请至少升级到 v8 的最新小版本后重新打包（代码无需改动）: npm i react-native-update@8 .
          如有使用安装 apk 的功能，请注意添加所需权限 https://pushy.reactnative.cn/docs/api#async-function-downloadandinstallapkurl`,
        );
      } else if (satisfies(rnuVersion, '9.0.0 - 9.2.1')) {
        console.warn(
          `当前版本已不再支持，请至少升级到 v9 的最新小版本后重新打包（代码无需改动，可直接热更）: npm i react-native-update@9 .
          如有使用安装 apk 的功能，请注意添加所需权限 https://pushy.reactnative.cn/docs/api#async-function-downloadandinstallapkurl`,
        );
      } else if (satisfies(rnuVersion, '10.0.0 - 10.17.0')) {
        console.warn(
          '当前版本已不再支持，请升级到 v10 的最新小版本（代码无需改动，可直接热更）: npm i react-native-update@10',
        );
      }
    }
  } else {
    console.log(t('rnuVersionNotFound'));
  }
}

export { checkPlugins };
