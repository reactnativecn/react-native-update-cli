#!/usr/bin/env ts-node

import { moduleManager } from '../../src/module-manager';
import { analyticsModule } from '../modules/analytics-module';
import { customDeployModule } from '../modules/custom-deploy-module';

/**
 * 模块注册和执行示例脚本
 * 演示如何注册自定义模块并执行命令
 */

async function main() {
  console.log('🚀 开始模块注册和执行示例\n');

  try {
    // 1. 注册自定义模块
    console.log('📦 注册自定义模块...');
    moduleManager.registerModule(customDeployModule);
    moduleManager.registerModule(analyticsModule);
    console.log('✅ 模块注册完成\n');

    // 2. 列出所有可用的命令
    console.log('📋 可用命令列表:');
    const commands = moduleManager.listCommands();
    for (const cmd of commands) {
      console.log(`  - ${cmd.name}: ${cmd.description || '无描述'}`);
    }
    console.log();

    // 3. 执行自定义命令示例
    console.log('🎯 执行命令示例:\n');

    // 执行开发部署命令
    console.log('--- 执行 deploy-dev 命令 ---');
    const devDeployResult = await moduleManager.executeCommand('deploy-dev', {
      args: [],
      options: {
        platform: 'ios',
        force: true,
      },
    });
    console.log('结果:', devDeployResult);
    console.log();

    // 执行分析统计命令
    console.log('--- 执行 track-deployment 命令 ---');
    const trackResult = await moduleManager.executeCommand('track-deployment', {
      args: [],
      options: {
        platform: 'android',
        environment: 'production',
        version: '1.2.3',
      },
    });
    console.log('结果:', trackResult);
    console.log();

    // 生成部署报告
    console.log('--- 执行 deployment-report 命令 ---');
    const reportResult = await moduleManager.executeCommand(
      'deployment-report',
      {
        args: [],
        options: {
          days: 30,
        },
      },
    );
    console.log('结果:', reportResult);
    console.log();

    console.log('🎉 所有示例执行完成!');
  } catch (error) {
    console.error('❌ 执行过程中发生错误:', error);
    process.exit(1);
  }
}

// 错误处理函数
async function demonstrateErrorHandling() {
  console.log('\n🚨 错误处理示例:\n');

  try {
    // 尝试执行不存在的命令
    console.log('--- 尝试执行不存在的命令 ---');
    await moduleManager.executeCommand('non-existent-command', {
      args: [],
      options: {},
    });
  } catch (error) {
    console.log('捕获错误:', error instanceof Error ? error.message : error);
  }

  try {
    // 尝试执行缺少必需参数的命令
    console.log('\n--- 尝试执行缺少必需参数的命令 ---');
    await moduleManager.executeCommand('deploy-prod', {
      args: [],
      options: {}, // 缺少必需的 version 参数
    });
  } catch (error) {
    console.log('捕获错误:', error instanceof Error ? error.message : error);
  }
}

// 主函数执行
if (require.main === module) {
  main()
    .then(() => demonstrateErrorHandling())
    .then(() => {
      console.log('\n✨ 示例脚本执行完成');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ 脚本执行失败:', error);
      process.exit(1);
    });
}
