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
        intermediaDir: { hasValue: true, default: '${tempDir}/intermedia/${platform}', description: 'Intermediate directory' },
        output: { hasValue: true, default: '${tempDir}/output/${platform}.${time}.ppk', description: 'Output file path' },
        sourcemap: { default: false, description: 'Generate sourcemap' },
        taro: { default: false, description: 'Use Taro CLI' },
        expo: { default: false, description: 'Use Expo CLI' },
        rncli: { default: false, description: 'Use React Native CLI' },
        disableHermes: { default: false, description: 'Disable Hermes' },
        name: { hasValue: true, description: 'Version name for publishing' },
        description: { hasValue: true, description: 'Version description for publishing' },
        metaInfo: { hasValue: true, description: 'Meta information for publishing' },
        packageId: { hasValue: true, description: 'Package ID' },
        packageVersion: { hasValue: true, description: 'Package version' },
        minPackageVersion: { hasValue: true, description: 'Minimum package version' },
        maxPackageVersion: { hasValue: true, description: 'Maximum package version' },
        packageVersionRange: { hasValue: true, description: 'Package version range' },
        rollout: { hasValue: true, description: 'Rollout percentage' },
        dryRun: { default: false, description: 'Dry run mode' }
      }
    },
    {
      name: 'diff',
      description: 'Generate diff between two PPK files',
      handler: async (context: CommandContext): Promise<CommandResult> => {
        try {
          await bundleCommands.diff(context);
          return {
            success: true,
            data: { message: 'Diff generated successfully' }
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Diff generation failed'
          };
        }
      },
      options: {
        origin: { hasValue: true, description: 'Original PPK file path' },
        next: { hasValue: true, description: 'New PPK file path' },
        output: { hasValue: true, description: 'Output diff file path' }
      }
    },
    {
      name: 'hdiff',
      description: 'Generate hdiff between two PPK files',
      handler: async (context: CommandContext): Promise<CommandResult> => {
        try {
          await bundleCommands.hdiff(context);
          return {
            success: true,
            data: { message: 'HDiff generated successfully' }
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'HDiff generation failed'
          };
        }
      },
      options: {
        origin: { hasValue: true, description: 'Original PPK file path' },
        next: { hasValue: true, description: 'New PPK file path' },
        output: { hasValue: true, description: 'Output hdiff file path' }
      }
    },
    {
      name: 'diffFromApk',
      description: 'Generate diff from APK files',
      handler: async (context: CommandContext): Promise<CommandResult> => {
        try {
          await bundleCommands.diffFromApk(context);
          return {
            success: true,
            data: { message: 'Diff from APK generated successfully' }
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Diff from APK failed'
          };
        }
      },
      options: {
        origin: { hasValue: true, description: 'Original APK file path' },
        next: { hasValue: true, description: 'New APK file path' },
        output: { hasValue: true, description: 'Output diff file path' }
      }
    },
    {
      name: 'hdiffFromApk',
      description: 'Generate hdiff from APK files',
      handler: async (context: CommandContext): Promise<CommandResult> => {
        try {
          await bundleCommands.hdiffFromApk(context);
          return {
            success: true,
            data: { message: 'HDiff from APK generated successfully' }
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'HDiff from APK failed'
          };
        }
      },
      options: {
        origin: { hasValue: true, description: 'Original APK file path' },
        next: { hasValue: true, description: 'New APK file path' },
        output: { hasValue: true, description: 'Output hdiff file path' }
      }
    },
    {
      name: 'hdiffFromApp',
      description: 'Generate hdiff from APP files',
      handler: async (context: CommandContext): Promise<CommandResult> => {
        try {
          await bundleCommands.hdiffFromApp(context);
          return {
            success: true,
            data: { message: 'HDiff from APP generated successfully' }
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'HDiff from APP failed'
          };
        }
      },
      options: {
        origin: { hasValue: true, description: 'Original APP file path' },
        next: { hasValue: true, description: 'New APP file path' },
        output: { hasValue: true, description: 'Output hdiff file path' }
      }
    },
    {
      name: 'diffFromIpa',
      description: 'Generate diff from IPA files',
      handler: async (context: CommandContext): Promise<CommandResult> => {
        try {
          await bundleCommands.diffFromIpa(context);
          return {
            success: true,
            data: { message: 'Diff from IPA generated successfully' }
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Diff from IPA failed'
          };
        }
      },
      options: {
        origin: { hasValue: true, description: 'Original IPA file path' },
        next: { hasValue: true, description: 'New IPA file path' },
        output: { hasValue: true, description: 'Output diff file path' }
      }
    },
    {
      name: 'hdiffFromIpa',
      description: 'Generate hdiff from IPA files',
      handler: async (context: CommandContext): Promise<CommandResult> => {
        try {
          await bundleCommands.hdiffFromIpa(context);
          return {
            success: true,
            data: { message: 'HDiff from IPA generated successfully' }
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'HDiff from IPA failed'
          };
        }
      },
      options: {
        origin: { hasValue: true, description: 'Original IPA file path' },
        next: { hasValue: true, description: 'New IPA file path' },
        output: { hasValue: true, description: 'Output hdiff file path' }
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
    },
    {
      name: 'generate-diff',
      description: 'Generate diff between two versions',
      steps: [
        {
          name: 'validate-files',
          description: 'Validate input files',
          execute: async (context: CommandContext) => {
            const fs = require('fs');
            const { origin, next } = context.options;
            
            if (!fs.existsSync(origin)) {
              throw new Error(`Original file not found: ${origin}`);
            }
            if (!fs.existsSync(next)) {
              throw new Error(`New file not found: ${next}`);
            }
            
            return { 
              origin, 
              next, 
              validated: true 
            };
          }
        },
        {
          name: 'generate-diff',
          description: 'Generate diff file',
          execute: async (context: CommandContext, previousResult: any) => {
            const { origin, next } = previousResult;
            const output = context.options.output || `${next}.diff`;
            
            // 根据文件类型选择diff命令
            let diffCommand = 'diff';
            if (origin.endsWith('.apk') || next.endsWith('.apk')) {
              diffCommand = 'diffFromApk';
            } else if (origin.endsWith('.ipa') || next.endsWith('.ipa')) {
              diffCommand = 'diffFromIpa';
            } else if (origin.endsWith('.app') || next.endsWith('.app')) {
              diffCommand = 'hdiffFromApp';
            }
            
            // 调用相应的diff命令
            const diffContext = {
              args: [origin, next],
              options: { output }
            };
            
            switch (diffCommand) {
              case 'diff':
                await bundleCommands.diff(diffContext);
                break;
              case 'diffFromApk':
                await bundleCommands.diffFromApk(diffContext);
                break;
              case 'diffFromIpa':
                await bundleCommands.diffFromIpa(diffContext);
                break;
              case 'hdiffFromApp':
                await bundleCommands.hdiffFromApp(diffContext);
                break;
              default:
                throw new Error(`Unsupported diff command: ${diffCommand}`);
            }
            
            return { 
              ...previousResult, 
              output,
              diffGenerated: true,
              diffCommand
            };
          }
        }
      ]
    }
  ]
}; 