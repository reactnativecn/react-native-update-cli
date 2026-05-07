import type {
  CLIModule,
  CLIProvider,
  CommandContext,
  CommandResult,
} from '../../src/types';

export const customDeployModule: CLIModule = {
  name: 'custom-deploy',
  version: '1.0.0',
  commands: [
    {
      name: 'deploy-dev',
      description: '部署到开发环境',
      handler: async (context: CommandContext): Promise<CommandResult> => {
        const { platform = 'ios', force = false } = context.options;

        console.log(`平台: ${platform}`);
        console.log(`强制部署: ${force ? '是' : '否'}`);

        return {
          success: true,
          data: {
            environment: 'development',
            platform,
            deployTime: new Date().toISOString(),
            buildId: `dev-${Date.now()}`,
          },
        };
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
          description: '强制部署',
        },
      },
    },
    {
      name: 'deploy-prod',
      description: '部署到生产环境',
      handler: async (context: CommandContext): Promise<CommandResult> => {
        const { version, rollout = 100 } = context.options;

        if (!version) {
          return {
            success: false,
            error: '生产部署必须指定版本号',
          };
        }

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
        const { version, immediate = false } = context.options;

        if (!version) {
          return {
            success: false,
            error: '回滚操作必须指定目标版本',
          };
        }

        return {
          success: true,
          data: {
            targetVersion: version,
            rollbackTime: new Date().toISOString(),
            immediate,
          },
        };
      },
      options: {
        version: {
          hasValue: true,
          description: '目标版本号 (必需)',
        },
        immediate: {
          hasValue: false,
          default: false,
          description: '立即回滚',
        },
      },
    },
  ],
  init: (_provider: CLIProvider) => {
    console.log('自定义部署模块已初始化');
  },
  cleanup: () => {
    console.log('自定义部署模块清理完成');
  },
};
