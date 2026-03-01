#!/usr/bin/env ts-node

import { moduleManager } from '../../src/module-manager';
import { enhancedCoreWorkflows } from '../workflows/enhanced-core-workflows';

/**
 * 增强核心工作流演示脚本
 * 展示如何使用为核心模块设计的高级工作流
 */

async function registerEnhancedWorkflows() {
  console.log('📦 注册增强核心工作流...\n');

  const provider = moduleManager.getProvider();

  // 注册所有增强核心工作流
  for (const workflow of enhancedCoreWorkflows) {
    provider.registerWorkflow(workflow);
    console.log(`✅ 注册工作流: ${workflow.name}`);
    console.log(`   描述: ${workflow.description}`);
    console.log(`   步骤数: ${workflow.steps.length}`);
    console.log();
  }

  console.log('📋 所有增强核心工作流注册完成\n');
}

/**
 * 演示App模块工作流
 */
async function demonstrateAppWorkflows() {
  console.log('📱 演示App模块增强工作流\n');
  console.log('='.repeat(70));

  // 1. 应用初始化工作流
  console.log('🚀 应用初始化工作流演示');
  console.log('-'.repeat(40));

  try {
    const initResult = await moduleManager.executeWorkflow(
      'app-initialization',
      {
        args: [],
        options: {
          name: 'MyAwesomeApp',
          platform: 'ios',
          downloadUrl: 'https://example.com/download',
          force: false,
        },
      },
    );

    console.log('\\n📊 应用初始化结果:');
    console.log(
      `创建状态: ${initResult.data?.created ? '✅ 成功' : '❌ 失败'}`,
    );
    console.log(
      `配置状态: ${initResult.data?.configured ? '✅ 成功' : '❌ 失败'}`,
    );
    console.log(
      `验证状态: ${initResult.data?.verified ? '✅ 成功' : '❌ 失败'}`,
    );
  } catch (error) {
    console.error(
      '❌ 应用初始化工作流失败:',
      error instanceof Error ? error.message : error,
    );
  }

  console.log(`\\n${'-'.repeat(40)}`);

  // 2. 多平台应用管理工作流
  console.log('\\n🌍 多平台应用管理工作流演示');
  console.log('-'.repeat(40));

  try {
    const managementResult = await moduleManager.executeWorkflow(
      'multi-platform-app-management',
      {
        args: [],
        options: {
          includeInactive: true,
          autoOptimize: true,
        },
      },
    );

    console.log('\\n📊 多平台管理结果:');
    if (managementResult.data?.analysis) {
      const analysis = managementResult.data.analysis;
      console.log(`总应用数: ${analysis.totalApps}`);
      console.log(`活跃应用: ${analysis.activeApps}`);
      console.log(`平台分布: ${JSON.stringify(analysis.platformDistribution)}`);
    }
  } catch (error) {
    console.error(
      '❌ 多平台应用管理工作流失败:',
      error instanceof Error ? error.message : error,
    );
  }

  console.log(`\\n${'='.repeat(70)}\\n`);
}

/**
 * 演示Bundle模块工作流
 */
async function demonstrateBundleWorkflows() {
  console.log('📦 演示Bundle模块增强工作流\n');
  console.log('='.repeat(70));

  // 1. 智能打包工作流
  console.log('🧠 智能打包工作流演示');
  console.log('-'.repeat(40));

  try {
    const bundleResult = await moduleManager.executeWorkflow(
      'intelligent-bundle',
      {
        args: [],
        options: {
          platform: 'ios',
          dev: false,
          sourcemap: true,
          optimize: true,
        },
      },
    );

    console.log('\\n📊 智能打包结果:');
    if (bundleResult.data?.buildResults) {
      const builds = bundleResult.data.buildResults;
      for (const build of builds as Array<Record<string, unknown>>) {
        console.log(
          `${build.platform}: ${build.success ? '✅ 成功' : '❌ 失败'} (${build.buildTime}s, ${build.bundleSize}MB)`,
        );
      }
    }

    if (bundleResult.data?.averageScore) {
      console.log(`平均质量评分: ${bundleResult.data.averageScore}%`);
    }
  } catch (error) {
    console.error(
      '❌ 智能打包工作流失败:',
      error instanceof Error ? error.message : error,
    );
  }

  console.log(`\\n${'-'.repeat(40)}`);

  // 2. 增量构建工作流
  console.log('\\n🔄 增量构建工作流演示');
  console.log('-'.repeat(40));

  try {
    const incrementalResult = await moduleManager.executeWorkflow(
      'incremental-build',
      {
        args: [],
        options: {
          platform: 'android',
          baseVersion: 'v1.0.0',
          skipValidation: false,
        },
      },
    );

    console.log('\\n📊 增量构建结果:');
    if (incrementalResult.data?.diffPackage) {
      const diff = incrementalResult.data.diffPackage;
      console.log(`基准版本: ${diff.fromVersion}`);
      console.log(`目标版本: ${diff.toVersion}`);
      console.log(`原始大小: ${diff.originalSize}MB`);
      console.log(`差异包大小: ${diff.diffSize}MB`);
      console.log(`压缩比: ${diff.compressionRatio}%`);
    }

    console.log(
      `验证状态: ${incrementalResult.data?.allValid ? '✅ 通过' : '❌ 失败'}`,
    );
  } catch (error) {
    console.error(
      '❌ 增量构建工作流失败:',
      error instanceof Error ? error.message : error,
    );
  }

  console.log(`\\n${'='.repeat(70)}\\n`);
}

