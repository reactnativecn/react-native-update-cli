import type { CLIModule, CommandDefinition, CustomWorkflow, WorkflowStep, CommandContext, CommandResult } from '../types';
import { bundleCommands } from '../bundle';

export const bundleModule: CLIModule = {
  name: 'bundle',
  version: '1.0.0',
  
  commands: [
    {
      name: 'bundle',
      description: 'Bundle javascript code and optionally publish',
      handler: async (context: CommandContext): Promise<CommandResult> => {
        try {
          await bundleCommands.bundle(context);
          return {
            success: true,
            data: { message: 'Bundle created successfully' }
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Bundle failed'
          };
        }
      },
      options: {
        dev: { hasValue: true, default: 'false', description: 'Development mode' },
        platform: { hasValue: true, description: 'Target platform' },
        bundleName: { hasValue: true, default: 'index.bundlejs', description: 'Bundle file name' },
        entryFile: { hasValue: true, default: 'index.js', description: 'Entry file' },
        output: { hasValue: true, description: 'Output file path' },
        sourcemap: { default: false, description: 'Generate sourcemap' },
        taro: { default: false, description: 'Use Taro CLI' },
        expo: { default: false, description: 'Use Expo CLI' },
        rncli: { default: false, description: 'Use React Native CLI' },
        disableHermes: { default: false, description: 'Disable Hermes' }
      }
    },
    {
      name: 'build',
      description: 'Bundle javascript and copy assets',
      handler: async (context: CommandContext): Promise<CommandResult> => {
        try {
          // 使用bundle命令作为build的别名
          await bundleCommands.bundle(context);
          return {
            success: true,
            data: { message: 'Build completed successfully' }
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Build failed'
          };
        }
      }
    }
  ],

  workflows: [
    {
      name: 'bundle-and-publish',
      description: 'Bundle code and publish to update server',
      steps: [
        {
          name: 'bundle',
          description: 'Create JavaScript bundle',
          execute: async (context: CommandContext) => {
            const bundleResult = await bundleCommands.bundle(context);
            return { bundleFile: context.args[0] };
          }
        },
        {
          name: 'publish',
          description: 'Publish bundle to update server',
          execute: async (context: CommandContext, previousResult: any) => {
            // 这里需要调用publish命令
            console.log('Publishing bundle:', previousResult.bundleFile);
            return { published: true, bundleFile: previousResult.bundleFile };
          }
        }
      ]
    }
  ]
}; 