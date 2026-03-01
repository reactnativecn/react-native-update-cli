#!/usr/bin/env ts-node

import { moduleManager } from '../../src/module-manager';
import { customWorkflows } from '../workflows/custom-workflows';

/**
 * 工作流演示脚本
 * 展示如何注册和执行复杂的工作流
 */

async function registerCustomWorkflows() {
  console.log('📋 注册自定义工作流...\n');

  const provider = moduleManager.getProvider();

  // 注册所有自定义工作流
  for (const workflow of customWorkflows) {
    provider.registerWorkflow(workflow);
    console.log(`✅ 注册工作流: ${workflow.name} - ${workflow.description}`);
  }

  console.log('\n📋 所有工作流注册完成\n');
}

/**
 * 演示灰度发布工作流
 */
async function demonstrateCanaryDeployment() {
  console.log('🔥 演示灰度发布工作流\n');
  console.log('='.repeat(60));

  try {
    const result = await moduleManager.executeWorkflow('canary-deployment', {
      args: [],
      options: {
        version: '2.1.0',
        initialRollout: 10,
        autoExpand: true,
      },
    });

    console.log('\n📊 灰度发布工作流结果:');
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('❌ 灰度发布工作流执行失败:', error);
  }

  console.log(`\n${'='.repeat(60)}\n`);
}

/**
 * 演示多环境发布工作流
 */
async function demonstrateMultiEnvironmentDeploy() {
  console.log('🌍 演示多环境发布工作流\n');
  console.log('='.repeat(60));

  try {
    const result = await moduleManager.executeWorkflow('multi-env-deploy', {
      args: [],
      options: {
        version: '2.1.0',
        skipProduction: false,
        forceProduction: false,
      },
    });

    console.log('\n📊 多环境发布工作流结果:');
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('❌ 多环境发布工作流执行失败:', error);
  }

  console.log(`\n${'='.repeat(60)}\n`);
}

/**
 * 演示回滚工作流
 */
async function demonstrateRollbackWorkflow() {
  console.log('🔄 演示回滚工作流\n');
  console.log('='.repeat(60));

  try {
    const result = await moduleManager.executeWorkflow('rollback-workflow', {
      args: [],
      options: {
        targetVersion: '2.0.5',
        skipVerification: false,
      },
    });

    console.log('\n📊 回滚工作流结果:');
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('❌ 回滚工作流执行失败:', error);
  }

  console.log(`\n${'='.repeat(60)}\n`);
}

/**
 * 演示工作流验证失败的情况
 */
async function demonstrateWorkflowValidation() {
  console.log('⚠️ 演示工作流验证\n');
  console.log('='.repeat(60));

  // 1. 演示缺少必需参数的情况
  console.log('--- 测试缺少必需参数 ---');
  try {
    await moduleManager.executeWorkflow('canary-deployment', {
      args: [],
      options: {}, // 缺少 version 参数
    });
  } catch (error) {
    console.log(
      '✅ 正确捕获验证错误:',
      error instanceof Error ? error.message : error,
    );
  }

  console.log('\n--- 测试回滚工作流验证 ---');
  try {
    await moduleManager.executeWorkflow('rollback-workflow', {
      args: [],
      options: {}, // 缺少 targetVersion 参数
    });
  } catch (error) {
    console.log(
      '✅ 正确捕获验证错误:',
      error instanceof Error ? error.message : error,
    );
  }

  console.log(`\n${'='.repeat(60)}\n`);
}

/**
 * 演示工作流的条件执行
 */
async function demonstrateConditionalExecution() {
  console.log('🔀 演示条件执行\n');
  console.log('='.repeat(60));

  // 演示跳过生产部署
  console.log('--- 跳过生产环境部署 ---');
  try {
    const result = await moduleManager.executeWorkflow('multi-env-deploy', {
      args: [],
      options: {
        version: '2.1.1',
        skipProduction: true, // 跳过生产部署
      },
    });

    console.log('📊 跳过生产部署的结果:');
    console.log(`包含生产部署步骤: ${result.data?.production ? '是' : '否'}`);
  } catch (error) {
    console.error('❌ 条件执行演示失败:', error);
  }

  console.log(`\n${'='.repeat(60)}\n`);
}

/**
 * 列出所有可用的工作流
 */
async function listAvailableWorkflows() {
  console.log('📋 可用工作流列表\n');
  console.log('='.repeat(60));

  const workflows = moduleManager.listWorkflows();

  for (const [index, workflow] of workflows.entries()) {
    console.log(`${index + 1}. ${workflow.name}`);
    console.log(`   描述: ${workflow.description || '无描述'}`);
    console.log(`   步骤数: ${workflow.steps.length}`);

    if (workflow.options) {
      console.log('   选项:');
      for (const [key, option] of Object.entries(workflow.options)) {
        const opt = option as any;
        const required = opt.hasValue && !opt.default;
        console.log(
          `     --${key}: ${opt.description || '无描述'} ${required ? '(必需)' : ''}`,
        );
      }
    }
    console.log();
  }

  console.log(`${'='.repeat(60)}\n`);
}

/**
 * 主函数
 */
async function main() {
  console.log('🎯 工作流演示脚本\n');

  try {
    // 1. 注册自定义工作流
    await registerCustomWorkflows();

    // 2. 列出所有可用工作流
    await listAvailableWorkflows();

    // 3. 演示各种工作流
    await demonstrateCanaryDeployment();
    await demonstrateMultiEnvironmentDeploy();
    await demonstrateRollbackWorkflow();

    // 4. 演示验证和条件执行
    await demonstrateWorkflowValidation();
    await demonstrateConditionalExecution();

    console.log('🎉 所有工作流演示完成!');
  } catch (error) {
    console.error('❌ 演示过程中发生错误:', error);
    process.exit(1);
  }
}

/**
 * 交互式工作流执行
 */
async function interactiveWorkflowExecution() {
  console.log('\n🎮 交互式工作流执行\n');

  const workflowName = process.argv[3];

  if (!workflowName) {
    console.log('使用方法:');
    console.log('  npm run workflow-demo [工作流名称]');
    console.log('\n可用的工作流:');
    console.log('  - canary-deployment');
    console.log('  - multi-env-deploy');
    console.log('  - rollback-workflow');
    return;
  }

  // 解析命令行参数
  const options: Record<string, any> = {};
  for (let i = 4; i < process.argv.length; i += 2) {
    const key = process.argv[i]?.replace(/^--/, '');
    const value = process.argv[i + 1];
    if (key && value) {
      options[key] = value;
    }
  }

  console.log(`执行工作流: ${workflowName}`);
  console.log('参数:', options);
  console.log();

  try {
    await registerCustomWorkflows();

    const result = await moduleManager.executeWorkflow(workflowName, {
      args: [],
      options,
    });

    console.log('\n📊 工作流执行结果:');
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('❌ 工作流执行失败:', error);
    process.exit(1);
  }
}

// 执行脚本
if (require.main === module) {
  if (process.argv.length > 2 && process.argv[2] === 'interactive') {
    interactiveWorkflowExecution()
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
