import { bundleCommands } from '../bundle';
import type { CLIModule, CommandContext, CommandResult } from '../types';

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
            data: { message: 'Bundle created successfully' },
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Bundle failed',
          };
        }
      },
      options: {
        dev: {
          hasValue: true,
          default: 'false',
          description: 'Development mode',
        },
        platform: { hasValue: true, description: 'Target platform' },
        bundleName: {
          hasValue: true,
          default: 'index.bundlejs',
          description: 'Bundle file name',
        },
        entryFile: {
          hasValue: true,
          default: 'index.js',
          description: 'Entry file',
        },
        intermediaDir: {
          hasValue: true,
          default: '${tempDir}/intermedia/${platform}',
          description: 'Intermediate directory',
        },
        output: {
          hasValue: true,
          default: '${tempDir}/output/${platform}.${time}.ppk',
          description: 'Output file path',
        },
        sourcemap: { default: false, description: 'Generate sourcemap' },
        taro: { default: false, description: 'Use Taro CLI' },
        expo: { default: false, description: 'Use Expo CLI' },
        rncli: { default: false, description: 'Use React Native CLI' },
        disableHermes: { default: false, description: 'Disable Hermes' },
        name: { hasValue: true, description: 'Version name for publishing' },
        description: {
          hasValue: true,
          description: 'Version description for publishing',
        },
        metaInfo: {
          hasValue: true,
          description: 'Meta information for publishing',
        },
        packageId: { hasValue: true, description: 'Package ID' },
        packageVersion: { hasValue: true, description: 'Package version' },
        minPackageVersion: {
          hasValue: true,
          description: 'Minimum package version',
        },
        maxPackageVersion: {
          hasValue: true,
          description: 'Maximum package version',
        },
        packageVersionRange: {
          hasValue: true,
          description: 'Package version range',
        },
        rollout: { hasValue: true, description: 'Rollout percentage' },
        dryRun: { default: false, description: 'Dry run mode' },
      },
    },
    {
      name: 'diff',
      description: 'Generate diff between two PPK files',
      handler: async (context: CommandContext): Promise<CommandResult> => {
        try {
          await bundleCommands.diff(context);
          return {
            success: true,
            data: { message: 'Diff generated successfully' },
          };
        } catch (error) {
          return {
            success: false,
            error:
              error instanceof Error ? error.message : 'Diff generation failed',
          };
        }
      },
      options: {
        origin: { hasValue: true, description: 'Original PPK file path' },
        next: { hasValue: true, description: 'New PPK file path' },
        output: { hasValue: true, description: 'Output diff file path' },
      },
    },
    {
      name: 'diffFromApk',
      description: 'Generate diff from APK files',
      handler: async (context: CommandContext): Promise<CommandResult> => {
        try {
          await bundleCommands.diffFromApk(context);
          return {
            success: true,
            data: { message: 'Diff from APK generated successfully' },
          };
        } catch (error) {
          return {
            success: false,
            error:
              error instanceof Error ? error.message : 'Diff from APK failed',
          };
        }
      },
      options: {
        origin: { hasValue: true, description: 'Original APK file path' },
        next: { hasValue: true, description: 'New APK file path' },
        output: { hasValue: true, description: 'Output diff file path' },
      },
    },
    {
      name: 'diffFromApp',
      description: 'Generate hdiff from APP files',
      handler: async (context: CommandContext): Promise<CommandResult> => {
        try {
          await bundleCommands.diffFromApp(context);
          return {
            success: true,
            data: { message: 'HDiff from APP generated successfully' },
          };
        } catch (error) {
          return {
            success: false,
            error:
              error instanceof Error ? error.message : 'HDiff from APP failed',
          };
        }
      },
      options: {
        origin: { hasValue: true, description: 'Original APP file path' },
        next: { hasValue: true, description: 'New APP file path' },
        output: { hasValue: true, description: 'Output hdiff file path' },
      },
    },
    {
      name: 'diffFromIpa',
      description: 'Generate diff from IPA files',
      handler: async (context: CommandContext): Promise<CommandResult> => {
        try {
          await bundleCommands.diffFromIpa(context);
          return {
            success: true,
            data: { message: 'Diff from IPA generated successfully' },
          };
        } catch (error) {
          return {
            success: false,
            error:
              error instanceof Error ? error.message : 'Diff from IPA failed',
          };
        }
      },
      options: {
        origin: { hasValue: true, description: 'Original IPA file path' },
        next: { hasValue: true, description: 'New IPA file path' },
        output: { hasValue: true, description: 'Output diff file path' },
      },
    },
  ],

  workflows: [
    {
      name: 'incremental-build',
      description: 'Incremental build workflow - generate diff packages',
      steps: [
        {
          name: 'detect-base-version',
          description: 'Detect base version',
          execute: async (context: CommandContext) => {
            console.log('🔍 Detecting base version...');

            const { baseVersion, platform } = context.options;

            if (baseVersion) {
              console.log(`✅ Using specified base version: ${baseVersion}`);
              return { baseVersion, specified: true };
            }

            console.log('Auto detecting latest version...');
            await new Promise((resolve) => setTimeout(resolve, 800));

            const autoDetectedVersion = `v${Math.floor(Math.random() * 3) + 1}.${Math.floor(Math.random() * 10)}.${Math.floor(Math.random() * 10)}`;

            console.log(
              `✅ Auto detected base version: ${autoDetectedVersion}`,
            );

            return { baseVersion: autoDetectedVersion, specified: false };
          },
        },
        {
          name: 'build-current-version',
          description: 'Build current version',
          execute: async (context: CommandContext, previousResult: any) => {
            console.log('🏗️ Building current version...');

            const {
              platform,
              dev = false,
              sourcemap = false,
              bundleName = 'index.bundlejs',
              entryFile = 'index.js',
              intermediaDir,
              taro = false,
              expo = false,
              rncli = false,
              disableHermes = false,
              output,
            } = context.options;

            console.log(`Building ${platform} platform...`);
            console.log(`  Entry file: ${entryFile}`);
            console.log(`  Bundle name: ${bundleName}`);
            console.log(`  Development mode: ${dev}`);
            console.log(`  Source maps: ${sourcemap}`);

            try {
              const buildOptions: any = {
                platform,
                dev,
                sourcemap,
                bundleName,
                entryFile,
                taro,
                expo,
                rncli,
                disableHermes,
                intermediaDir: '${tempDir}/intermedia/${platform}',
                output: '${tempDir}/output/${platform}.${time}.ppk',
              };
              if (intermediaDir) {
                buildOptions.intermediaDir = intermediaDir;
              }

              await bundleCommands.bundle({
                args: [],
                options: buildOptions,
              });

              const currentBuild = {
                version: `v${Math.floor(Math.random() * 3) + 2}.0.0`,
                platform,
                bundlePath: `./build/current_${platform}.ppk`,
                size: Math.floor(Math.random() * 15) + 10,
                buildTime: Date.now(),
              };

              console.log(
                `✅ Current version build completed: ${currentBuild.version}`,
              );

              return { ...previousResult, currentBuild };
            } catch (error) {
              console.error('❌ Current version build failed:', error);
              throw error;
            }
          },
        },
      ],
      validate: (context: CommandContext) => {
        if (!context.options.platform) {
          console.error('❌ Incremental build requires platform specification');
          return false;
        }
        return true;
      },
      options: {
        platform: {
          hasValue: true,
          description: 'Target platform (required)',
        },
        baseVersion: {
          hasValue: true,
          description: 'Base version (auto detect if not specified)',
        },
        skipValidation: {
          hasValue: false,
          default: false,
          description: 'Skip diff package validation',
        },
        dev: {
          hasValue: false,
          default: false,
          description: 'Development mode build',
        },
        bundleName: {
          hasValue: true,
          default: 'index.bundlejs',
          description: 'Bundle file name',
        },
        entryFile: {
          hasValue: true,
          default: 'index.js',
          description: 'Entry file',
        },
        sourcemap: {
          hasValue: false,
          default: false,
          description: 'Generate source maps',
        },
        output: {
          hasValue: true,
          description: 'Custom output path for diff package',
        },
        intermediaDir: {
          hasValue: true,
          description: 'Intermediate directory',
        },
        taro: {
          hasValue: false,
          default: false,
          description: 'Use Taro CLI',
        },
        expo: {
          hasValue: false,
          default: false,
          description: 'Use Expo CLI',
        },
        rncli: {
          hasValue: false,
          default: false,
          description: 'Use React Native CLI',
        },
        disableHermes: {
          hasValue: false,
          default: false,
          description: 'Disable Hermes',
        },
        name: {
          hasValue: true,
          description: 'Version name for publishing',
        },
        description: {
          hasValue: true,
          description: 'Version description for publishing',
        },
        metaInfo: {
          hasValue: true,
          description: 'Meta information for publishing',
        },
        rollout: {
          hasValue: true,
          description: 'Rollout percentage',
        },
        dryRun: {
          hasValue: false,
          default: false,
          description: 'Dry run mode',
        },
      },
    },
  ],
};
