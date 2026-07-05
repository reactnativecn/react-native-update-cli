import { getSession, loadSession } from './api';
import { getPlatform, getSelectedApp } from './app';
import type {
  BundleOptions,
  CLIProvider,
  CommandContext,
  CommandResult,
  Platform,
  PublishOptions,
  Session,
  UpdateVersionOptions,
  UploadOptions,
} from './types';
import { runAsCommandResult } from './utils/command-result';

const DEFAULT_BUNDLE_OUTPUT =
  '$' + '{tempDir}/output/$' + '{platform}.$' + '{time}.ppk';

export class CLIProviderImpl implements CLIProvider {
  private session?: Session;
  private sessionInitPromise?: Promise<void>;

  private createContext(
    options: Record<string, unknown>,
    args: string[] = [],
  ): CommandContext {
    return { args, options };
  }

  private async ensureInitialized(): Promise<void> {
    if (this.session) {
      return;
    }

    if (!this.sessionInitPromise) {
      this.sessionInitPromise = (async () => {
        await loadSession();
        this.session = getSession();
      })().finally(() => {
        this.sessionInitPromise = undefined;
      });
    }

    await this.sessionInitPromise;
  }

  private runMessageCommand(
    task: () => Promise<void>,
    fallbackError: string,
    successMessage: string,
    requireSession = true,
  ): Promise<CommandResult> {
    return runAsCommandResult(
      async () => {
        if (requireSession) {
          await this.ensureInitialized();
        }
        await task();
      },
      fallbackError,
      () => ({ message: successMessage }),
    );
  }

  private runDataCommand<T>(
    task: () => Promise<T>,
    fallbackError: string,
    requireSession = true,
  ): Promise<CommandResult> {
    return runAsCommandResult(async () => {
      if (requireSession) {
        await this.ensureInitialized();
      }
      return task();
    }, fallbackError);
  }

  async bundle(options: BundleOptions): Promise<CommandResult> {
    return this.runMessageCommand(
      async () => {
        const context = this.createContext({
          dev: options.dev || false,
          platform: options.platform,
          bundleName: options.bundleName || 'index.bundlejs',
          entryFile: options.entryFile || 'index.js',
          output: options.output || DEFAULT_BUNDLE_OUTPUT,
          'no-interactive': true,
          sourcemap: options.sourcemap || false,
          taro: options.taro || false,
          expo: options.expo || false,
          rncli: options.rncli || false,
          hermes: options.hermes || false,
          sentryRelease: options.sentryRelease,
          sentryDist: options.sentryDist,
        });

        const { bundleCommands } = await import('./bundle');
        await bundleCommands.bundle(context);
      },
      'Unknown error during bundling',
      'Bundle created successfully',
      false,
    );
  }

  async publish(options: PublishOptions): Promise<CommandResult> {
    return this.runMessageCommand(
      async () => {
        const context = this.createContext(
          {
            name: options.name,
            description: options.description,
            metaInfo: options.metaInfo,
            packageId: options.packageId,
            packageVersion: options.packageVersion,
            minPackageVersion: options.minPackageVersion,
            maxPackageVersion: options.maxPackageVersion,
            packageVersionRange: options.packageVersionRange,
            platform: options.platform,
            'no-interactive': true,
            rollout:
              options.rollout === undefined
                ? undefined
                : String(options.rollout),
            dryRun: options.dryRun || false,
          },
          options.filePath ? [options.filePath] : [],
        );

        const { versionCommands } = await import('./versions');
        await versionCommands.publish(context);
      },
      'Unknown error during publishing',
      'Version published successfully',
    );
  }

  async upload(options: UploadOptions): Promise<CommandResult> {
    return this.runMessageCommand(
      async () => {
        const filePath = options.filePath;
        const fileType = filePath.split('.').pop()?.toLowerCase();

        const context = this.createContext(
          {
            platform: options.platform,
            appId: options.appId,
            appKey: options.appKey,
            version: options.version,
          },
          [filePath],
        );

        const { packageCommands } = await import('./package');
        const uploadHandlerMap = {
          ipa: packageCommands.uploadIpa,
          apk: packageCommands.uploadApk,
          aab: packageCommands.uploadAab,
          app: packageCommands.uploadApp,
        } as const;
        const uploadHandler =
          fileType && fileType in uploadHandlerMap
            ? uploadHandlerMap[fileType as keyof typeof uploadHandlerMap]
            : undefined;

        if (!uploadHandler) {
          throw new Error(`Unsupported file type: ${fileType}`);
        }
        await uploadHandler(context);
      },
      'Unknown error during upload',
      'File uploaded successfully',
    );
  }

  async getSelectedApp(
    platform?: Platform,
  ): Promise<{ appId: string; platform: Platform }> {
    const resolvedPlatform = await this.getPlatform(platform);
    return getSelectedApp(resolvedPlatform);
  }

  async listApps(platform?: Platform): Promise<CommandResult> {
    return this.runDataCommand(async () => {
      const { getAppCommands } = await import('./app');
      return getAppCommands().apps({
        options: { platform: platform ?? '' },
      });
    }, 'Unknown error listing apps');
  }

  async createApp(name: string, platform: Platform): Promise<CommandResult> {
    return this.runMessageCommand(
      async () => {
        const { getAppCommands } = await import('./app');
        await getAppCommands().createApp({
          options: {
            name,
            platform,
            downloadUrl: '',
          },
        });
      },
      'Unknown error creating app',
      'App created successfully',
    );
  }

  async listVersions(appId: string): Promise<CommandResult> {
    return this.runDataCommand(async () => {
      const { fetchVersions } = await import('./versions');
      return fetchVersions(appId);
    }, 'Unknown error listing versions');
  }

  async updateVersion(
    appId: string,
    versionId: string,
    updates: UpdateVersionOptions,
  ): Promise<CommandResult> {
    return this.runMessageCommand(
      async () => {
        const context = this.createContext({
          appId,
          versionId,
          ...updates,
          'no-interactive': true,
          rollout:
            updates.rollout === undefined ? undefined : String(updates.rollout),
        });

        const { versionCommands } = await import('./versions');
        await versionCommands.update(context);
      },
      'Unknown error updating version',
      'Version updated successfully',
    );
  }

  async getPlatform(platform?: Platform): Promise<Platform> {
    return getPlatform(platform);
  }

  async loadSession(): Promise<Session> {
    await this.ensureInitialized();
    if (!this.session) {
      throw new Error('Failed to load session');
    }
    return this.session;
  }

  async listPackages(appId?: string): Promise<CommandResult> {
    return this.runDataCommand(async () => {
      if (!appId) {
        throw new Error('appId is required to list packages');
      }
      const { listPackage } = await import('./package');
      return listPackage(appId);
    }, 'Unknown error listing packages');
  }
}
