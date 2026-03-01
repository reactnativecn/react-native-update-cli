import type {
  CLIProvider,
  CommandContext,
  CustomWorkflow,
} from '../../src/types';

/**
 * 自定义工作流集合
 * 演示各种复杂的工作流场景
 */

/**
 * 灰度发布工作流
 */
export const canaryDeploymentWorkflow: CustomWorkflow = {
  name: 'canary-deployment',
  description: '灰度发布工作流 - 逐步增加用户覆盖率',
  steps: [
    {
      name: 'prepare-canary',
      description: '准备灰度发布',
      execute: async (context: CommandContext) => {
        console.log('🔧 准备灰度发布环境...');

        const { version, initialRollout = 5 } = context.options;

        console.log(`📦 版本: ${version}`);
        console.log(`📊 初始覆盖率: ${initialRollout}%`);

        await new Promise((resolve) => setTimeout(resolve, 1000));

        return {
          version,
          currentRollout: initialRollout,
          stage: 'prepared',
        };
      },
    },
    {
      name: 'initial-deployment',
      description: '初始小范围部署',
      execute: async (context: CommandContext, previousResult: any) => {
        console.log('🚀 执行初始小范围部署...');

        const { currentRollout } = previousResult;

        console.log(`部署到 ${currentRollout}% 用户...`);
        await new Promise((resolve) => setTimeout(resolve, 1500));

        console.log('✅ 初始部署完成');

        return {
          ...previousResult,
          deploymentTime: new Date().toISOString(),
          stage: 'initial-deployed',
        };
      },
    },
    {
      name: 'monitor-metrics',
      description: '监控关键指标',
      execute: async (context: CommandContext, previousResult: any) => {
        console.log('📊 监控关键指标...');

        // 模拟监控数据
        const metrics = {
          crashRate: Math.random() * 0.01, // 0-1%
          responseTime: 150 + Math.random() * 100, // 150-250ms
          userSatisfaction: 85 + Math.random() * 10, // 85-95%
          errorRate: Math.random() * 0.005, // 0-0.5%
        };

        console.log('📈 监控结果:');
        console.log(`  崩溃率: ${(metrics.crashRate * 100).toFixed(3)}%`);
        console.log(`  响应时间: ${metrics.responseTime.toFixed(1)}ms`);
        console.log(`  用户满意度: ${metrics.userSatisfaction.toFixed(1)}%`);
        console.log(`  错误率: ${(metrics.errorRate * 100).toFixed(3)}%`);

        // 判断是否可以继续扩大范围
        const canProceed =
          metrics.crashRate < 0.005 &&
          metrics.errorRate < 0.003 &&
          metrics.userSatisfaction > 80;

        console.log(`🔍 健康检查: ${canProceed ? '✅ 通过' : '❌ 未通过'}`);

        return {
          ...previousResult,
          metrics,
          canProceed,
          stage: 'monitored',
        };
      },
    },
    {
      name: 'expand-rollout',
      description: '扩大发布范围',
      execute: async (context: CommandContext, previousResult: any) => {
        const { canProceed, currentRollout } = previousResult;

        if (!canProceed) {
          console.log('⚠️ 指标不达标，停止扩大发布范围');
          return {
            ...previousResult,
            stage: 'rollout-stopped',
          };
        }

        console.log('📈 扩大发布范围...');

        const newRollout = Math.min(currentRollout * 2, 100);
        console.log(`覆盖率从 ${currentRollout}% 扩大到 ${newRollout}%`);

        await new Promise((resolve) => setTimeout(resolve, 1200));

        return {
          ...previousResult,
          currentRollout: newRollout,
          stage: newRollout >= 100 ? 'fully-deployed' : 'expanded',
        };
      },
      condition: (context: CommandContext) => {
        // 只有在启用自动扩大的情况下才执行
        return context.options.autoExpand !== false;
      },
    },
    {
      name: 'final-verification',
      description: '最终验证',
      execute: async (context: CommandContext, previousResult: any) => {
        console.log('🔍 执行最终验证...');

        const { stage, currentRollout } = previousResult;

        if (stage === 'rollout-stopped') {
          console.log('❌ 灰度发布因指标不达标而停止');
          return {
            ...previousResult,
            finalStatus: 'failed',
            reason: 'metrics-failed',
          };
        }

        console.log('✅ 灰度发布验证完成');
        console.log(`📊 最终覆盖率: ${currentRollout}%`);

        return {
          ...previousResult,
          finalStatus: 'success',
          completedAt: new Date().toISOString(),
        };
      },
    },
  ],
  validate: (context: CommandContext) => {
    if (!context.options.version) {
      console.error('❌ 灰度发布必须指定版本号');
      return false;
    }
    return true;
  },
  options: {
    version: {
      hasValue: true,
      description: '发布版本号 (必需)',
    },
    initialRollout: {
      hasValue: true,
      default: 5,
      description: '初始覆盖率百分比',
    },
    autoExpand: {
      hasValue: false,
      default: true,
      description: '自动扩大发布范围',
    },
  },
};

/**
 * 多环境发布工作流
 */
