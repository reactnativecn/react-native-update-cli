import type {
  CLIModule,
  CLIProvider,
  CommandContext,
  CommandDefinition,
  CommandResult,
  CustomWorkflow,
} from '../../src/types';

/**
 * 自定义部署模块示例
 * 演示如何创建一个包含多个命令和工作流的自定义模块
 */
export const customDeployModule: CLIModule = {
  name: 'custom-deploy',
  version: '1.0.0',

  commands: [
    {
      name: 'deploy-dev',
      description: '部署到开发环境',
      handler: async (context: CommandContext): Promise<CommandResult> => {
        console.log('🚀 开始部署到开发环境...');

        const { platform = 'ios', force = false } = context.options;

        try {
          // 模拟部署逻辑
          console.log(`📱 平台: ${platform}`);
          console.log(`🔧 强制部署: ${force ? '是' : '否'}`);

          // 模拟一些部署步骤
          console.log('1. 检查环境配置...');
          await new Promise((resolve) => setTimeout(resolve, 1000));

          console.log('2. 构建应用包...');
          await new Promise((resolve) => setTimeout(resolve, 1500));

          console.log('3. 上传到开发服务器...');
          await new Promise((resolve) => setTimeout(resolve, 1000));

          console.log('✅ 部署到开发环境完成!');

          return {
            success: true,
            data: {
              environment: 'development',
              platform,
              deployTime: new Date().toISOString(),
              buildId: `dev-${Date.now()}`,
            },
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : '部署失败',
          };
        }
      },
      options: {
        platform: {
          hasValue: true,
          default: 'ios',
          description: '目标平台 (ios/android/harmony)',
        },
        force: {
          hasValue: false,
          default: false,
          description: '强制部署，跳过确认',
        },
      },
    },

    {
      name: 'deploy-prod',
      description: '部署到生产环境',
      handler: async (context: CommandContext): Promise<CommandResult> => {
        console.log('🔥 开始部署到生产环境...');

        const { version, rollout = 100 } = context.options;

        if (!version) {
          return {
            success: false,
            error: '生产部署必须指定版本号',
          };
        }

        try {
          console.log(`📦 版本: ${version}`);
          console.log(`📊 发布比例: ${rollout}%`);

          console.log('1. 安全检查...');
          await new Promise((resolve) => setTimeout(resolve, 1000));

          console.log('2. 生产构建...');
          await new Promise((resolve) => setTimeout(resolve, 2000));

          console.log('3. 部署到生产环境...');
          await new Promise((resolve) => setTimeout(resolve, 1500));

          console.log('4. 健康检查...');
          await new Promise((resolve) => setTimeout(resolve, 800));

          console.log('🎉 生产部署完成!');

          return {
            success: true,
            data: {
              environment: 'production',
              version,
              rollout,
              deployTime: new Date().toISOString(),
              buildId: `prod-${Date.now()}`,
            },
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : '生产部署失败',
          };
        }
      },
      options: {
        version: {
          hasValue: true,
          description: '版本号 (必需)',
        },
        rollout: {
          hasValue: true,
          default: 100,
          description: '发布比例 (0-100)',
        },
      },
    },

    {
      name: 'rollback',
      description: '回滚到指定版本',
      handler: async (context: CommandContext): Promise<CommandResult> => {
        console.log('🔄 开始回滚操作...');

        const { version, immediate = false } = context.options;

        if (!version) {
          return {
            success: false,
            error: '回滚操作必须指定目标版本',
          };
        }

        try {
          console.log(`🎯 目标版本: ${version}`);
          console.log(`⚡ 立即回滚: ${immediate ? '是' : '否'}`);

          console.log('1. 验证目标版本...');
          await new Promise((resolve) => setTimeout(resolve, 800));

          console.log('2. 准备回滚...');
          await new Promise((resolve) => setTimeout(resolve, 1000));

          console.log('3. 执行回滚...');
          await new Promise((resolve) => setTimeout(resolve, 1200));

          console.log('✅ 回滚完成!');

          return {
            success: true,
            data: {
              targetVersion: version,
              rollbackTime: new Date().toISOString(),
              immediate,
            },
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : '回滚失败',
          };
        }
      },
      options: {
        version: {
          hasValue: true,
          description: '目标版本号 (必需)',
        },
        immediate: {
          hasValue: false,
          default: false,
          description: '立即回滚，不等待确认',
        },
      },
    },
  ],

  workflows: [
    {
      name: 'full-deploy',
      description: '完整部署流程：开发 -> 测试 -> 生产',
      steps: [
        {
          name: 'deploy-to-dev',
          description: '部署到开发环境',
          execute: async (context: CommandContext) => {
            console.log('🔧 步骤 1: 部署到开发环境');
            // 这里可以调用其他命令或执行自定义逻辑
            return { environment: 'dev', status: 'completed' };
          },
        },
        {
          name: 'run-tests',
          description: '运行自动化测试',
          execute: async (context: CommandContext, previousResult: any) => {
            console.log('🧪 步骤 2: 运行自动化测试');
            console.log('   - 单元测试...');
            await new Promise((resolve) => setTimeout(resolve, 1000));
            console.log('   - 集成测试...');
            await new Promise((resolve) => setTimeout(resolve, 1500));
            console.log('   - E2E测试...');
            await new Promise((resolve) => setTimeout(resolve, 2000));
            return { ...previousResult, tests: 'passed' };
          },
        },
        {
          name: 'deploy-to-prod',
          description: '部署到生产环境',
          execute: async (context: CommandContext, previousResult: any) => {
            console.log('🚀 步骤 3: 部署到生产环境');
            if (previousResult.tests !== 'passed') {
              throw new Error('测试未通过，无法部署到生产环境');
            }
            return {
              ...previousResult,
              environment: 'production',
              status: 'deployed',
            };
          },
          condition: (context: CommandContext) => {
            // 只有在非跳过生产部署的情况下才执行
            return !context.options.skipProd;
          },
        },
      ],
      validate: (context: CommandContext) => {
        if (!context.options.version) {
          console.error('❌ 完整部署流程需要指定版本号');
          return false;
        }
        return true;
      },
      options: {
        version: {
          hasValue: true,
          description: '版本号 (必需)',
        },
        skipProd: {
          hasValue: false,
          default: false,
          description: '跳过生产部署',
        },
      },
    },

    {
      name: 'hotfix-deploy',
      description: '热修复快速部署流程',
      steps: [
        {
          name: 'validate-hotfix',
          description: '验证热修复',
          execute: async (context: CommandContext) => {
            console.log('🔍 验证热修复内容...');
            const { hotfixId } = context.options;
            if (!hotfixId) {
              throw new Error('缺少热修复ID');
            }
            return { hotfixId, validated: true };
          },
        },
        {
          name: 'emergency-deploy',
          description: '紧急部署',
          execute: async (context: CommandContext, previousResult: any) => {
            console.log('🚨 执行紧急部署...');
            console.log('⚡ 快速构建...');
            await new Promise((resolve) => setTimeout(resolve, 800));
            console.log('🚀 立即发布...');
            await new Promise((resolve) => setTimeout(resolve, 600));
            return {
              ...previousResult,
              deployed: true,
              deployTime: new Date().toISOString(),
            };
          },
        },
      ],
      options: {
        hotfixId: {
          hasValue: true,
          description: '热修复ID (必需)',
        },
      },
    },
  ],

  init: (provider: CLIProvider) => {
    console.log('🎯 自定义部署模块已初始化');
    console.log('   可用命令: deploy-dev, deploy-prod, rollback');
    console.log('   可用工作流: full-deploy, hotfix-deploy');
  },

  cleanup: () => {
    console.log('🧹 自定义部署模块清理完成');
  },
};
