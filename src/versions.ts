import { get, post, put, uploadFile } from './api';
import { question, saveToLocal } from './utils';
import { t } from './utils/i18n';

import { checkPlatform, getSelectedApp } from './app';
import { choosePackage } from './package';
import { compare } from 'compare-versions';
import { depVersions } from './utils/dep-versions';
import { getCommitInfo } from './utils/git';
import type { Platform } from 'types';

interface Package {
  id: string;
  name: string;
}

interface Version {
  id: string;
  hash: string;
  name: string;
  packages?: Package[];
}

interface CommandOptions {
  name?: string;
  description?: string;
  metaInfo?: string;
  platform?: Platform;
  versionId?: string;
  packageId?: string;
  packageVersion?: string;
  minPackageVersion?: string;
  maxPackageVersion?: string;
  rollout?: string;
}

async function showVersion(appId: string, offset: number) {
  const { data, count } = await get(`/app/${appId}/version/list`);
  console.log(t('offset', { offset }));
  for (const version of data) {
    const pkgCount = version.packages?.length || 0;
    let packageInfo = '';
    if (pkgCount === 0) {
      packageInfo = 'no package';
    } else {
      packageInfo = version.packages
        ?.slice(0, 3)
        .map((pkg: Package) => pkg.name)
        .join(', ');
      if (pkgCount > 3) {
        packageInfo += `...and ${pkgCount - 3} more`;
      } else {
        packageInfo = `[${packageInfo}]`;
      }
    }
    console.log(
      `${version.id}) ${version.hash.slice(0, 8)} ${
        version.name
      } ${packageInfo}`,
    );
  }
  return data;
}

async function listVersions(appId: string) {
  let offset = 0;
  while (true) {
    await showVersion(appId, offset);
    const cmd = await question('page Up/page Down/Begin/Quit(U/D/B/Q)');
    switch (cmd.toLowerCase()) {
      case 'u':
        offset = Math.max(0, offset - 10);
        break;
      case 'd':
        offset += 10;
        break;
      case 'b':
        offset = 0;
        break;
      case 'q':
        return;
    }
  }
}

async function chooseVersion(appId: string) {
  let offset = 0;
  while (true) {
    const data = await showVersion(appId, offset);
    const cmd = await question(
      'Enter versionId or page Up/page Down/Begin(U/D/B)',
    );
    switch (cmd.toUpperCase()) {
      case 'U':
        offset = Math.max(0, offset - 10);
        break;
      case 'D':
        offset += 10;
        break;
      case 'B':
        offset = 0;
        break;
      default: {
        const versionId = Number.parseInt(cmd, 10);
        const v = data.find(
          (version: Version) => version.id === String(versionId),
        );
        if (v) {
          return v;
        }
      }
    }
  }
}

