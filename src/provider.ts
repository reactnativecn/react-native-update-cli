import { loadSession, getSession } from './api';
import { getPlatform, getSelectedApp } from './app';
import { question, saveToLocal } from './utils';
import { t } from './utils/i18n';
import type { 
  CLIProvider, 
  CommandContext, 
  CommandResult, 
  BundleOptions, 
  PublishOptions, 
  UploadOptions,
  CustomWorkflow,
  Platform,
  Session,
  Version
} from './types';

export class CLIProviderImpl implements CLIProvider {
  private workflows: Map<string, CustomWorkflow> = new Map();
  private session?: Session;

  constructor() {
    this.init();
  }

  private async init() {
    try {
      await loadSession();
      this.session = getSession();
    } catch (error) {
      // Session might not be loaded yet, that's okay
    }
  }

  // 核心功能实现
  async bundle(options: BundleOptions): Promise<CommandResult> {
    try {
      const context: CommandContext = {
        args: [],
        options: {
          dev: options.dev || false,
          platform: options.platform,
          bundleName: options.bundleName || 'index.bundlejs',
          entryFile: options.entryFile || 'index.js',
          output: options.output || '${tempDir}/output/${platform}.${time}.ppk',
          sourcemap: options.sourcemap || false,
          taro: options.taro || false,
          expo: options.expo || false,
          rncli: options.rncli || false,
          disableHermes: options.disableHermes || false,
        }
      };

      // 调用实际的bundle命令
      const { bundleCommands } = await import('./bundle');
      await bundleCommands.bundle(context);
      
      return {
        success: true,
        data: { message: 'Bundle created successfully' }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error during bundling'
      };
    }
  }

  async publish(options: PublishOptions): Promise<CommandResult> {
    try {
      // 将PublishOptions转换为CommandContext格式
      const context: CommandContext = {
        args: [],
        options: {
          name: options.name,
          description: options.description,
          metaInfo: options.metaInfo,
          packageId: options.packageId,
          packageVersion: options.packageVersion,
          minPackageVersion: options.minPackageVersion,
          maxPackageVersion: options.maxPackageVersion,
          packageVersionRange: options.packageVersionRange,
          rollout: options.rollout,
          dryRun: options.dryRun || false,
        }
      };

      // 调用实际的publish命令
      const { versionCommands } = await import('./versions');
      await versionCommands.publish(context);
      
      return {
        success: true,
        data: { message: 'Version published successfully' }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error during publishing'
      };
    }
  }

  async upload(options: UploadOptions): Promise<CommandResult> {
    try {
      const platform = await this.getPlatform(options.platform);
      const { appId } = await this.getSelectedApp(platform);
      
      // 根据文件类型选择上传命令
      const filePath = options.filePath;
      const fileType = filePath.split('.').pop()?.toLowerCase();
      
      const context: CommandContext = {
        args: [filePath],
        options: { platform, appId }
      };

      const { packageCommands } = await import('./package');
      
      switch (fileType) {
        case 'ipa':
          await packageCommands.uploadIpa(context);
          break;
        case 'apk':
          await packageCommands.uploadApk(context);
          break;
        case 'app':
          await packageCommands.uploadApp(context);
          break;
        default:
          throw new Error(`Unsupported file type: ${fileType}`);
      }
      
      return {
        success: true,
        data: { message: 'File uploaded successfully' }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error during upload'
      };
    }
  }

  // 应用管理
  async getSelectedApp(platform?: Platform): Promise<{ appId: string; platform: Platform }> {
    const resolvedPlatform = await this.getPlatform(platform);
    return getSelectedApp(resolvedPlatform);
  }

  async listApps(platform?: Platform): Promise<CommandResult> {
    try {
      const resolvedPlatform = await this.getPlatform(platform);
      const { appCommands } = await import('./app');
      await appCommands.apps({ options: { platform: resolvedPlatform } });
      
      return {
        success: true,
        data: { message: 'Apps listed successfully' }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error listing apps'
      };
    }
  }

  async createApp(name: string, platform: Platform): Promise<CommandResult> {
    try {
      const { appCommands } = await import('./app');
      await appCommands.createApp({ 
        options: { 
          name, 
          platform,
          downloadUrl: ''
        } 
      });
      
      return {
        success: true,
        data: { message: 'App created successfully' }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error creating app'
      };
    }
  }

  // 版本管理（核心）
  async listVersions(appId: string): Promise<CommandResult> {
    try {
      const context: CommandContext = {
        args: [],
        options: { appId }
      };

      const { versionCommands } = await import('./versions');
      await versionCommands.versions(context);
      
      return {
        success: true,
        data: { message: 'Versions listed successfully' }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error listing versions'
      };
    }
  }

  async updateVersion(appId: string, versionId: string, updates: Partial<Version>): Promise<CommandResult> {
    try {
      const context: CommandContext = {
        args: [versionId],
        options: { 
          appId,
          ...updates
        }
      };

      const { versionCommands } = await import('./versions');
      await versionCommands.update(context);
      
      return {
        success: true,
        data: { message: 'Version updated successfully' }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error updating version'
      };
    }
  }

  // 工具函数（核心）
  async getPlatform(platform?: Platform): Promise<Platform> {
    return getPlatform(platform);
  }

  async loadSession(): Promise<Session> {
    await loadSession();
    this.session = getSession();
    if (!this.session) {
      throw new Error('Failed to load session');
    }
    return this.session;
  }



  // 工作流管理
  registerWorkflow(workflow: CustomWorkflow): void {
    this.workflows.set(workflow.name, workflow);
  }

  async executeWorkflow(workflowName: string, context: CommandContext): Promise<CommandResult> {
    const workflow = this.workflows.get(workflowName);
    if (!workflow) {
      return {
        success: false,
        error: `Workflow '${workflowName}' not found`
      };
    }

    try {
      let previousResult: any = null;
      for (const step of workflow.steps) {
        if (step.condition && !step.condition(context)) {
          console.log(`Skipping step '${step.name}' due to condition`);
          continue;
        }
        
        console.log(`Executing step '${step.name}'`);
        previousResult = await step.execute(context, previousResult);
      }
      
      return {
        success: true,
        data: { message: `Workflow '${workflowName}' completed successfully`, result: previousResult }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : `Workflow '${workflowName}' failed`
      };
    }
  }

  getRegisteredWorkflows(): string[] {
    return Array.from(this.workflows.keys());
  }
} 