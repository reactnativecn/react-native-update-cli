// 导出模块化CLI的核心功能
export { moduleManager } from './module-manager';
export { CLIProviderImpl } from './provider';

// 导出类型定义
export type {
  CLIProvider,
  CLIModule,
  CommandDefinition,
  CustomWorkflow,
  WorkflowStep,
  CommandContext,
  CommandResult,
  BundleOptions,
  PublishOptions,
  UploadOptions,
  Platform,
  Session,
  Version,
  Package
} from './types';

// 导出内置模块
export { builtinModules } from './modules';
export { bundleModule } from './modules/bundle-module';
export { versionModule } from './modules/version-module';
export { appModule } from './modules/app-module';
export { userModule } from './modules/user-module';
export { packageModule } from './modules/package-module';

// 导出工具函数
export { loadSession, getSession } from './api';
export { getPlatform, getSelectedApp } from './app';
export { question, saveToLocal } from './utils'; 