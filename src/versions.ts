import { get, getAllPackages, post, put, uploadFile } from './api';
import { question, saveToLocal, translateOptions } from './utils';
import { t } from './utils/i18n';

import { getPlatform, getSelectedApp } from './app';
import { choosePackage } from './package';
import { depVersions, tempDir } from './utils/dep-versions';
import { getCommitInfo } from './utils/git';
import type { Package, Platform, Version } from 'types';
import { satisfies } from 'compare-versions';
import chalk from 'chalk';

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

export interface ExecutePublishOptions {
  platform: Platform;
  appId: string;
  name: string;
  description?: string;
  metaInfo?: string;
  packageVersion?: string; // For the bundle's own versioning, if applicable
  deps?: any;
  commit?: any;
  filePath: string;
}

export async function executePublish({
  filePath,
  platform,
  appId,
  name,
  description,
  metaInfo,
  packageVersion, // This param is for the bundle's own version, if needed.
                   // The original commands.publish didn't explicitly use a 'packageVersion' for the bundle itself,
                   // it used 'name' for the bundle version name. We'll keep 'name' as the primary version identifier.
  deps,
  commit,
}: ExecutePublishOptions): Promise<{ id: string; versionName: string; hash: string }> {
  if (!filePath || !filePath.endsWith('.ppk')) {
    throw new Error(t('publishUsage'));
  }

  const { hash } = await uploadFile(filePath);

  const versionData: any = {
    name, // Name of the bundle version
    hash,
    description,
    metaInfo,
    deps: deps || depVersions,
    commit: commit || (await getCommitInfo()),
  };
  // The field `packageVersion` in `version/create` API seems to refer to the bundle's own version (like `name`)
  // rather than a native target. If `packageVersion` is provided and distinct from `name`,
  // and the API supports it for the bundle itself, it could be added here.
  // For now, `name` serves as the bundle's version name.
  // If 'packageVersion' from options is meant for the bundle's version, it should be mapped to 'name' or an API field.

  const { id } = await post(`/app/${appId}/version/create`, versionData);

  saveToLocal(filePath, `${appId}/ppk/${id}.ppk`);
  console.log(t('packageUploadSuccess', { id }));
  return { id, versionName: name, hash };
}

export interface GetPackagesForUpdateOptions {
  packageVersion?: string;
  minPackageVersion?: string;
  maxPackageVersion?: string;
  packageVersionRange?: string;
  packageId?: string; // Specific package ID to target
}

export async function getPackagesForUpdate(
  appId: string,
  filterOptions: GetPackagesForUpdateOptions,
): Promise<Package[]> {
  const allPkgs = await getAllPackages(appId);
  if (!allPkgs) {
    throw new Error(t('noPackagesFound', { appId }));
  }

  let pkgsToBind: Package[] = [];

  if (filterOptions.minPackageVersion) {
    const minVersion = String(filterOptions.minPackageVersion).trim();
    pkgsToBind = allPkgs.filter((pkg) => satisfies(pkg.name, `>=${minVersion}`));
    if (pkgsToBind.length === 0) {
      throw new Error(t('nativeVersionNotFoundGte', { version: minVersion }));
    }
  } else if (filterOptions.maxPackageVersion) {
    const maxVersion = String(filterOptions.maxPackageVersion).trim();
    pkgsToBind = allPkgs.filter((pkg) => satisfies(pkg.name, `<=${maxVersion}`));
    if (pkgsToBind.length === 0) {
      throw new Error(t('nativeVersionNotFoundLte', { version: maxVersion }));
    }
  } else if (filterOptions.packageVersion) {
    const targetVersion = filterOptions.packageVersion.trim();
    // This was finding one package, now it should find all matching package versions
    pkgsToBind = allPkgs.filter((pkg) => pkg.name === targetVersion);
    if (pkgsToBind.length === 0) {
      throw new Error(t('nativeVersionNotFoundMatch', { version: targetVersion }));
    }
  } else if (filterOptions.packageVersionRange) {
    const range = filterOptions.packageVersionRange.trim();
    pkgsToBind = allPkgs.filter((pkg) => satisfies(pkg.name, range));
    if (pkgsToBind.length === 0) {
      throw new Error(t('nativeVersionNotFoundMatch', { version: range }));
    }
  } else if (filterOptions.packageId) {
    const pkg = allPkgs.find((p) => String(p.id) === String(filterOptions.packageId));
    if (pkg) {
      pkgsToBind = [pkg];
    } else {
      throw new Error(t('nativePackageIdNotFound', { id: filterOptions.packageId }));
    }
  } else {
    // If no filter is provided, it implies an interactive choice or an error if non-interactive.
    // For releaseFull, a filter (packageVersion) is expected.
    // For direct 'pushy update' without filters, it would become interactive.
    throw new Error(t('noPackageFilterProvided'));
  }
  return pkgsToBind;
}


