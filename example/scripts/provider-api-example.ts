#!/usr/bin/env ts-node

import { moduleManager } from '../../src/module-manager';
import type { CLIProvider, Platform } from '../../src/types';

/**
 * Provider API 使用示例
 * 演示如何使用 CLIProvider 进行编程式操作
 */

class DeploymentService {
  private provider: CLIProvider;

  constructor() {
    this.provider = moduleManager.getProvider();
  }

  /**
   * 自动化构建和发布流程
   */
  async buildAndPublish(platform: Platform, version: string) {
    console.log(
      `🚀 开始 ${platform} 平台的构建和发布流程 (版本: ${version})\n`,
    );

    try {
      // 1. 打包应用
      console.log('📦 正在打包应用...');
      const bundleResult = await this.provider.bundle({
        platform,
        dev: false,
        sourcemap: true,
        bundleName: `app-${version}.bundle`,
      });

      if (!bundleResult.success) {
        throw new Error(`打包失败: ${bundleResult.error}`);
      }
      console.log('✅ 打包完成');

      // 2. 发布版本
      console.log('\n📡 正在发布版本...');
      const publishResult = await this.provider.publish({
        name: version,
        description: `自动发布版本 ${version}`,
        rollout: 100,
      });

      if (!publishResult.success) {
        throw new Error(`发布失败: ${publishResult.error}`);
      }
      console.log('✅ 发布完成');

      return {
        success: true,
        bundleData: bundleResult.data,
        publishData: publishResult.data,
      };
    } catch (error) {
      console.error('❌ 构建发布失败:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * 应用管理示例
   */
  async manageApp(platform: Platform) {
    console.log(`📱 管理 ${platform} 应用\n`);

    try {
      // 获取当前选中的应用
      const { appId } = await this.provider.getSelectedApp(platform);
      console.log(`当前应用ID: ${appId}`);

      // 列出应用版本
      const versionsResult = await this.provider.listVersions(appId);
      if (versionsResult.success && versionsResult.data) {
        console.log('📋 应用版本列表:');
        versionsResult.data.forEach((version: any, index: number) => {
          console.log(`  ${index + 1}. ${version.name} (${version.id})`);
        });
      }

      // 列出应用包
      const packagesResult = await (this.provider as any).listPackages(appId);
      if (packagesResult.success && packagesResult.data) {
        console.log('\n📦 应用包列表:');
        packagesResult.data.forEach((pkg: any, index: number) => {
          console.log(`  ${index + 1}. ${pkg.name} (${pkg.id})`);
        });
      }

      return { appId, platform };
    } catch (error) {
      console.error('❌ 应用管理失败:', error);
      throw error;
    }
  }

  /**
   * 批量操作示例
   */
  async batchOperations() {
    console.log('🔄 批量操作示例\n');

    const platforms: Platform[] = ['ios', 'android'];
    const results = [];

    for (const platform of platforms) {
      try {
        console.log(`--- 处理 ${platform} 平台 ---`);

        // 获取平台信息
        const platformInfo = await this.provider.getPlatform(platform);
        console.log(`平台: ${platformInfo}`);

        // 模拟打包操作
        const bundleResult = await this.provider.bundle({
          platform,
          dev: true,
          sourcemap: false,
        });

        results.push({
          platform,
          success: bundleResult.success,
          data: bundleResult.data,
        });

        console.log(
          `${platform} 处理完成: ${bundleResult.success ? '✅' : '❌'}\n`,
        );
      } catch (error) {
        console.error(`${platform} 处理失败:`, error);
        results.push({
          platform,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return results;
  }

  /**
   * 文件上传示例
   */
  async uploadExample() {
    console.log('📤 文件上传示例\n');

    // 模拟上传文件路径
    const mockFilePaths = {
      ios: '/path/to/app.ipa',
      android: '/path/to/app.apk',
    };

    try {
      for (const [platform, filePath] of Object.entries(mockFilePaths)) {
        console.log(`上传 ${platform} 文件: ${filePath}`);

        // 注意：这里是模拟，实际使用时需要真实的文件路径
        const uploadResult = await this.provider.upload({
          platform: platform as Platform,
          filePath,
          appId: 'mock-app-id',
        });

        console.log(
          `${platform} 上传结果:`,
          uploadResult.success ? '✅' : '❌',
        );
        if (!uploadResult.success) {
          console.log(`错误: ${uploadResult.error}`);
        }
      }
    } catch (error) {
      console.error('❌ 上传过程中发生错误:', error);
    }
  }
}

/**
 * 高级工作流示例
 */
async function demonstrateAdvancedWorkflows() {
  console.log('\n🔧 高级工作流示例\n');

  const provider = moduleManager.getProvider();

  // 注册自定义工作流
  provider.registerWorkflow({
    name: 'advanced-ci-cd',
    description: '高级CI/CD流程',
    steps: [
      {
        name: 'environment-check',
        description: '环境检查',
        execute: async (context) => {
          console.log('🔍 检查环境配置...');
          await new Promise((resolve) => setTimeout(resolve, 1000));
          return { environmentValid: true };
        },
      },
      {
        name: 'quality-gate',
        description: '质量门禁',
        execute: async (context, previousResult) => {
          console.log('🛡️ 执行质量门禁检查...');
          await new Promise((resolve) => setTimeout(resolve, 1500));

          // 模拟质量检查
          const qualityScore = Math.random() * 100;
          const passed = qualityScore > 80;

          console.log(
            `质量分数: ${qualityScore.toFixed(1)}/100 ${passed ? '✅' : '❌'}`,
          );

          if (!passed) {
            throw new Error('质量门禁检查未通过');
          }

          return { ...previousResult, qualityScore };
        },
      },
      {
        name: 'multi-platform-build',
        description: '多平台构建',
        execute: async (context, previousResult) => {
          console.log('🏗️ 多平台并行构建...');

          const platforms: Platform[] = ['ios', 'android'];
          const buildResults = [];

          // 模拟并行构建
          for (const platform of platforms) {
            console.log(`  构建 ${platform}...`);
            await new Promise((resolve) => setTimeout(resolve, 800));
            buildResults.push({ platform, success: true });
          }

          return { ...previousResult, builds: buildResults };
        },
      },
      {
        name: 'deployment-notification',
        description: '部署通知',
        execute: async (context, previousResult) => {
          console.log('📢 发送部署通知...');

          const notification = {
            message: '部署完成',
            platforms: previousResult.builds?.map((b: any) => b.platform) || [],
            timestamp: new Date().toISOString(),
          };

          console.log('通知内容:', JSON.stringify(notification, null, 2));

          return { ...previousResult, notification };
        },
      },
    ],
    validate: (context) => {
      if (!context.options.environment) {
        console.error('❌ 必须指定环境参数');
        return false;
      }
      return true;
    },
    options: {
      environment: {
        hasValue: true,
        description: '部署环境 (必需)',
      },
    },
  });

  // 执行高级工作流
  try {
    const result = await provider.executeWorkflow('advanced-ci-cd', {
      args: [],
      options: {
        environment: 'production',
      },
    });
    console.log('\n🎉 高级工作流执行完成:', result);
  } catch (error) {
    console.error('❌ 高级工作流执行失败:', error);
  }
}

/**
 * 主函数
 */
async function main() {
  console.log('🎯 Provider API 使用示例\n');

  const service = new DeploymentService();

  try {
    // 1. 构建和发布示例
    await service.buildAndPublish('ios', '1.2.3');
    console.log(`\n${'='.repeat(50)}\n`);

    // 2. 应用管理示例
    await service.manageApp('ios');
    console.log(`\n${'='.repeat(50)}\n`);

    // 3. 批量操作示例
    const batchResults = await service.batchOperations();
    console.log('批量操作结果:', batchResults);
    console.log(`\n${'='.repeat(50)}\n`);

    // 4. 文件上传示例
    await service.uploadExample();
    console.log(`\n${'='.repeat(50)}\n`);

    // 5. 高级工作流示例
    await demonstrateAdvancedWorkflows();
  } catch (error) {
    console.error('❌ 示例执行失败:', error);
    process.exit(1);
  }
}

// 执行示例
if (require.main === module) {
  main()
    .then(() => {
      console.log('\n✨ Provider API 示例执行完成');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ 示例执行失败:', error);
      process.exit(1);
    });
}
