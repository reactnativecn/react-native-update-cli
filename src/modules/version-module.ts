import type { CLIModule, CommandDefinition, CustomWorkflow, CommandContext, CommandResult } from '../types';
import { versionCommands } from '../versions';
import { bundleCommands } from '../bundle';
import { getPlatform, getSelectedApp } from '../app';

export const versionModule: CLIModule = {
  name: 'version',
  version: '1.0.0',
  
  commands: [
    {
      name: 'publish',
      description: 'Publish a new version',
      handler: async (context: CommandContext): Promise<CommandResult> => {
        try {
          await versionCommands.publish(context);
          return {
            success: true,
            data: { message: 'Version published successfully' }
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Publish failed'
          };
        }
      },
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
        dryRun: { default: false, description: 'Dry run mode' }
      }
    },
    {
      name: 'versions',
      description: 'List all versions',
      handler: async (context: CommandContext): Promise<CommandResult> => {
        try {
          await versionCommands.versions(context);
          return {
            success: true,
            data: { message: 'Versions listed successfully' }
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'List versions failed'
          };
        }
      },
      options: {
        platform: { hasValue: true, description: 'Target platform' }
      }
    },
    {
      name: 'update',
      description: 'Update version information',
      handler: async (context: CommandContext): Promise<CommandResult> => {
        try {
          await versionCommands.update(context);
          return {
            success: true,
            data: { message: 'Version updated successfully' }
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Update version failed'
          };
        }
      },
      options: {
        platform: { hasValue: true, description: 'Target platform' },
        versionId: { hasValue: true, description: 'Version ID' },
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
      name: 'updateVersionInfo',
      description: 'Update version metadata',
      handler: async (context: CommandContext): Promise<CommandResult> => {
        try {
          await versionCommands.updateVersionInfo(context);
          return {
            success: true,
            data: { message: 'Version info updated successfully' }
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Update version info failed'
          };
        }
      },
      options: {
        platform: { hasValue: true, description: 'Target platform' },
        versionId: { hasValue: true, description: 'Version ID' },
        name: { hasValue: true, description: 'Version name' },
        description: { hasValue: true, description: 'Version description' },
        metaInfo: { hasValue: true, description: 'Meta information' }
      }
    }
  ],

  workflows: [
    {
      name: 'bundle-and-publish',
      description: 'Create bundle and publish version',
      options: {
        platform: { hasValue: true, description: 'Target platform' },
        name: { hasValue: true, description: 'Version name' },
        description: { hasValue: true, description: 'Version description' },
        metaInfo: { hasValue: true, description: 'Meta information' },
        bundleName: { hasValue: true, description: 'Bundle file name' },
        entryFile: { hasValue: true, description: 'Entry file path' },
        output: { hasValue: true, description: 'Output file path' },
        dev: { default: false, description: 'Development mode' },
        sourcemap: { default: false, description: 'Generate sourcemap' },
        taro: { default: false, description: 'Taro framework' },
        expo: { default: false, description: 'Expo framework' },
        rncli: { default: false, description: 'React Native CLI' },
        disableHermes: { default: false, description: 'Disable Hermes' },
        packageId: { hasValue: true, description: 'Package ID' },
        packageVersion: { hasValue: true, description: 'Package version' },
        minPackageVersion: { hasValue: true, description: 'Minimum package version' },
        maxPackageVersion: { hasValue: true, description: 'Maximum package version' },
        packageVersionRange: { hasValue: true, description: 'Package version range' },
        rollout: { hasValue: true, description: 'Rollout percentage' },
        dryRun: { default: false, description: 'Dry run mode' }
      },
      steps: [
        {
          name: 'validate-platform',
          description: 'Validate and resolve platform',
          execute: async (context: CommandContext) => {
            console.log('Validating platform...');
            
            if (!context.options.platform) {
              throw new Error('Platform is required for bundle and publish workflow');
            }
            
            const platform = await getPlatform(context.options.platform);
            console.log(`✓ Platform resolved: ${platform}`);
            
            return { 
              platform,
              validated: true 
            };
          }
        },
        {
          name: 'check-app-selection',
          description: 'Check and select application',
          execute: async (context: CommandContext, previousResult: any) => {
            console.log('Checking application selection...');
            
            try {
              const { appId, appKey } = await getSelectedApp(previousResult.platform);
              console.log(`✓ Application selected: ${appId}`);
              
              return { 
                ...previousResult, 
                appId,
                appKey,
                appSelected: true 
              };
            } catch (error) {
              console.log('✗ Failed to select application:', error instanceof Error ? error.message : 'Unknown error');
              throw error;
            }
          }
        },
        {
          name: 'create-bundle',
          description: 'Create React Native bundle',
          execute: async (context: CommandContext, previousResult: any) => {
            console.log('Creating React Native bundle...');
            
            const bundleOptions = {
              platform: previousResult.platform,
              name: context.options.name,
              description: context.options.description,
              metaInfo: context.options.metaInfo,
              bundleName: context.options.bundleName || 'index.bundlejs',
              entryFile: context.options.entryFile || 'index.js',
              output: context.options.output || '${tempDir}/output/${platform}.${time}.ppk',
              dev: context.options.dev || false,
              sourcemap: context.options.sourcemap || false,
              taro: context.options.taro || false,
              expo: context.options.expo || false,
              rncli: context.options.rncli || false,
              disableHermes: context.options.disableHermes || false,
              packageId: context.options.packageId,
              packageVersion: context.options.packageVersion,
              minPackageVersion: context.options.minPackageVersion,
              maxPackageVersion: context.options.maxPackageVersion,
              packageVersionRange: context.options.packageVersionRange,
              rollout: context.options.rollout,
              dryRun: context.options.dryRun || false,
              'no-interactive': true // 禁用交互式提示
            };
            
            try {
              await bundleCommands.bundle({ options: bundleOptions });
              console.log('✓ Bundle created successfully');
              
              return { 
                ...previousResult, 
                bundleCreated: true,
                bundleOptions
              };
            } catch (error) {
              console.log('✗ Bundle creation failed:', error instanceof Error ? error.message : 'Unknown error');
              throw error;
            }
          }
        },
        {
          name: 'publish-version',
          description: 'Publish version with bundle',
          execute: async (context: CommandContext, previousResult: any) => {
            console.log('Publishing version...');
            
            // 从 bundle 选项中获取输出路径
            const outputPath = previousResult.bundleOptions.output.replace(/\$\{time\}/g, `${Date.now()}`);
            
            const publishOptions = {
              platform: previousResult.platform,
              name: context.options.name,
              description: context.options.description,
              metaInfo: context.options.metaInfo,
              packageId: context.options.packageId,
              packageVersion: context.options.packageVersion,
              minPackageVersion: context.options.minPackageVersion,
              maxPackageVersion: context.options.maxPackageVersion,
              packageVersionRange: context.options.packageVersionRange,
              rollout: context.options.rollout,
              dryRun: context.options.dryRun || false
            };
            
            try {
              const versionName = await versionCommands.publish({
                args: [outputPath],
                options: publishOptions
              });
              
              console.log(`✓ Version published successfully: ${versionName}`);
              
              return { 
                ...previousResult, 
                versionPublished: true,
                versionName,
                outputPath
              };
            } catch (error) {
              console.log('✗ Version publication failed:', error instanceof Error ? error.message : 'Unknown error');
              throw error;
            }
          }
        },
        {
          name: 'workflow-summary',
          description: 'Provide workflow summary',
          execute: async (context: CommandContext, previousResult: any) => {
            console.log('\n=== Bundle and Publish Summary ===');
            console.log(`Platform: ${previousResult.platform}`);
            console.log(`Application: ${previousResult.appId}`);
            console.log(`Bundle: Created successfully`);
            console.log(`Version: ${previousResult.versionName}`);
            console.log(`Output: ${previousResult.outputPath}`);
            console.log('=====================================\n');
            
            return { 
              ...previousResult, 
              workflowComplete: true,
              status: 'success'
            };
          }
        }
      ]
    },
    {
      name: 'publish-version',
      description: 'Publish a new version with validation',
      options: {
        name: { hasValue: true, description: 'Version name' },
        description: { hasValue: true, description: 'Version description' },
        metaInfo: { hasValue: true, description: 'Meta information' },
        platform: { hasValue: true, description: 'Target platform' },
        packageId: { hasValue: true, description: 'Package ID' },
        packageVersion: { hasValue: true, description: 'Package version' },
        minPackageVersion: { hasValue: true, description: 'Minimum package version' },
        maxPackageVersion: { hasValue: true, description: 'Maximum package version' },
        packageVersionRange: { hasValue: true, description: 'Package version range' },
        rollout: { hasValue: true, description: 'Rollout percentage' },
        dryRun: { default: false, description: 'Dry run mode' }
      },
      steps: [
        {
          name: 'validate-bundle-file',
          description: 'Validate bundle file',
          execute: async (context: CommandContext) => {
            console.log('Validating bundle file...');
            
            if (!context.args[0]) {
              throw new Error('Bundle file is required');
            }
            
            const fs = require('fs');
            const bundleFile = context.args[0];
            
            if (!fs.existsSync(bundleFile)) {
              throw new Error(`Bundle file not found: ${bundleFile}`);
            }
            
            if (!bundleFile.endsWith('.ppk')) {
              throw new Error('Bundle file must be a .ppk file');
            }
            
            const stats = fs.statSync(bundleFile);
            const fileSizeInMB = (stats.size / (1024 * 1024)).toFixed(2);
            
            console.log(`✓ Bundle file validated: ${bundleFile} (${fileSizeInMB} MB)`);
            
            return { 
              bundleFile,
              fileSize: fileSizeInMB,
              validated: true 
            };
          }
        },
        {
          name: 'resolve-platform',
          description: 'Resolve target platform',
          execute: async (context: CommandContext, previousResult: any) => {
            console.log('Resolving platform...');
            
            if (!context.options.platform) {
              throw new Error('Platform is required for version publishing');
            }
            
            const platform = await getPlatform(context.options.platform);
            console.log(`✓ Platform resolved: ${platform}`);
            
            return { 
              ...previousResult, 
              platform,
              platformResolved: true 
            };
          }
        },
        {
          name: 'publish-version',
          description: 'Publish the version',
          execute: async (context: CommandContext, previousResult: any) => {
            console.log('Publishing version...');
            
            const publishOptions = {
              platform: previousResult.platform,
              name: context.options.name,
              description: context.options.description,
              metaInfo: context.options.metaInfo,
              packageId: context.options.packageId,
              packageVersion: context.options.packageVersion,
              minPackageVersion: context.options.minPackageVersion,
              maxPackageVersion: context.options.maxPackageVersion,
              packageVersionRange: context.options.packageVersionRange,
              rollout: context.options.rollout,
              dryRun: context.options.dryRun || false
            };
            
            try {
              const versionName = await versionCommands.publish({
                args: [previousResult.bundleFile],
                options: publishOptions
              });
              
              console.log(`✓ Version published successfully: ${versionName}`);
              
              return { 
                ...previousResult, 
                published: true,
                versionName
              };
            } catch (error) {
              console.log('✗ Version publication failed:', error instanceof Error ? error.message : 'Unknown error');
              throw error;
            }
          }
        },
        {
          name: 'publish-summary',
          description: 'Provide publish summary',
          execute: async (context: CommandContext, previousResult: any) => {
            console.log('\n=== Version Publish Summary ===');
            console.log(`Bundle: ${previousResult.bundleFile}`);
            console.log(`Platform: ${previousResult.platform}`);
            console.log(`Version: ${previousResult.versionName}`);
            console.log(`Size: ${previousResult.fileSize} MB`);
            console.log('================================\n');
            
            return { 
              ...previousResult, 
              publishComplete: true,
              status: 'success'
            };
          }
        }
      ]
    },
    {
      name: 'update-version-config',
      description: 'Update version configuration and package bindings',
      options: {
        platform: { hasValue: true, description: 'Target platform' },
        versionId: { hasValue: true, description: 'Version ID' },
        packageId: { hasValue: true, description: 'Package ID' },
        packageVersion: { hasValue: true, description: 'Package version' },
        minPackageVersion: { hasValue: true, description: 'Minimum package version' },
        maxPackageVersion: { hasValue: true, description: 'Maximum package version' },
        packageVersionRange: { hasValue: true, description: 'Package version range' },
        rollout: { hasValue: true, description: 'Rollout percentage' },
        dryRun: { default: false, description: 'Dry run mode' }
      },
      steps: [
        {
          name: 'validate-version-id',
          description: 'Validate version ID',
          execute: async (context: CommandContext) => {
            console.log('Validating version ID...');
            
            if (!context.options.versionId) {
              throw new Error('Version ID is required for update workflow');
            }
            
            const versionId = context.options.versionId;
            console.log(`✓ Version ID: ${versionId}`);
            
            return { 
              versionId,
              validated: true 
            };
          }
        },
        {
          name: 'resolve-platform',
          description: 'Resolve target platform',
          execute: async (context: CommandContext, previousResult: any) => {
            console.log('Resolving platform...');
            
            if (!context.options.platform) {
              throw new Error('Platform is required for version update');
            }
            
            const platform = await getPlatform(context.options.platform);
            console.log(`✓ Platform resolved: ${platform}`);
            
            return { 
              ...previousResult, 
              platform,
              platformResolved: true 
            };
          }
        },
        {
          name: 'update-version',
          description: 'Update version configuration',
          execute: async (context: CommandContext, previousResult: any) => {
            console.log('Updating version configuration...');
            
            const updateOptions = {
              platform: previousResult.platform,
              versionId: previousResult.versionId,
              packageId: context.options.packageId,
              packageVersion: context.options.packageVersion,
              minPackageVersion: context.options.minPackageVersion,
              maxPackageVersion: context.options.maxPackageVersion,
              packageVersionRange: context.options.packageVersionRange,
              rollout: context.options.rollout,
              dryRun: context.options.dryRun || false
            };
            
            try {
              await versionCommands.update({ options: updateOptions });
              console.log('✓ Version configuration updated successfully');
              
              return { 
                ...previousResult, 
                updated: true
              };
            } catch (error) {
              console.log('✗ Version update failed:', error instanceof Error ? error.message : 'Unknown error');
              throw error;
            }
          }
        },
        {
          name: 'update-summary',
          description: 'Provide update summary',
          execute: async (context: CommandContext, previousResult: any) => {
            console.log('\n=== Version Update Summary ===');
            console.log(`Version ID: ${previousResult.versionId}`);
            console.log(`Platform: ${previousResult.platform}`);
            console.log(`Status: Updated successfully`);
            
            if (context.options.packageId) {
              console.log(`Package ID: ${context.options.packageId}`);
            }
            if (context.options.packageVersion) {
              console.log(`Package Version: ${context.options.packageVersion}`);
            }
            if (context.options.rollout) {
              console.log(`Rollout: ${context.options.rollout}%`);
            }
            
            console.log('==============================\n');
            
            return { 
              ...previousResult, 
              updateComplete: true,
              status: 'success'
            };
          }
        }
      ]
    }
  ]
}; 