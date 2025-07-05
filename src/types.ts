declare global {
  var NO_INTERACTIVE: boolean;
  var USE_ACC_OSS: boolean;
}

export interface Session {
  token: string;
}

export type Platform = 'ios' | 'android' | 'harmony';

export interface Package {
  id: string;
  name: string;
}

export interface Version {
  id: string;
  hash: string;
  name: string;
  packages?: Package[];
}

// 新增：模块化CLI相关类型
export interface CommandContext {
  args: string[];
  options: Record<string, any>;
  platform?: Platform;
  appId?: string;
  session?: Session;
}

export interface CommandResult {
  success: boolean;
  data?: any;
  error?: string;
}

export interface CommandDefinition {
  name: string;
  description?: string;
  handler: (context: CommandContext) => Promise<CommandResult>;
  options?: Record<string, {
    hasValue?: boolean;
    default?: any;
    description?: string;
  }>;
}

export interface BundleOptions {
  dev?: boolean;
  platform?: Platform;
  bundleName?: string;
  entryFile?: string;
  output?: string;
  sourcemap?: boolean;
  taro?: boolean;
  expo?: boolean;
  rncli?: boolean;
  disableHermes?: boolean;
}

export interface PublishOptions {
  name?: string;
  description?: string;
  metaInfo?: string;
  packageId?: string;
  packageVersion?: string;
  minPackageVersion?: string;
  maxPackageVersion?: string;
  packageVersionRange?: string;
  rollout?: number;
  dryRun?: boolean;
}

export interface UploadOptions {
  platform?: Platform;
  filePath: string;
  appId?: string;
}

export interface WorkflowStep {
  name: string;
  description?: string;
  execute: (context: CommandContext, previousResult?: any) => Promise<any>;
  condition?: (context: CommandContext) => boolean;
}

export interface CustomWorkflow {
  name: string;
  description?: string;
  steps: WorkflowStep[];
  validate?: (context: CommandContext) => boolean;
}

export interface CLIProvider {
  // 核心功能
  bundle: (options: BundleOptions) => Promise<CommandResult>;
  publish: (options: PublishOptions) => Promise<CommandResult>;
  upload: (options: UploadOptions) => Promise<CommandResult>;
  
  // 应用管理
  getSelectedApp: (platform?: Platform) => Promise<{ appId: string; platform: Platform }>;
  listApps: (platform?: Platform) => Promise<CommandResult>;
  createApp: (name: string, platform: Platform) => Promise<CommandResult>;
  
  // 版本管理
  listVersions: (appId: string) => Promise<CommandResult>;
  getVersion: (appId: string, versionId: string) => Promise<CommandResult>;
  updateVersion: (appId: string, versionId: string, updates: Partial<Version>) => Promise<CommandResult>;
  
  // 包管理
  listPackages: (appId: string, platform?: Platform) => Promise<CommandResult>;
  getPackage: (appId: string, packageId: string) => Promise<CommandResult>;
  
  // 工具函数
  getPlatform: (platform?: Platform) => Promise<Platform>;
  loadSession: () => Promise<Session>;
  saveToLocal: (key: string, value: string) => void;
  question: (prompt: string) => Promise<string>;
  
  // 工作流
  registerWorkflow: (workflow: CustomWorkflow) => void;
  executeWorkflow: (workflowName: string, context: CommandContext) => Promise<CommandResult>;
}

export interface CLIModule {
  name: string;
  version: string;
  commands?: CommandDefinition[];
  workflows?: CustomWorkflow[];
  init?: (provider: CLIProvider) => void;
  cleanup?: () => void;
}
