import type { CLIModule, CommandContext, CommandResult } from '../types';
import { versionCommands } from '../versions';

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
            data: { message: 'Version published successfully' },
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Publish failed',
          };
        }
      },
      options: {
        name: { hasValue: true, description: 'Version name' },
        description: { hasValue: true, description: 'Version description' },
        metaInfo: { hasValue: true, description: 'Meta information' },
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
      name: 'versions',
      description: 'List all versions',
      handler: async (context: CommandContext): Promise<CommandResult> => {
        try {
          await versionCommands.versions(context);
          return {
            success: true,
            data: { message: 'Versions listed successfully' },
          };
        } catch (error) {
          return {
            success: false,
            error:
              error instanceof Error ? error.message : 'List versions failed',
          };
        }
      },
      options: {
        platform: { hasValue: true, description: 'Target platform' },
      },
    },
    {
      name: 'update',
      description: 'Update version information',
      handler: async (context: CommandContext): Promise<CommandResult> => {
        try {
          await versionCommands.update(context);
          return {
            success: true,
            data: { message: 'Version updated successfully' },
          };
        } catch (error) {
          return {
            success: false,
            error:
              error instanceof Error ? error.message : 'Update version failed',
          };
        }
      },
      options: {
        platform: { hasValue: true, description: 'Target platform' },
        versionId: { hasValue: true, description: 'Version ID' },
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
      name: 'updateVersionInfo',
      description: 'Update version metadata',
      handler: async (context: CommandContext): Promise<CommandResult> => {
        try {
          await versionCommands.updateVersionInfo(context);
          return {
            success: true,
            data: { message: 'Version info updated successfully' },
          };
        } catch (error) {
          return {
            success: false,
            error:
              error instanceof Error
                ? error.message
                : 'Update version info failed',
          };
        }
      },
      options: {
        platform: { hasValue: true, description: 'Target platform' },
        versionId: { hasValue: true, description: 'Version ID' },
        name: { hasValue: true, description: 'Version name' },
        description: { hasValue: true, description: 'Version description' },
        metaInfo: { hasValue: true, description: 'Meta information' },
      },
    },
  ],
  workflows: [],
};