export const multiEnvironmentDeployWorkflow: CustomWorkflow = {
  name: 'multi-env-deploy',
  description: '多环境依次发布工作流',
  steps: [
    {
      name: 'deploy-to-dev',
      description: '部署到开发环境',
      execute: async (context: CommandContext) => {
        console.log('🔧 部署到开发环境...');
        await new Promise((resolve) => setTimeout(resolve, 1000));

        const devResult = {
          environment: 'development',
          deployTime: new Date().toISOString(),
          success: true,
        };

        console.log('✅ 开发环境部署完成');
        return { dev: devResult };
      },
    },
    {
      name: 'run-integration-tests',
      description: '运行集成测试',
      execute: async (context: CommandContext, previousResult: any) => {
        console.log('🧪 运行集成测试...');

        const testSuites = ['API测试', '数据库测试', '第三方服务测试'];
        const results = [];

        for (const suite of testSuites) {
          console.log(`  运行 ${suite}...`);
          await new Promise((resolve) => setTimeout(resolve, 500));

          const passed = Math.random() > 0.1; // 90% 通过率
          results.push({ suite, passed });
          console.log(`    ${passed ? '✅' : '❌'} ${suite}`);
        }

        const allPassed = results.every((r) => r.passed);
        console.log(
          `🧪 集成测试结果: ${allPassed ? '✅ 全部通过' : '❌ 有失败项'}`,
        );

        return {
          ...previousResult,
          integrationTests: { results, allPassed },
        };
      },
    },
    {
      name: 'deploy-to-staging',
      description: '部署到预发布环境',
      execute: async (context: CommandContext, previousResult: any) => {
        const { integrationTests } = previousResult;

        if (!integrationTests.allPassed) {
          throw new Error('集成测试未通过，无法部署到预发布环境');
        }

        console.log('🎭 部署到预发布环境...');
        await new Promise((resolve) => setTimeout(resolve, 1500));

        const stagingResult = {
          environment: 'staging',
          deployTime: new Date().toISOString(),
          success: true,
        };

        console.log('✅ 预发布环境部署完成');
        return {
          ...previousResult,
          staging: stagingResult,
        };
      },
    },
    {
      name: 'run-e2e-tests',
      description: '运行端到端测试',
      execute: async (context: CommandContext, previousResult: any) => {
        console.log('🎯 运行端到端测试...');

        const e2eTests = [
          '用户登录流程',
          '核心业务流程',
          '支付流程',
          '数据同步',
        ];

        const results = [];

        for (const test of e2eTests) {
          console.log(`  测试 ${test}...`);
          await new Promise((resolve) => setTimeout(resolve, 800));

          const passed = Math.random() > 0.05; // 95% 通过率
          results.push({ test, passed });
          console.log(`    ${passed ? '✅' : '❌'} ${test}`);
        }

        const allPassed = results.every((r) => r.passed);
        console.log(
          `🎯 E2E测试结果: ${allPassed ? '✅ 全部通过' : '❌ 有失败项'}`,
        );

        return {
          ...previousResult,
          e2eTests: { results, allPassed },
        };
      },
    },
    {
      name: 'deploy-to-production',
      description: '部署到生产环境',
      execute: async (context: CommandContext, previousResult: any) => {
        const { e2eTests } = previousResult;

        if (!e2eTests.allPassed) {
          console.log('⚠️ E2E测试未全部通过，需要手动确认是否继续部署');

          if (!context.options.forceProduction) {
            throw new Error('E2E测试未通过，使用 --force-production 强制部署');
          }
        }

        console.log('🚀 部署到生产环境...');

        // 生产部署需要更长时间
        await new Promise((resolve) => setTimeout(resolve, 2000));

        const productionResult = {
          environment: 'production',
          deployTime: new Date().toISOString(),
          success: true,
          version: context.options.version,
        };

        console.log('🎉 生产环境部署完成');
        return {
          ...previousResult,
          production: productionResult,
        };
      },
      condition: (context: CommandContext) => {
        // 只有在非跳过生产部署的情况下才执行
        return !context.options.skipProduction;
      },
    },
    {
      name: 'post-deployment-verification',
      description: '部署后验证',
      execute: async (context: CommandContext, previousResult: any) => {
        console.log('🔍 执行部署后验证...');

        const verifications = [
          '健康检查',
          '关键接口测试',
          '监控数据验证',
          '用户访问验证',
        ];

        for (const verification of verifications) {
          console.log(`  ${verification}...`);
          await new Promise((resolve) => setTimeout(resolve, 300));
          console.log(`    ✅ ${verification} 通过`);
        }

        console.log('✅ 部署后验证完成');

        return {
          ...previousResult,
          postDeploymentVerification: {
            completed: true,
            verifiedAt: new Date().toISOString(),
          },
        };
      },
    },
  ],
  validate: (context: CommandContext) => {
    if (!context.options.version) {
      console.error('❌ 多环境部署必须指定版本号');
      return false;
    }
    return true;
  },
  options: {
    version: {
      hasValue: true,
      description: '发布版本号 (必需)',
    },
    skipProduction: {
      hasValue: false,
      default: false,
      description: '跳过生产环境部署',
    },
    forceProduction: {
      hasValue: false,
      default: false,
      description: '强制部署到生产环境（即使测试未全部通过）',
    },
  },
};

