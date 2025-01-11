import { get, post, put, uploadFile } from './api';
import { question, saveToLocal } from './utils';

import { checkPlatform, getSelectedApp } from './app';
import { choosePackage } from './package';
import { compare } from 'compare-versions';

async function showVersion(appId, offset) {
  const { data, count } = await get(`/app/${appId}/version/list`);
  console.log(`Offset ${offset}`);
  for (const version of data) {
    let packageInfo = version.packages
      .slice(0, 3)
      .map((v) => v.name)
      .join(', ');
    const count = version.packages.length;
    if (count > 3) {
      packageInfo += `...and ${count - 3} more`;
    }
    if (count === 0) {
      packageInfo = `(no package)`;
    } else {
      packageInfo = `[${packageInfo}]`;
    }
    console.log(
      `${version.id}) ${version.hash.slice(0, 8)} ${
        version.name
      } ${packageInfo}`,
    );
  }
  return data;
}

async function listVersions(appId) {
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

async function chooseVersion(appId) {
  let offset = 0;
  while (true) {
    const data = await showVersion(appId, offset);
    const cmd = await question(
      'Enter versionId or page Up/page Down/Begin(U/D/B)',
    );
    switch (cmd.toLowerCase()) {
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
        const v = data.find((v) => v.id === (cmd | 0));
        if (v) {
          return v;
        }
      }
    }
  }
}

