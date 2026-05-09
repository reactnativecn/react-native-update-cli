#!/usr/bin/env ts-node

import { CLIProviderImpl } from '../../src/provider';
import type { CLIProvider, Platform } from '../../src/types';

class DeploymentService {
  private provider: CLIProvider;

  constructor() {
    this.provider = new CLIProviderImpl();
  }

  async buildAndPublish(platform: Platform, version: string) {
    console.log(`开始 ${platform} 平台构建和发布，版本: ${version}`);

    const bundleResult = await this.provider.bundle({
      platform,
      dev: false,
      sourcemap: true,
      bundleName: `app-${version}.bundle`,
    });

    if (!bundleResult.success) {
      throw new Error(`打包失败: ${bundleResult.error}`);
    }

    const publishResult = await this.provider.publish({
      name: version,
      description: `自动发布版本 ${version}`,
      rollout: 100,
    });

    if (!publishResult.success) {
      throw new Error(`发布失败: ${publishResult.error}`);
    }

    return {
      success: true,
      bundleData: bundleResult.data,
      publishData: publishResult.data,
    };
  }

  async manageApp(platform: Platform) {
    const { appId } = await this.provider.getSelectedApp(platform);
    console.log(`当前应用 ID: ${appId}`);

    const versionsResult = await this.provider.listVersions(appId);
    console.log('版本结果:', versionsResult);

    return { appId, platform };
  }

  async batchBundle() {
    const platforms: Platform[] = ['ios', 'android'];
    const results = [];

    for (const platform of platforms) {
      const bundleResult = await this.provider.bundle({
        platform,
        dev: true,
        sourcemap: false,
      });

      results.push({
        platform,
        success: bundleResult.success,
        data: bundleResult.data,
        error: bundleResult.error,
      });
    }

    return results;
  }
}

async function main() {
  const service = new DeploymentService();

  await service.buildAndPublish('ios', '1.2.3');
  await service.manageApp('ios');

  const batchResults = await service.batchBundle();
  console.log('批量打包结果:', batchResults);
}

if (require.main === module) {
  main()
    .then(() => {
      console.log('Provider API 示例执行完成');
      process.exit(0);
    })
    .catch((error) => {
      console.error('示例执行失败:', error);
      process.exit(1);
    });
}