/**
 * 回滚工作流
 */
export const rollbackWorkflow: CustomWorkflow = {
  name: 'rollback-workflow',
  description: '应用回滚工作流',
  steps: [
    {
      name: 'validate-target-version',
      description: '验证目标版本',
      execute: async (context: CommandContext) => {
        console.log('🔍 验证目标回滚版本...');

        const { targetVersion } = context.options;

        if (!targetVersion) {
          throw new Error('必须指定目标回滚版本');
        }

        // 模拟版本验证
        console.log(`验证版本 ${targetVersion} 是否存在...`);
        await new Promise((resolve) => setTimeout(resolve, 800));

        const versionExists = true; // 模拟版本存在

        if (!versionExists) {
          throw new Error(`版本 ${targetVersion} 不存在`);
        }

        console.log(`✅ 版本 ${targetVersion} 验证通过`);

        return {
          targetVersion,
          validated: true,
        };
      },
    },
    {
      name: 'backup-current-state',
      description: '备份当前状态',
      execute: async (context: CommandContext, previousResult: any) => {
        console.log('💾 备份当前应用状态...');

        const backup = {
          backupId: `backup-${Date.now()}`,
          timestamp: new Date().toISOString(),
          currentVersion: 'current-version', // 在实际应用中获取当前版本
          configSnapshot: 'config-data', // 在实际应用中获取配置快照
        };

        await new Promise((resolve) => setTimeout(resolve, 1500));

        console.log(`✅ 状态备份完成，备份ID: ${backup.backupId}`);

        return {
          ...previousResult,
          backup,
        };
      },
    },
    {
      name: 'execute-rollback',
      description: '执行回滚',
      execute: async (context: CommandContext, previousResult: any) => {
        console.log('🔄 执行回滚操作...');

        const { targetVersion } = previousResult;

        console.log(`回滚到版本: ${targetVersion}`);

        // 模拟回滚过程
        const rollbackSteps = [
          '停止当前服务',
          '切换到目标版本',
          '更新配置',
          '重启服务',
        ];

        for (const step of rollbackSteps) {
          console.log(`  ${step}...`);
          await new Promise((resolve) => setTimeout(resolve, 600));
          console.log(`    ✅ ${step} 完成`);
        }

        console.log('🎉 回滚执行完成');

        return {
          ...previousResult,
          rollbackCompleted: true,
          rollbackTime: new Date().toISOString(),
        };
      },
    },
    {
      name: 'verify-rollback',
      description: '验证回滚结果',
      execute: async (context: CommandContext, previousResult: any) => {
        console.log('🔍 验证回滚结果...');

        const verificationChecks = [
          '服务可用性检查',
          '功能完整性检查',
          '性能基线检查',
          '数据一致性检查',
        ];

        const results = [];

        for (const check of verificationChecks) {
          console.log(`  ${check}...`);
          await new Promise((resolve) => setTimeout(resolve, 400));

          const passed = Math.random() > 0.05; // 95% 通过率
          results.push({ check, passed });
          console.log(`    ${passed ? '✅' : '❌'} ${check}`);
        }

        const allPassed = results.every((r) => r.passed);

        if (!allPassed) {
          console.log('⚠️ 部分验证未通过，可能需要进一步检查');
        } else {
          console.log('✅ 回滚验证全部通过');
        }

        return {
          ...previousResult,
          verification: { results, allPassed },
        };
      },
    },
    {
      name: 'notify-stakeholders',
      description: '通知相关人员',
      execute: async (context: CommandContext, previousResult: any) => {
        console.log('📧 通知相关人员...');

        const { targetVersion, verification } = previousResult;

        const notification = {
          type: 'rollback-completed',
          targetVersion,
          success: verification.allPassed,
          timestamp: new Date().toISOString(),
          notifiedStakeholders: [
            '开发团队',
            '运维团队',
            '产品团队',
            '测试团队',
          ],
        };

        console.log('📬 发送通知给:');
        for (const stakeholder of notification.notifiedStakeholders) {
          console.log(`  - ${stakeholder}`);
        }

        await new Promise((resolve) => setTimeout(resolve, 500));

        console.log('✅ 通知发送完成');

        return {
          ...previousResult,
          notification,
        };
      },
    },
  ],
  validate: (context: CommandContext) => {
    if (!context.options.targetVersion) {
      console.error('❌ 回滚操作必须指定目标版本');
      return false;
    }
    return true;
  },
  options: {
    targetVersion: {
      hasValue: true,
      description: '目标回滚版本 (必需)',
    },
    skipVerification: {
      hasValue: false,
      default: false,
      description: '跳过回滚后验证',
    },
  },
};

/**
 * 导出所有工作流
 */
export const customWorkflows = [
  canaryDeploymentWorkflow,
  multiEnvironmentDeployWorkflow,
  rollbackWorkflow,
];
