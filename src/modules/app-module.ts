import type { CLIModule, CommandDefinition, CustomWorkflow, CommandContext, CommandResult } from '../types';
import { appCommands } from '../app';

export const appModule: CLIModule = {
  name: 'app',
  version: '1.0.0',
  
  commands: [
    {
      name: 'createApp',
      description: 'Create a new app',
      handler: async (context: CommandContext): Promise<CommandResult> => {
        try {
          const { name, downloadUrl, platform } = context.options;
          console.log('Creating app with options:', { name, downloadUrl, platform });
          await appCommands.createApp({ options: { name, downloadUrl, platform } });
          return {
            success: true,
            data: { message: 'App created successfully' }
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Create app failed'
          };
        }
      },
      options: {
        name: { hasValue: true, description: 'App name' },
        platform: { hasValue: true, description: 'Target platform' },
        downloadUrl: { hasValue: true, description: 'Download URL' }
      }
    },
    {
      name: 'apps',
      description: 'List all apps',
      handler: async (context: CommandContext): Promise<CommandResult> => {
        try {
          console.log('Listing apps for platform:', context.options.platform);
          await appCommands.apps({ options: { platform: context.options.platform } });
          return {
            success: true,
            data: { message: 'Apps listed successfully' }
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'List apps failed'
          };
        }
      },
      options: {
        platform: { hasValue: true, description: 'Target platform' }
      }
    },
    {
      name: 'selectApp',
      description: 'Select an app',
      handler: async (context: CommandContext): Promise<CommandResult> => {
        try {
          console.log('Selecting app with args:', context.args, 'options:', context.options);
          await appCommands.selectApp({ args: context.args, options: { platform: context.options.platform } });
          return {
            success: true,
            data: { message: 'App selected successfully' }
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Select app failed'
          };
        }
      },
      options: {
        platform: { hasValue: true, description: 'Target platform' }
      }
    },
    {
      name: 'deleteApp',
      description: 'Delete an app',
      handler: async (context: CommandContext): Promise<CommandResult> => {
        try {
          console.log('Deleting app with args:', context.args, 'options:', context.options);
          await appCommands.deleteApp({ args: context.args, options: { platform: context.options.platform } });
          return {
            success: true,
            data: { message: 'App deleted successfully' }
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Delete app failed'
          };
        }
      },
      options: {
        platform: { hasValue: true, description: 'Target platform' }
      }
    }
  ],

  workflows: [
    {
      name: 'setup-app',
      description: 'Setup a new app with initial configuration',
      steps: [
        {
          name: 'create',
          description: 'Create the app',
          execute: async (context: CommandContext) => {
            console.log('Creating app in workflow');
            const { name, downloadUrl, platform } = context.options;
            await appCommands.createApp({ 
              options: { 
                name: name || '', 
                downloadUrl: downloadUrl || '', 
                platform: platform || '' 
              } 
            });
            return { appCreated: true };
          }
        },
        {
          name: 'select',
          description: 'Select the created app',
          execute: async (context: CommandContext, previousResult: any) => {
            console.log('Selecting app in workflow');
            const { platform } = context.options;
            await appCommands.selectApp({ 
              args: [], 
              options: { platform: platform || '' } 
            });
            return { ...previousResult, appSelected: true };
          }
        }
      ]
    },
    {
      name: 'manage-apps',
      description: 'Manage multiple apps',
      steps: [
        {
          name: 'list-apps',
          description: 'List all apps',
          execute: async (context: CommandContext) => {
            console.log('Listing all apps');
            const { platform } = context.options;
            await appCommands.apps({ 
              options: { platform: platform || '' } 
            });
            return { appsListed: true };
          }
        },
        {
          name: 'select-target-app',
          description: 'Select target app for operations',
          execute: async (context: CommandContext, previousResult: any) => {
            console.log('Selecting target app');
            const { platform } = context.options;
            await appCommands.selectApp({ 
              args: [], 
              options: { platform: platform || '' } 
            });
            return { ...previousResult, targetAppSelected: true };
          }
        }
      ]
    }
  ]
}; 