export const commands = {
  publish: async function ({ args, options }) {
    const fn = args[0];
    const { name, description, metaInfo } = options;

    if (!fn || !fn.endsWith('.ppk')) {
      throw new Error(
        '使用方法: pushy publish ppk后缀文件 --platform ios|android|harmony',
      );
    }

    const platform = checkPlatform(
      options.platform || (await question('平台(ios/android/harmony):')),
    );
    const { appId } = await getSelectedApp(platform);

    const { hash } = await uploadFile(fn);

    const { id } = await post(`/app/${appId}/version/create`, {
      name: name || (await question('输入版本名称: ')) || '(未命名)',
      hash,
      description: description || (await question('输入版本描述:')),
      metaInfo: metaInfo || (await question('输入自定义的 meta info:')),
    });
    // TODO local diff
    saveToLocal(fn, `${appId}/ppk/${id}.ppk`);
    console.log(`已成功上传新热更包（id: ${id}）`);

    const v = await question('是否现在将此热更应用到原生包上？(Y/N)');
    if (v.toLowerCase() === 'y') {
      await this.update({ args: [], options: { versionId: id, platform } });
    }
  },
  versions: async ({ options }) => {
    const platform = checkPlatform(
      options.platform || (await question('平台(ios/android/harmony):')),
    );
    const { appId } = await getSelectedApp(platform);
    await listVersions(appId);
  },
  update: async ({ args, options }) => {
    const platform = checkPlatform(
      options.platform || (await question('平台(ios/android/harmony):')),
    );
    const { appId } = await getSelectedApp(platform);
    let versionId = options.versionId || (await chooseVersion(appId)).id;
    if (versionId === 'null') {
      versionId = null;
    }

    let pkgId;
    let pkgVersion = options.packageVersion;
    let minPkgVersion = options.minPackageVersion;
    let maxPkgVersion = options.maxPackageVersion;
    let rollout = options.rollout;
    if (rollout === undefined) {
      rollout = null;
    } else {
      try {
        rollout = Number.parseInt(rollout);
      } catch (e) {
        throw new Error('rollout 必须是 1-100 的整数');
      }
      if (rollout < 1 || rollout > 100) {
        throw new Error('rollout 必须是 1-100 的整数');
      }
    }
    if (minPkgVersion) {
      minPkgVersion = String(minPkgVersion).trim();
      const { data } = await get(`/app/${appId}/package/list?limit=1000`);
      const pkgs = data.filter((d) => compare(d.name, minPkgVersion, '>='));
      if (pkgs.length === 0) {
        throw new Error(`未查询到 >= ${minPkgVersion} 的原生版本`);
      }
      if (rollout) {
        const rolloutConfig = {};
        for (const pkg of pkgs) {
          rolloutConfig[pkg.name] = rollout;
        }
        await put(`/app/${appId}/version/${versionId}`, {
          config: {
            rollout: rolloutConfig,
          },
        });
        console.log(
          `已在原生版本 ${pkgs
            .map((p) => p.name)
            .join(', ')} 上设置灰度发布 ${rollout}% 热更版本 ${versionId}`,
        );
      }
      for (const pkg of pkgs) {
        await put(`/app/${appId}/package/${pkg.id}`, {
          versionId,
        });
        console.log(
          `已将热更版本 ${versionId} 绑定到原生版本 ${pkg.name} (id: ${pkg.id})`,
        );
      }
      console.log(`操作完成，共已绑定 ${pkgs.length} 个原生版本`);
      return;
    }
    if (maxPkgVersion) {
      maxPkgVersion = String(maxPkgVersion).trim();
      const { data } = await get(`/app/${appId}/package/list?limit=1000`);
      const pkgs = data.filter((d) => compare(d.name, maxPkgVersion, '<='));
      if (pkgs.length === 0) {
        throw new Error(`未查询到 <= ${maxPkgVersion} 的原生版本`);
      }
      if (rollout) {
        const rolloutConfig = {};
        for (const pkg of pkgs) {
          rolloutConfig[pkg.name] = rollout;
        }
        await put(`/app/${appId}/version/${versionId}`, {
          config: {
            rollout: rolloutConfig,
          },
        });
        console.log(
          `已在原生版本 ${pkgs
            .map((p) => p.name)
            .join(', ')} 上设置灰度发布 ${rollout}% 热更版本 ${versionId}`,
        );
      }
      for (const pkg of pkgs) {
        await put(`/app/${appId}/package/${pkg.id}`, {
          versionId,
        });
        console.log(
          `已将热更版本 ${versionId} 绑定到原生版本 ${pkg.name} (id: ${pkg.id})`,
        );
      }
      console.log(`操作完成，共已绑定 ${pkgs.length} 个原生版本`);
      return;
    }

    const { data } = await get(`/app/${appId}/package/list?limit=1000`);
    if (pkgVersion) {
      pkgVersion = pkgVersion.trim();
      const pkg = data.find((d) => d.name === pkgVersion);
      if (pkg) {
        pkgId = pkg.id;
      } else {
        throw new Error(`未查询到匹配原生版本：${pkgVersion}`);
      }
    }
    if (!pkgId) {
      pkgId = options.packageId || (await choosePackage(appId)).id;
    }

    if (!pkgId) {
      throw new Error('请提供 packageId 或 packageVersion 参数');
    }

    if (!pkgVersion) {
      const pkg = data.find((d) => d.id === pkgId);
      if (pkg) {
        pkgVersion = pkg.name;
      }
    }

    if (rollout) {
      await put(`/app/${appId}/version/${versionId}`, {
        config: {
          rollout: {
            [pkgVersion]: rollout,
          },
        },
      });
      console.log(
        `已将在原生版本 ${pkgVersion} (id: ${pkgId}) 上设置灰度发布 ${rollout}% 热更版本 ${versionId} `,
      );
    }
    await put(`/app/${appId}/package/${pkgId}`, {
      versionId,
    });
    console.log(
      `已将热更版本 ${versionId} 绑定到原生版本 ${pkgVersion} (id: ${pkgId})`,
    );
  },
  updateVersionInfo: async ({ args, options }) => {
    const platform = checkPlatform(
      options.platform || (await question('平台(ios/android/harmony):')),
    );
    const { appId } = await getSelectedApp(platform);
    const versionId = options.versionId || (await chooseVersion(appId)).id;

    const updateParams = {};
    options.name && (updateParams.name = options.name);
    options.description && (updateParams.description = options.description);
    options.metaInfo && (updateParams.metaInfo = options.metaInfo);
    await put(`/app/${appId}/version/${versionId}`, updateParams);
    console.log('操作成功');
  },
};