export const commands = {
  publish: async function ({
    args,
    options,
  }: {
    args: string[];
    options: CommandOptions; // CommandOptions from cli.json
  }) {
    const filePath = args[0];
    if (!filePath || !filePath.endsWith('.ppk')) {
      throw new Error(t('publishUsage'));
    }

    const platform = await getPlatform(options.platform);
    const { appId } = await getSelectedApp(platform);

    // Translate options - this might fill in defaults for name, description, metaInfo if not provided by cli.json
    // For publish, cli.json defines name, description, metaInfo, platform.
    // packageVersion is NOT in cli.json for publish command itself.
    // We take it from options if `releaseFull` or `bundle` (after its own patch) passes it.
    const translatedPublishOptions = translateOptions(options, 'publish');

    const name = translatedPublishOptions.name || (global.NO_INTERACTIVE ? t('unnamed') : await question(t('versionNameQuestion'))) || t('unnamed');
    const description = translatedPublishOptions.description || (global.NO_INTERACTIVE ? '' : await question(t('versionDescriptionQuestion')));
    const metaInfo = translatedPublishOptions.metaInfo || (global.NO_INTERACTIVE ? '' : await question(t('versionMetaInfoQuestion')));
    
    // packageVersion here is for the bundle's own versioning, if the API supports it distinctly from 'name'.
    // The original patch note for cli.json's `bundle` command added `packageVersion`.
    // If `options.packageVersion` is passed (e.g. from `bundle` or a direct call with it), use it.
    const bundlePackageVersion = options.packageVersion;


    const { id, versionName } = await executePublish({
      filePath,
      platform,
      appId,
      name,
      description,
      metaInfo,
      packageVersion: bundlePackageVersion, // Pass it to executePublish
      // deps and commit will be fetched by executePublish if not provided
    });

    // Handling of prompt for updating native package
    // This should ideally only happen in interactive CLI `publish` calls,
    // and not when `publish` is part of `releaseFull`.
    // `releaseFull` has its own dedicated update step.
    // If `options.packageVersion` (for native binding) was part of `publish`'s direct options,
    // it might imply an immediate update, but that's not standard for `publish`.
    // The original prompt seems like a convenience for CLI users.
    if (!global.NO_INTERACTIVE && !options.packageVersion) { // Avoid prompt if non-interactive or if native target packageVersion is specified (implying automation)
      const v = await question(t('updateNativePackageQuestion'));
      if (v.toLowerCase() === 'y') {
        // Call the local 'update' command logic
        await commands.update({ args: [], options: { versionId: id, platform } });
      }
    }
    return versionName; // Return the actual version name used for publishing
  },
  versions: async ({ options }: { options: CommandOptions }) => {
    const platform = await getPlatform(options.platform);
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
    const platform = await getPlatform(options.platform);
    const { appId } = await getSelectedApp(platform);
    const versionId = options.versionId || (global.NO_INTERACTIVE ? undefined : (await chooseVersion(appId)).id);

    if (!versionId && global.NO_INTERACTIVE) {
      throw new Error(t('versionIdRequiredNonInteractive'));
    }
    if (versionId === 'null') { // Case where user might have explicitly set it to "null"
        throw new Error(t('versionIdInvalid'));
    }


    let pkgsToBind: Package[];
    // If called non-interactively (e.g. from releaseFull), packageVersion should be primary way to select packages
    if (options.packageVersion || options.minPackageVersion || options.maxPackageVersion || options.packageVersionRange || options.packageId) {
        pkgsToBind = await getPackagesForUpdate(appId, {
            packageVersion: options.packageVersion,
            minPackageVersion: options.minPackageVersion,
            maxPackageVersion: options.maxPackageVersion,
            packageVersionRange: options.packageVersionRange,
            packageId: options.packageId
        });
    } else if (global.NO_INTERACTIVE) {
        throw new Error(t('packageTargetRequiredNonInteractive'));
    } else {
        // Interactive package selection if no specific targeting option is provided
        const chosenPackage = await choosePackage(appId);
        if (!chosenPackage) throw new Error(t('packageSelectionCancelled'));
        pkgsToBind = [chosenPackage];
    }
    
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

    await bindVersionToPackages({
      appId,
      versionId: versionId!, // versionId is guaranteed to be defined or error thrown
      pkgs: pkgsToBind,
      rollout,
      dryRun: options.dryRun,
    });
  },
  updateVersionInfo: async ({
    args,
    options,
  }: {
    args: string[];
    options: CommandOptions;
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
