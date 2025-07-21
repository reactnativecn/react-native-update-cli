import { get, getAllPackages, post, put, uploadFile } from './api';
import { question, saveToLocal } from './utils';
import { t } from './utils/i18n';

import chalk from 'chalk';
import { satisfies } from 'compare-versions';
import type { Package, Platform, Version } from './types';
import { getPlatform, getSelectedApp } from './app';
import { choosePackage } from './package';
import { depVersions } from './utils/dep-versions';
import { getCommitInfo } from './utils/git';

interface VersionCommandOptions {
  appId?: string;
  name?: string;
  description?: string;
  metaInfo?: string;
  platform?: Platform;
  versionId?: string;
  packageId?: string;
  packageVersion?: string;
  minPackageVersion?: string;
  maxPackageVersion?: string;
  packageVersionRange?: string;
  rollout?: string;
  dryRun?: boolean;
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

export const bindVersionToPackages = async ({
  appId,
  versionId,
  pkgs,
  rollout,
  dryRun,
}: {
  appId: string;
  versionId: string;
  pkgs: Package[];
  rollout?: number;
  dryRun?: boolean;
}) => {
  if (dryRun) {
    console.log(chalk.yellow(t('dryRun')));
  }
  if (rollout !== undefined) {
    const rolloutConfig: Record<string, number> = {};
    for (const pkg of pkgs) {
      rolloutConfig[pkg.name] = rollout;
    }
    if (!dryRun) {
      await put(`/app/${appId}/version/${versionId}`, {
        config: {
          rollout: rolloutConfig,
        },
      });
    }
    console.log(
      `${t('rolloutConfigSet', {
        versions: pkgs.map((pkg: Package) => pkg.name).join(', '),
        rollout: rollout,
      })}`,
    );
  }
  for (const pkg of pkgs) {
    if (!dryRun) {
      await put(`/app/${appId}/package/${pkg.id}`, {
        versionId,
      });
    }
    console.log(
      `${t('versionBind', {
        version: versionId,
        nativeVersion: pkg.name,
        id: pkg.id,
      })}`,
    );
  }
  console.log(t('operationComplete', { count: pkgs.length }));
};

export const versionCommands = {
  publish: async function ({
    args,
    options,
  }: {
    args: string[];
    options: VersionCommandOptions;
  }) {
    const fn = args[0];
    const { name, description, metaInfo } = options;

    if (!fn || !fn.endsWith('.ppk')) {
      throw new Error(t('publishUsage'));
    }

    const platform = await getPlatform(options.platform);
    const { appId } = await getSelectedApp(platform);

    const { hash } = await uploadFile(fn);

    const versionName =
      name || (await question(t('versionNameQuestion'))) || t('unnamed');
    const { id } = await post(`/app/${appId}/version/create`, {
      name: versionName,
      hash,
      description:
        description || (await question(t('versionDescriptionQuestion'))),
      metaInfo: metaInfo || (await question(t('versionMetaInfoQuestion'))),
      deps: depVersions,
      commit: await getCommitInfo(),
    });
    // TODO local diff
    saveToLocal(fn, `${appId}/ppk/${id}.ppk`);
    console.log(t('packageUploadSuccess', { id }));

    const {
      packageId,
      packageVersion,
      packageVersionRange,
      minPackageVersion,
      maxPackageVersion,
      rollout,
      dryRun,
    } = options;

    if (
      packageId ||
      packageVersion ||
      packageVersionRange ||
      minPackageVersion ||
      maxPackageVersion
    ) {
      await this.update({
        options: {
          versionId: id,
          platform,
          packageId,
          packageVersion,
          packageVersionRange,
          minPackageVersion,
          maxPackageVersion,
          rollout,
          dryRun,
        },
      });
    } else {
      const q = await question(t('updateNativePackageQuestion'));
      if (q.toLowerCase() === 'y') {
        await this.update({ options: { versionId: id, platform } });
      }
    }
    return versionName;
  },
  versions: async ({ options }: { options: VersionCommandOptions }) => {
    const platform = await getPlatform(options.platform);
    const { appId } = await getSelectedApp(platform);
    await listVersions(appId);
  },
  update: async ({ options }: { options: VersionCommandOptions }) => {
    const platform = await getPlatform(options.platform);
    const appId = options.appId || (await getSelectedApp(platform)).appId;
    let versionId = options.versionId || (await chooseVersion(appId)).id;
    if (versionId === 'null') {
      versionId = undefined;
    }

    let pkgId = options.packageId;
    let pkgVersion = options.packageVersion;
    let minPkgVersion = options.minPackageVersion;
    let maxPkgVersion = options.maxPackageVersion;
    let packageVersionRange = options.packageVersionRange;
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

    const allPkgs = await getAllPackages(appId);

    if (!allPkgs) {
      throw new Error(t('noPackagesFound', { appId }));
    }

    let pkgsToBind: Package[] = [];

    if (minPkgVersion) {
      minPkgVersion = String(minPkgVersion).trim();
      pkgsToBind = allPkgs.filter((pkg: Package) =>
        satisfies(pkg.name, `>=${minPkgVersion}`),
      );
      if (pkgsToBind.length === 0) {
        throw new Error(
          t('nativeVersionNotFoundGte', { version: minPkgVersion }),
        );
      }
    } else if (maxPkgVersion) {
      maxPkgVersion = String(maxPkgVersion).trim();
      pkgsToBind = allPkgs.filter((pkg: Package) =>
        satisfies(pkg.name, `<=${maxPkgVersion}`),
      );
      if (pkgsToBind.length === 0) {
        throw new Error(
          t('nativeVersionNotFoundLte', { version: maxPkgVersion }),
        );
      }
    } else if (pkgVersion) {
      pkgVersion = pkgVersion.trim();
      const pkg = allPkgs.find((pkg: Package) => pkg.name === pkgVersion);
      if (pkg) {
        pkgsToBind = [pkg];
      } else {
        throw new Error(
          t('nativeVersionNotFoundMatch', { version: pkgVersion }),
        );
      }
    } else if (packageVersionRange) {
      packageVersionRange = packageVersionRange.trim();
      pkgsToBind = allPkgs.filter((pkg: Package) =>
        satisfies(pkg.name, packageVersionRange!),
      );
      if (pkgsToBind.length === 0) {
        throw new Error(
          t('nativeVersionNotFoundMatch', { version: packageVersionRange }),
        );
      }
    } else {
      if (!pkgId) {
        pkgId = (await choosePackage(appId)).id;
      }

      if (!pkgId) {
        throw new Error(t('packageIdRequired'));
      }
      const pkg = allPkgs.find(
        (pkg: Package) => String(pkg.id) === String(pkgId),
      );
      if (pkg) {
        pkgsToBind = [pkg];
      } else {
        throw new Error(t('nativePackageIdNotFound', { id: pkgId }));
      }
    }

    await bindVersionToPackages({
      appId,
      versionId,
      pkgs: pkgsToBind,
      rollout,
      dryRun: options.dryRun,
    });
  },
  updateVersionInfo: async ({
    options,
  }: {
    options: VersionCommandOptions;
  }) => {
    const platform = await getPlatform(options.platform);
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
