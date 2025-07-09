import type { CLIModule, CommandContext, CommandResult } from '../types';
import { packageCommands } from '../package';
import { versionCommands } from '../versions';

export const packageModule: CLIModule = {
  name: 'package',
  version: '1.0.0',
  
  commands: [
    {
      name: 'uploadIpa',
      description: 'Upload IPA file',
      handler: async (context: CommandContext): Promise<CommandResult> => {
        try {
          console.log('Uploading IPA file:', context.args[0]);
          await packageCommands.uploadIpa(context);
          return {
            success: true,
            data: { message: 'IPA uploaded successfully' }
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Upload IPA failed'
          };
        }
      }
    },
    {
      name: 'uploadApk',
      description: 'Upload APK file',
      handler: async (context: CommandContext): Promise<CommandResult> => {
        try {
          console.log('Uploading APK file:', context.args[0]);
          await packageCommands.uploadApk(context);
          return {
            success: true,
            data: { message: 'APK uploaded successfully' }
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Upload APK failed'
          };
        }
      }
    },
    {
      name: 'uploadApp',
      description: 'Upload APP file',
      handler: async (context: CommandContext): Promise<CommandResult> => {
        try {
          console.log('Uploading APP file:', context.args[0]);
          await packageCommands.uploadApp(context);
          return {
            success: true,
            data: { message: 'APP uploaded successfully' }
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Upload APP failed'
          };
        }
      }
    },
    {
      name: 'parseApp',
      description: 'Parse APP file information',
      handler: async (context: CommandContext): Promise<CommandResult> => {
        try {
          console.log('Parsing APP file:', context.args[0]);
          await packageCommands.parseApp(context);
          return {
            success: true,
            data: { message: 'APP file parsed successfully' }
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Parse APP failed'
          };
        }
      }
    },
    {
      name: 'parseIpa',
      description: 'Parse IPA file information',
      handler: async (context: CommandContext): Promise<CommandResult> => {
        try {
          console.log('Parsing IPA file:', context.args[0]);
          await packageCommands.parseIpa(context);
          return {
            success: true,
            data: { message: 'IPA file parsed successfully' }
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Parse IPA failed'
          };
        }
      }
    },
    {
      name: 'parseApk',
      description: 'Parse APK file information',
      handler: async (context: CommandContext): Promise<CommandResult> => {
        try {
          console.log('Parsing APK file:', context.args[0]);
          await packageCommands.parseApk(context);
          return {
            success: true,
            data: { message: 'APK file parsed successfully' }
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Parse APK failed'
          };
        }
      }
    },
    {
      name: 'packages',
      description: 'List packages',
      handler: async (context: CommandContext): Promise<CommandResult> => {
        try {
          if (!context.options.platform) {
            throw new Error('Platform option is required');
          }
          console.log('Listing packages for platform:', context.options.platform);
          await packageCommands.packages({ options: { platform: context.options.platform } });
          return {
            success: true,
            data: { message: 'Packages listed successfully' }
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'List packages failed'
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
      name: 'upload-and-publish',
      description: 'Upload package and publish version',
      options: {
        name: { hasValue: true, description: 'Version name' },
        description: { hasValue: true, description: 'Version description' },
        metaInfo: { hasValue: true, description: 'Meta information' },
        packageId: { hasValue: true, description: 'Package ID' },
        packageVersion: { hasValue: true, description: 'Package version' },
        minPackageVersion: { hasValue: true, description: 'Minimum package version' },
        maxPackageVersion: { hasValue: true, description: 'Maximum package version' },
        packageVersionRange: { hasValue: true, description: 'Package version range' },
        rollout: { hasValue: true, description: 'Rollout percentage' },
        dryRun: { default: false, description: 'Dry run mode' },
        platform: { hasValue: true, description: 'Target platform' }
      },
      steps: [
        {
          name: 'validate-package',
          description: 'Validate package file',
          execute: async (context: CommandContext) => {
            const filePath = context.args[0];
            console.log('Validating package file:', filePath);
            
            const fs = require('fs');
            if (!fs.existsSync(filePath)) {
              throw new Error(`Package file not found: ${filePath}`);
            }
            
            if (!filePath.endsWith('.ipa') && !filePath.endsWith('.apk') && !filePath.endsWith('.app')) {
              throw new Error('Unsupported package format. Only .ipa, .apk, and .app files are supported.');
            }
            
            return { 
              filePath,
              fileType: filePath.split('.').pop(),
              validated: true 
            };
          }
        },
        {
          name: 'upload-package',
          description: 'Upload package to server',
          execute: async (context: CommandContext, previousResult: any) => {
            console.log('Uploading package:', previousResult.filePath);
            
            const fileType = previousResult.fileType;
            let uploadResult;
            
            if (fileType === 'ipa') {
              uploadResult = await packageCommands.uploadIpa({ args: [previousResult.filePath] });
            } else if (fileType === 'apk') {
              uploadResult = await packageCommands.uploadApk({ args: [previousResult.filePath] });
            } else if (fileType === 'app') {
              uploadResult = await packageCommands.uploadApp({ args: [previousResult.filePath] });
            } else {
              throw new Error(`Unsupported file type: ${fileType}`);
            }
            
            return { 
              ...previousResult, 
              uploaded: true,
              uploadResult
            };
          }
        },
        {
          name: 'publish-version',
          description: 'Publish new version',
          execute: async (context: CommandContext, previousResult: any) => {
            console.log('Publishing new version');
            
            const publishOptions = {
              name: context.options.name,
              description: context.options.description,
              metaInfo: context.options.metaInfo,
              packageId: context.options.packageId,
              packageVersion: context.options.packageVersion,
              minPackageVersion: context.options.minPackageVersion,
              maxPackageVersion: context.options.maxPackageVersion,
              packageVersionRange: context.options.packageVersionRange,
              rollout: context.options.rollout,
              dryRun: context.options.dryRun || false,
              platform: context.options.platform
            };
            
            const versionName = await versionCommands.publish({
              args: context.args,
              options: publishOptions
            });
            
            return { 
              ...previousResult, 
              published: true,
              versionName
            };
          }
        }
      ]
    },
    {
      name: 'analyze-package',
      description: 'Analyze package file information',
      steps: [
        {
          name: 'parse-package',
          description: 'Parse package file information',
          execute: async (context: CommandContext) => {
            const filePath = context.args[0];
            console.log('Parsing package file:', filePath);
          
            let packageInfo;
            if (filePath.endsWith('.ipa')) {
              packageInfo = await packageCommands.parseIpa({ args: [filePath] });
            } else if (filePath.endsWith('.apk')) {
              packageInfo = await packageCommands.parseApk({ args: [filePath] });
            } else if (filePath.endsWith('.app')) {
              packageInfo = await packageCommands.parseApp({ args: [filePath] });
            } else {
              throw new Error('Unsupported package format. Only .ipa, .apk, and .app files are supported.');
            }
            
            return { 
              filePath,
              packageInfo,
              analyzed: true
            };
          }
        }
      ]
    }
  ]
}; 