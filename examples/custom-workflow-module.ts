import type { CLIModule, CLIProvider, CommandDefinition, CustomWorkflow, CommandContext, CommandResult } from '../src/types';

/**
 * 示例：自定义发布工作流模块
 * 这个模块展示了如何创建自定义的发布流程
 */
export const customPublishModule: CLIModule = {
  name: 'custom-publish',
  version: '1.0.0',
  
  commands: [
    {
      name: 'custom-bundle',
      description: 'Custom bundle command with additional validation',
      handler: async (context: CommandContext): Promise<CommandResult> => {
        try {
          console.log('Executing custom bundle with validation...');
          
          // 自定义验证逻辑
          if (!context.options.platform) {
            return {
              success: false,
              error: 'Platform is required for custom bundle'
            };
          }
          
          // 这里可以添加自定义的打包逻辑
          console.log(`Creating bundle for platform: ${context.options.platform}`);
          
          return {
            success: true,
            data: { 
              message: 'Custom bundle created successfully',
              platform: context.options.platform,
              timestamp: new Date().toISOString()
            }
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Custom bundle failed'
          };
        }
      },
      options: {
        platform: { hasValue: true, description: 'Target platform' },
        validate: { default: true, description: 'Enable validation' },
        optimize: { default: false, description: 'Enable optimization' }
      }
    }
  ],

  workflows: [
    {
      name: 'production-release',
      description: 'Complete production release workflow',
      steps: [
        {
          name: 'pre-build-validation',
          description: 'Validate project configuration',
          execute: async (context: CommandContext) => {
            console.log('🔍 Validating project configuration...');
            
            // 检查必要的配置文件
            const fs = require('fs');
            const requiredFiles = ['package.json', 'update.json'];
            
            for (const file of requiredFiles) {
              if (!fs.existsSync(file)) {
                throw new Error(`Required file not found: ${file}`);
              }
            }
            
            console.log('✅ Project validation passed');
            return { validated: true, timestamp: new Date().toISOString() };
          }
        },
        {
          name: 'create-bundle',
          description: 'Create optimized bundle',
          execute: async (context: CommandContext, previousResult: any) => {
            console.log('📦 Creating production bundle...');
            
            // 这里可以调用CLI提供者的bundle方法
            // const provider = context.provider;
            // const result = await provider.bundle({
            //   platform: context.options.platform,
            //   dev: false,
            //   sourcemap: true
            // });
            
            console.log('✅ Bundle created successfully');
            return { 
              ...previousResult, 
              bundleCreated: true,
              bundlePath: `./dist/bundle-${Date.now()}.ppk`
            };
          },
          condition: (context: CommandContext) => {
            // 只在生产模式下执行
            return context.options.environment === 'production';
          }
        },
        {
          name: 'run-tests',
          description: 'Run automated tests',
          execute: async (context: CommandContext, previousResult: any) => {
            console.log('🧪 Running automated tests...');
            
            // 模拟测试执行
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            console.log('✅ All tests passed');
            return { 
              ...previousResult, 
              testsPassed: true,
              testResults: { passed: 10, failed: 0 }
            };
          }
        },
        {
          name: 'publish-version',
          description: 'Publish to update server',
          execute: async (context: CommandContext, previousResult: any) => {
            console.log('🚀 Publishing to update server...');
            
            // 这里可以调用CLI提供者的publish方法
            // const provider = context.provider;
            // const result = await provider.publish({
            //   name: context.options.versionName || 'Production Release',
            //   description: context.options.versionDescription,
            //   rollout: 100
            // });
            
            console.log('✅ Version published successfully');
            return { 
              ...previousResult, 
              published: true,
              versionId: `v${Date.now()}`
            };
          }
        },
        {
          name: 'notify-team',
          description: 'Send notification to team',
          execute: async (context: CommandContext, previousResult: any) => {
            console.log('📢 Sending notification to team...');
            
            // 模拟发送通知
            const notification = {
              type: 'production-release',
              version: previousResult.versionId,
              timestamp: new Date().toISOString(),
              status: 'success'
            };
            
            console.log('✅ Notification sent:', notification);
            return { 
              ...previousResult, 
              notified: true,
              notification
            };
          }
        }
      ],
      validate: (context: CommandContext) => {
        // 验证工作流执行条件
        if (!context.options.environment) {
          console.error('Environment is required for production release');
          return false;
        }
        
        if (context.options.environment === 'production' && !context.options.confirm) {
          console.error('Confirmation required for production release');
          return false;
        }
        
        return true;
      }
    },
    
    {
      name: 'staging-release',
      description: 'Staging release workflow for testing',
      steps: [
        {
          name: 'create-staging-bundle',
          description: 'Create bundle for staging',
          execute: async (context: CommandContext) => {
            console.log('📦 Creating staging bundle...');
            return { 
              bundleCreated: true,
              environment: 'staging',
              timestamp: new Date().toISOString()
            };
          }
        },
        {
          name: 'publish-staging',
          description: 'Publish to staging environment',
          execute: async (context: CommandContext, previousResult: any) => {
            console.log('🚀 Publishing to staging...');
            return { 
              ...previousResult, 
              published: true,
              versionId: `staging-${Date.now()}`
            };
          }
        }
      ]
    }
  ],

  init: (provider: CLIProvider) => {
    console.log('🎉 Custom publish module initialized');
    
    // 可以在这里进行模块初始化
    // 例如：注册自定义事件监听器、设置配置等
  },

  cleanup: () => {
    console.log('🧹 Custom publish module cleanup');
    
    // 清理资源
  }
};

/**
 * 使用示例：
 * 
 * // 在用户代码中注册自定义模块
 * import { moduleManager } from 'react-native-update-cli';
 * import { customPublishModule } from './custom-workflow-module';
 * 
 * moduleManager.registerModule(customPublishModule);
 * 
 * // 执行自定义工作流
 * const result = await moduleManager.executeWorkflow('production-release', {
 *   args: [],
 *   options: {
 *     environment: 'production',
 *     confirm: true,
 *     versionName: 'v1.2.3',
 *     versionDescription: 'Bug fixes and improvements'
 *   }
 * });
 */ 