/**
 * 演示Package模块工作流
 */
async function demonstratePackageWorkflows() {
  console.log('📄 演示Package模块增强工作流\n');
  console.log('='.repeat(70));

  // 批量包处理工作流
  console.log('📦 批量包处理工作流演示');
  console.log('-'.repeat(40));

  try {
    const packageResult = await moduleManager.executeWorkflow(
      'batch-package-processing',
      {
        args: [],
        options: {
          directory: './packages',
          pattern: '*.{ipa,apk,app}',
          skipUpload: false,
        },
      },
    );

    console.log('\\n📊 批量包处理结果:');
    if (packageResult.data?.report) {
      const report = packageResult.data.report;
      console.log(`总包数: ${report.summary.totalPackages}`);
      console.log(`解析成功: ${report.summary.parsedSuccessfully}`);
      console.log(`上传成功: ${report.summary.uploadedSuccessfully}`);
      console.log(`总大小: ${report.summary.totalSize.toFixed(1)}MB`);

      if (report.failedOperations.length > 0) {
        console.log('\\n❌ 失败操作:');
        for (const op of report.failedOperations as Array<
          Record<string, unknown>
        >) {
          console.log(`  ${op.operation}: ${op.file}`);
        }
      }
    }
  } catch (error) {
    console.error(
      '❌ 批量包处理工作流失败:',
      error instanceof Error ? error.message : error,
    );
  }

  console.log(`\\n${'='.repeat(70)}\\n`);
}

/**
 * 演示Version模块工作流
 */
async function demonstrateVersionWorkflows() {
  console.log('🏷️ 演示Version模块增强工作流\n');
  console.log('='.repeat(70));

  // 版本发布管理工作流
  console.log('🚀 版本发布管理工作流演示');
  console.log('-'.repeat(40));

  try {
    const versionResult = await moduleManager.executeWorkflow(
      'version-release-management',
      {
        args: [],
        options: {
          name: 'v2.1.0',
          description: 'Major feature update with bug fixes',
          platform: 'ios',
          rollout: 50,
          dryRun: true, // 使用模拟发布
          force: false,
        },
      },
    );

    console.log('\\n📊 版本发布结果:');
    if (versionResult.data?.summary) {
      const summary = versionResult.data.summary;
      console.log(`版本: ${summary.version}`);
      console.log(`平台: ${summary.platform}`);
      console.log(`发布状态: ${summary.success ? '✅ 成功' : '❌ 失败'}`);
      console.log(
        `监控状态: ${summary.monitoringHealthy ? '✅ 正常' : '⚠️ 有警告'}`,
      );

      if (summary.releaseId) {
        console.log(`发布ID: ${summary.releaseId}`);
      }
    }

    if (versionResult.data?.dryRun) {
      console.log('\\n🔍 这是一次模拟发布，未实际执行');
    }
  } catch (error) {
    console.error(
      '❌ 版本发布管理工作流失败:',
      error instanceof Error ? error.message : error,
    );
  }

  console.log(`\\n${'='.repeat(70)}\\n`);
}

/**
 * 演示工作流组合使用
 */
async function demonstrateWorkflowComposition() {
  console.log('🔗 演示工作流组合使用\n');
  console.log('='.repeat(70));

  console.log('📋 完整发布流程演示 (应用初始化 → 智能打包 → 版本发布)');
  console.log('-'.repeat(60));

  try {
    // 1. 应用初始化
    console.log('\\n步骤 1: 应用初始化');
    const appResult = await moduleManager.executeWorkflow(
      'app-initialization',
      {
        args: [],
        options: {
          name: 'CompositeApp',
          platform: 'android',
          force: true,
        },
      },
    );

    if (!appResult.success) {
      throw new Error('应用初始化失败');
    }

    // 2. 智能打包
    console.log('\\n步骤 2: 智能打包');
    const bundleResult = await moduleManager.executeWorkflow(
      'intelligent-bundle',
      {
        args: [],
        options: {
          platform: 'android',
          dev: false,
          optimize: true,
        },
      },
    );

    if (!bundleResult.success) {
      throw new Error('智能打包失败');
    }

    // 3. 版本发布
    console.log('\\n步骤 3: 版本发布');
    const releaseResult = await moduleManager.executeWorkflow(
      'version-release-management',
      {
        args: [],
        options: {
          name: 'v1.0.0',
          description: 'Initial release via composition workflow',
          platform: 'android',
          rollout: 10,
          dryRun: true,
        },
      },
    );

    if (!releaseResult.success) {
      throw new Error('版本发布失败');
    }

    console.log('\\n🎉 完整发布流程执行成功!');
    console.log('📊 流程总结:');
    console.log(
      `  ✅ 应用初始化: ${appResult.data?.created ? '成功' : '失败'}`,
    );
    console.log(
      `  ✅ 智能打包: ${bundleResult.data?.allSuccess ? '成功' : '失败'}`,
    );
    console.log(
      `  ✅ 版本发布: ${releaseResult.data?.summary?.success ? '成功' : '失败'}`,
    );
  } catch (error) {
    console.error(
      '❌ 工作流组合执行失败:',
      error instanceof Error ? error.message : error,
    );
  }

  console.log(`\\n${'='.repeat(70)}\\n`);
}

