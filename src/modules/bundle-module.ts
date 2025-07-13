import type { CLIModule, CommandContext, CommandResult } from '../types';
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
      name: 'diffFromApp',
      description: 'Generate hdiff from APP files',
      handler: async (context: CommandContext): Promise<CommandResult> => {
        try {
          await bundleCommands.diffFromApp(context);
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
  ],

  workflows: []
}; 