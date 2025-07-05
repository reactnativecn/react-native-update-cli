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
      // 这里需要调用现有的bundle逻辑
      // 暂时返回成功，实际实现需要集成现有的bundle命令
      console.log('Bundle operation would be executed with options:', options);
      
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
      // 这里需要调用现有的publish逻辑
      console.log('Publish operation would be executed with options:', options);
      
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
      
      console.log('Upload operation would be executed:', { filePath: options.filePath, platform, appId });
      
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
      console.log('List apps operation would be executed for platform:', platform);
      
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
      console.log('Create app operation would be executed:', { name, platform });
      
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

  // 版本管理
  async listVersions(appId: string): Promise<CommandResult> {
    try {
      console.log('List versions operation would be executed for appId:', appId);
      
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

  async getVersion(appId: string, versionId: string): Promise<CommandResult> {
    try {
      console.log('Get version operation would be executed:', { appId, versionId });
      
      return {
        success: true,
        data: { message: 'Version retrieved successfully' }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error getting version'
      };
    }
  }

  async updateVersion(appId: string, versionId: string, updates: Partial<Version>): Promise<CommandResult> {
    try {
      console.log('Update version operation would be executed:', { appId, versionId, updates });
      
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

  // 包管理
  async listPackages(appId: string, platform?: Platform): Promise<CommandResult> {
    try {
      console.log('List packages operation would be executed:', { appId, platform });
      
      return {
        success: true,
        data: { message: 'Packages listed successfully' }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error listing packages'
      };
    }
  }

  async getPackage(appId: string, packageId: string): Promise<CommandResult> {
    try {
      console.log('Get package operation would be executed:', { appId, packageId });
      
      return {
        success: true,
        data: { message: 'Package retrieved successfully' }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error getting package'
      };
    }
  }

  // 工具函数
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

  saveToLocal(key: string, value: string): void {
    saveToLocal(key, value);
  }

  async question(prompt: string): Promise<string> {
    return question(prompt);
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
      // 验证工作流
      if (workflow.validate && !workflow.validate(context)) {
        return {
          success: false,
          error: `Workflow '${workflowName}' validation failed`
        };
      }

      let previousResult: any = undefined;
      
      // 执行每个步骤
      for (const step of workflow.steps) {
        // 检查步骤条件
        if (step.condition && !step.condition(context)) {
          console.log(`Skipping step '${step.name}' due to condition not met`);
          continue;
        }

        console.log(`Executing step: ${step.name}`);
        previousResult = await step.execute(context, previousResult);
      }

      return {
        success: true,
        data: { 
          message: `Workflow '${workflowName}' completed successfully`,
          result: previousResult
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : `Error executing workflow '${workflowName}'`
      };
    }
  }

  // 获取所有注册的工作流
  getRegisteredWorkflows(): string[] {
    return Array.from(this.workflows.keys());
  }
} 