/**
 * 列出所有增强工作流及其用途
 */
async function listEnhancedWorkflows() {
  console.log('📋 增强核心工作流列表\n');
  console.log('='.repeat(70));

  const workflowCategories = {
    App模块工作流: [
      {
        name: 'app-initialization',
        description: '完整应用初始化流程 - 创建、配置、验证',
        useCase: '新应用创建和设置',
      },
      {
        name: 'multi-platform-app-management',
        description: '多平台应用统一管理工作流',
        useCase: '跨平台应用管理和优化',
      },
    ],
    Bundle模块工作流: [
      {
        name: 'intelligent-bundle',
        description: '智能打包工作流 - 自动优化和多平台构建',
        useCase: '高效的自动化构建',
      },
      {
        name: 'incremental-build',
        description: '增量构建工作流 - 生成差异包',
        useCase: '减少更新包大小',
      },
    ],
    Package模块工作流: [
      {
        name: 'batch-package-processing',
        description: '批量包处理工作流 - 上传、解析、验证',
        useCase: '批量处理应用包文件',
      },
    ],
    Version模块工作流: [
      {
        name: 'version-release-management',
        description: '版本发布管理工作流 - 完整的版本发布生命周期',
        useCase: '规范化版本发布流程',
      },
    ],
  };

  for (const [category, workflows] of Object.entries(workflowCategories)) {
    console.log(`\\n📂 ${category}:`);
    console.log('-'.repeat(50));

    for (const [index, workflow] of workflows.entries()) {
      console.log(`${index + 1}. ${workflow.name}`);
      console.log(`   描述: ${workflow.description}`);
      console.log(`   用途: ${workflow.useCase}`);
      console.log();
    }
  }

  console.log(`${'='.repeat(70)}\\n`);
}

/**
 * 主函数
 */
async function main() {
  console.log('🎯 增强核心工作流演示脚本\\n');

  try {
    // 1. 注册增强工作流
    await registerEnhancedWorkflows();

    // 2. 列出所有工作流
    await listEnhancedWorkflows();

    // 3. 演示各模块工作流
    await demonstrateAppWorkflows();
    await demonstrateBundleWorkflows();
    await demonstratePackageWorkflows();
    await demonstrateVersionWorkflows();

    // 4. 演示工作流组合
    await demonstrateWorkflowComposition();

    console.log('🎉 所有增强核心工作流演示完成!');
  } catch (error) {
    console.error('❌ 演示过程中发生错误:', error);
    process.exit(1);
  }
}

/**
 * 交互式工作流执行
 */
async function interactiveEnhancedWorkflowExecution() {
  console.log('\\n🎮 交互式增强工作流执行\\n');

  const workflowName = process.argv[3];

  if (!workflowName) {
    console.log('使用方法:');
    console.log('  npm run enhanced-workflow-demo [工作流名称]');
    console.log('\\n可用的增强工作流:');
    console.log('  App模块:');
    console.log('    - app-initialization');
    console.log('    - multi-platform-app-management');
    console.log('  Bundle模块:');
    console.log('    - intelligent-bundle');
    console.log('    - incremental-build');
    console.log('  Package模块:');
    console.log('    - batch-package-processing');
    console.log('  Version模块:');
    console.log('    - version-release-management');
    return;
  }

  // 解析命令行参数
  const options: Record<string, any> = {};
  for (let i = 4; i < process.argv.length; i += 2) {
    const key = process.argv[i]?.replace(/^--/, '');
    const value = process.argv[i + 1];
    if (key && value) {
      // 尝试解析布尔值和数字
      if (value === 'true') options[key] = true;
      else if (value === 'false') options[key] = false;
      else if (/^\d+$/.test(value)) options[key] = Number.parseInt(value);
      else options[key] = value;
    }
  }

  console.log(`执行增强工作流: ${workflowName}`);
  console.log('参数:', options);
  console.log();

  try {
    await registerEnhancedWorkflows();

    const result = await moduleManager.executeWorkflow(workflowName, {
      args: [],
      options,
    });

    console.log('\\n📊 工作流执行结果:');
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('❌ 工作流执行失败:', error);
    process.exit(1);
  }
}

// 执行脚本
if (require.main === module) {
  if (process.argv.length > 2 && process.argv[2] === 'interactive') {
    interactiveEnhancedWorkflowExecution()
      .then(() => process.exit(0))
      .catch((error) => {
        console.error('❌ 交互式执行失败:', error);
        process.exit(1);
      });
  } else {
    main()
      .then(() => process.exit(0))
      .catch((error) => {
        console.error('❌ 演示脚本执行失败:', error);
        process.exit(1);
      });
  }
}