export const commands = {
  publish: async function ({
    args,
    options,
  }: {
    args: string[];
    options: CommandOptions;
  }) {
    const fn = args[0];
    const { name, description, metaInfo } = options;

    if (!fn || !fn.endsWith('.ppk')) {
      throw new Error(
        '使用方法: pushy publish ppk后缀文件 --platform ios|android|harmony',
      );
    }

    const platform = checkPlatform(
      options.platform ||
        ((await question('平台(ios/android/harmony):')) as Platform),
    );
    const { appId } = await getSelectedApp(platform);

    const { hash } = await uploadFile(fn);

    const versionName =
      name || (await question('输入版本名称: ')) || '(未命名)';
    const { id } = await post(`/app/${appId}/version/create`, {
      name: versionName,
      hash,
      description: description || (await question('输入版本描述:')),
      metaInfo: metaInfo || (await question('输入自定义的 meta info:')),
      deps: depVersions,
      commit: await getCommitInfo(),
    });
    // TODO local diff
    saveToLocal(fn, `${appId}/ppk/${id}.ppk`);
    console.log(t('packageUploadSuccess', { id }));

    const v = await question('是否现在将此热更应用到原生包上？(Y/N)');
    if (v.toLowerCase() === 'y') {
      await this.update({ args: [], options: { versionId: id, platform } });
    }
    return versionName;
  },
  versions: async ({ options }: { options: CommandOptions }) => {
    const platform = checkPlatform(
      options.platform ||
        ((await question('平台(ios/android/harmony):')) as Platform),
    );
    const { appId } = await getSelectedApp(platform);
    await listVersions(appId);
  },
  update: async ({
    args,
    options,
  }: {
    args: string[];
    options: CommandOptions;
  }) => {
    const platform = checkPlatform(
      options.platform ||
        ((await question('平台(ios/android/harmony):')) as Platform),
    );
    const { appId } = await getSelectedApp(platform);
    let versionId = options.versionId || (await chooseVersion(appId)).id;
    if (versionId === 'null') {
      versionId = undefined;
    }

    let pkgId: string | undefined;
    let pkgVersion = options.packageVersion;
    let minPkgVersion = options.minPackageVersion;
    let maxPkgVersion = options.maxPackageVersion;
    let rollout: number | undefined = undefined;

    if (options.rollout !== undefined) {
      try {
        rollout = Number.parseInt(options.rollout);
      } catch (e) {
        throw new Error(t('rolloutRangeError'));
      }
      if (rollout < 1 || rollout > 100) {
        throw new Error(t('rolloutRangeError'));
      }
    }

    if (minPkgVersion) {
      minPkgVersion = String(minPkgVersion).trim();
      const { data } = await get(`/app/${appId}/package/list?limit=1000`);
      const pkgs = data.filter((pkg: Package) =>
        compare(pkg.name, minPkgVersion, '>='),
      );
      if (pkgs.length === 0) {
        throw new Error(t('nativeVersionNotFound', { version: minPkgVersion }));
      }
      if (rollout !== undefined) {
        const rolloutConfig: Record<string, number> = {};
        for (const pkg of pkgs) {
          rolloutConfig[pkg.name] = rollout;
        }
        await put(`/app/${appId}/version/${versionId}`, {
          config: {
            rollout: rolloutConfig,
          },
        });
        console.log(
          `${t('rolloutConfigSet', {
            versions: pkgs.map((pkg: Package) => pkg.name).join(', '),
            rollout: rollout,
          })}`,
        );
      }
      for (const pkg of pkgs) {
        await put(`/app/${appId}/package/${pkg.id}`, {
          versionId,
        });
        console.log(
          `${t('versionBind', {
            version: versionId,
            nativeVersion: pkg.name,
            id: pkg.id,
          })}`,
        );
      }
      console.log(t('operationComplete', { count: pkgs.length }));
      return;
    }
    if (maxPkgVersion) {
      maxPkgVersion = String(maxPkgVersion).trim();
      const { data } = await get(`/app/${appId}/package/list?limit=1000`);
      const pkgs = data.filter((pkg: Package) =>
        compare(pkg.name, maxPkgVersion, '<='),
      );
      if (pkgs.length === 0) {
        throw new Error(t('nativeVersionNotFoundLess', { version: maxPkgVersion }));
      }
      if (rollout !== undefined) {
        const rolloutConfig: Record<string, number> = {};
        for (const pkg of pkgs) {
          rolloutConfig[pkg.name] = rollout;
        }
        await put(`/app/${appId}/version/${versionId}`, {
          config: {
            rollout: rolloutConfig,
          },
        });
        console.log(
          `${t('rolloutConfigSet', {
            versions: pkgs.map((pkg: Package) => pkg.name).join(', '),
            rollout: rollout,
          })}`,
        );
      }
      for (const pkg of pkgs) {
        await put(`/app/${appId}/package/${pkg.id}`, {
          versionId,
        });
        console.log(
          `${t('versionBind', {
            version: versionId,
            nativeVersion: pkg.name,
            id: pkg.id,
          })}`,
        );
      }
      console.log(t('operationComplete', { count: pkgs.length }));
      return;
    }

    const { data } = await get(`/app/${appId}/package/list?limit=1000`);
    if (pkgVersion) {
      pkgVersion = pkgVersion.trim();
      const pkg = data.find((pkg: Package) => pkg.name === pkgVersion);
      if (pkg) {
        pkgId = pkg.id;
      } else {
        throw new Error(t('nativeVersionNotFoundMatch', { version: pkgVersion }));
      }
    }
    if (!pkgId) {
      pkgId = options.packageId || (await choosePackage(appId)).id;
    }

    if (!pkgId) {
      throw new Error(t('packageIdRequired'));
    }

    if (!pkgVersion) {
      const pkg = data.find((pkg: Package) => String(pkg.id) === String(pkgId));
      if (pkg) {
        pkgVersion = pkg.name;
      }
    }

    if (rollout !== undefined && pkgVersion) {
      await put(`/app/${appId}/version/${versionId}`, {
        config: {
          rollout: {
            [pkgVersion]: rollout,
          },
        },
      });
      console.log(
        `${t('rolloutConfigSet', {
          versions: pkgVersion,
          rollout: rollout,
        })}`,
      );
    }

    if (versionId !== undefined) {
      await put(`/app/${appId}/package/${pkgId}`, {
        versionId,
      });
      console.log(
        `${t('versionBind', {
          version: versionId,
          nativeVersion: pkgVersion,
          id: pkgId,
        })}`,
      );
    }
    console.log(t('operationSuccess'));
  },
  updateVersionInfo: async ({
    args,
    options,
  }: {
    args: string[];
    options: CommandOptions;
  }) => {
    const platform = checkPlatform(
      options.platform ||
        ((await question('平台(ios/android/harmony):')) as Platform),
    );
    const { appId } = await getSelectedApp(platform);
    const versionId = options.versionId || (await chooseVersion(appId)).id;

    const updateParams: Record<string, string> = {};
    if (options.name) updateParams.name = options.name;
    if (options.description) updateParams.description = options.description;
    if (options.metaInfo) updateParams.metaInfo = options.metaInfo;

    await put(`/app/${appId}/version/${versionId}`, updateParams);
    console.log(t('operationSuccess'));
  },
};
