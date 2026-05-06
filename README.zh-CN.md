# React Native Update CLI

这是一个统一的 React Native Update CLI，同时支持传统命令和模块化架构以及自定义发布流程。

## 🚀 特性

- **统一 CLI**: 使用单个`pushy`命令提供所有功能
- **向后兼容**: 所有现有命令都能正常工作
- **模块化架构**: 将 CLI 功能拆分为独立的模块
- **自定义工作流**: 支持创建自定义的发布流程
- **可扩展性**: 用户可以导入和注册自定义模块
- **类型安全**: 完整的 TypeScript 类型支持

## 📦 安装

```bash
npm install react-native-update-cli
```

## 🎯 快速开始

### 基本使用

```bash
# 使用统一CLI
npx pushy help

# 列出所有可用命令和工作流
npx pushy list

# 执行内置的工作流
npx pushy workflow setup-app

# 执行自定义工作流
npx pushy workflow custom-publish
```

### 编程方式使用

```typescript
import { moduleManager, CLIProviderImpl } from 'react-native-update-cli';

// 获取CLI提供者
const provider = moduleManager.getProvider();

// 执行打包
const bundleResult = await provider.bundle({
  platform: 'ios',
  dev: false,
  sourcemap: true,
});

// 发布版本
const publishResult = await provider.publish({
  name: 'v1.2.3',
  description: 'Bug fixes and improvements',
  rollout: 100,
});
```

## 🔧 创建自定义模块

### 1. 定义模块

```typescript
import type {
  CLIModule,
  CommandDefinition,
  CustomWorkflow,
} from 'react-native-update-cli';

export const myCustomModule: CLIModule = {
  name: 'my-custom',
  version: '1.0.0',

  commands: [
    {
      name: 'custom-command',
      description: 'My custom command',
      handler: async (context) => {
        console.log('Executing custom command...');
        return {
          success: true,
          data: { message: 'Custom command executed' },
        };
      },
      options: {
        param: { hasValue: true, description: 'Custom parameter' },
      },
    },
  ],

  workflows: [
    {
      name: 'my-workflow',
      description: 'My custom workflow',
      steps: [
        {
          name: 'step1',
          description: 'First step',
          execute: async (context, previousResult) => {
            console.log('Executing step 1...');
            return { step1Completed: true };
          },
        },
        {
          name: 'step2',
          description: 'Second step',
          execute: async (context, previousResult) => {
            console.log('Executing step 2...');
            return { ...previousResult, step2Completed: true };
          },
        },
      ],
    },
  ],

  init: (provider) => {
    console.log('Custom module initialized');
  },

  cleanup: () => {
    console.log('Custom module cleanup');
  },
};
```

### 2. 注册模块

```typescript
import { moduleManager } from 'react-native-update-cli';
import { myCustomModule } from './my-custom-module';

// 注册自定义模块
moduleManager.registerModule(myCustomModule);

// 执行自定义命令
const result = await moduleManager.executeCommand('custom-command', {
  args: [],
  options: { param: 'value' },
});

// 执行自定义工作流
const workflowResult = await moduleManager.executeWorkflow('my-workflow', {
  args: [],
  options: {},
});
```

## 🔄 工作流系统

### 工作流步骤

每个工作流步骤包含：

- `name`: 步骤名称
- `description`: 步骤描述
- `execute`: 执行函数
- `condition`: 可选的条件函数

### 条件执行

```typescript
{
  name: 'conditional-step',
  description: 'Only execute in production',
  execute: async (context, previousResult) => {
    // 执行逻辑
  },
  condition: (context) => {
    return context.options.environment === 'production';
  }
}
```

### 工作流验证

```typescript
{
  name: 'validated-workflow',
  description: 'Workflow with validation',
  steps: [...],
  validate: (context) => {
    if (!context.options.requiredParam) {
      console.error('Required parameter missing');
      return false;
    }
    return true;
  }
}
```

## 📋 内置模块

### Bundle 模块 (`bundle`)

- `bundle`: 打包 JavaScript 代码并可选发布
- `hdiff`: 生成两个 PPK 文件之间的 hdiff
- `hdiffFromApk`: 从 APK 文件生成 hdiff
- `hdiffFromApp`: 从 APP 文件生成 hdiff
- `hdiffFromIpa`: 从 IPA 文件生成 hdiff

### Version 模块 (`version`)

- `publish`: 发布新版本
- `versions`: 列出所有版本
- `update`: 更新版本信息
- `updateVersionInfo`: 更新版本元数据

### App 模块 (`app`)

- `createApp`: 创建新应用
- `apps`: 列出所有应用
- `selectApp`: 选择应用
- `deleteApp`: 删除应用

### Package 模块 (`package`)

- `uploadIpa`: 上传 IPA 文件（支持 `--version` 参数覆盖提取的版本）
- `uploadApk`: 上传 APK 文件（支持 `--version` 参数覆盖提取的版本）
- `uploadAab`: 上传 AAB 文件（转换为 APK，支持 `--version`、`--includeAllSplits`、`--splits`）
- `uploadApp`: 上传 APP 文件（支持 `--version` 参数覆盖提取的版本）
- `parseApp`: 解析 APP 文件信息
- `parseIpa`: 解析 IPA 文件信息
- `parseApk`: 解析 APK 文件信息
- `extractApk`: 从 AAB 提取通用 APK（支持 `--output`、`--includeAllSplits`、`--splits`）
- `packages`: 列出包

### User 模块 (`user`)

- `login`: 登录
- `logout`: 登出
- `me`: 显示用户信息

## 🛠️ CLI 提供者 API

### 核心功能

```typescript
interface CLIProvider {
  // 打包
  bundle(options: BundleOptions): Promise<CommandResult>;

  // 发布
  publish(options: PublishOptions): Promise<CommandResult>;

  // 上传
  upload(options: UploadOptions): Promise<CommandResult>;

  // 应用管理
  getSelectedApp(
    platform?: Platform,
  ): Promise<{ appId: string; platform: Platform }>;
  listApps(platform?: Platform): Promise<CommandResult>;
  createApp(name: string, platform: Platform): Promise<CommandResult>;

  // 版本管理
  listVersions(appId: string): Promise<CommandResult>;
  getVersion(appId: string, versionId: string): Promise<CommandResult>;
  updateVersion(
    appId: string,
    versionId: string,
    updates: Partial<Version>,
  ): Promise<CommandResult>;

  // 包管理
  listPackages(appId: string, platform?: Platform): Promise<CommandResult>;
  getPackage(appId: string, packageId: string): Promise<CommandResult>;

  // 工具函数
  getPlatform(platform?: Platform): Promise<Platform>;
  loadSession(): Promise<Session>;
  saveToLocal(key: string, value: string): void;
  question(prompt: string): Promise<string>;

  // 工作流
  registerWorkflow(workflow: CustomWorkflow): void;
  executeWorkflow(
    workflowName: string,
    context: CommandContext,
  ): Promise<CommandResult>;
}
```

### 自定义命令

```typescript
// 执行自定义打包命令
const bundleResult = await moduleManager.executeCommand('custom-bundle', {
  args: [],
  options: {
    platform: 'android',
    validate: true,
    optimize: true,
  },
});

// 生成 hdiff 文件
const diffResult = await moduleManager.executeCommand('hdiff', {
  args: [],
  options: {
    origin: './build/v1.0.0.ppk',
    next: './build/v1.1.0.ppk',
    output: './build/hdiff.patch',
  },
});

// 从 APK 文件生成 hdiff
const apkDiffResult = await moduleManager.executeCommand('hdiffFromApk', {
  args: [],
  options: {
    origin: './build/app-v1.0.0.apk',
    next: './build/app-v1.1.0.apk',
    output: './build/apk-hdiff.patch',
  },
});
```

## 🔧 配置

### 环境变量

```bash
# 设置API端点
export PUSHY_REGISTRY=https://your-api-endpoint.com

# 设置非交互模式
export NO_INTERACTIVE=true
```

### 配置文件

创建 `update.json` 文件：

```json
{
  "ios": {
    "appId": "your-ios-app-id",
    "appKey": "your-ios-app-key"
  },
  "android": {
    "appId": "your-android-app-id",
    "appKey": "your-android-app-key"
  }
}
```

## 🚨 注意事项

1. **向后兼容**: 新的模块化 CLI 保持与现有 CLI 的兼容性
2. **类型安全**: 所有 API 都有完整的 TypeScript 类型定义
3. **错误处理**: 所有操作都返回标准化的结果格式
4. **资源清理**: 模块支持清理函数来释放资源
5. **模块分离**: 功能按逻辑分离到不同模块中，便于维护和扩展

## 🤝 贡献

欢迎提交 Issue 和 Pull Request 来改进这个项目！

## 🚀 Provider API 使用指南

Provider 提供了简洁的编程接口，适合在应用程序中集成 React Native Update CLI 功能。

### 📋 核心 API 方法

#### 核心业务功能

```typescript
// 打包应用
await provider.bundle({
  platform: 'ios',
  dev: false,
  sourcemap: true,
});

// 发布版本
await provider.publish({
  name: 'v1.0.0',
  description: 'Bug fixes',
  rollout: 100,
});

// 上传文件
await provider.upload({
  filePath: 'app.ipa',
  platform: 'ios',
});
```

#### 应用管理

```typescript
// 创建应用
await provider.createApp('MyApp', 'ios');

// 列出应用
await provider.listApps('ios');

// 获取当前应用
const { appId, platform } = await provider.getSelectedApp('ios');
```

#### 版本管理

```typescript
// 列出版本
await provider.listVersions('app123');

// 更新版本
await provider.updateVersion('app123', 'version456', {
  name: 'v1.1.0',
  description: 'New features',
});
```

#### 工具函数

```typescript
// 获取平台
const platform = await provider.getPlatform('ios');

// 加载会话
const session = await provider.loadSession();
```

### 🎯 使用场景

#### 1. 自动化构建脚本

```typescript
import { moduleManager } from 'react-native-update-cli';

async function buildAndPublish() {
  const provider = moduleManager.getProvider();

  // 1. 打包
  const bundleResult = await provider.bundle({
    platform: 'ios',
    dev: false,
    sourcemap: true,
  });

  if (!bundleResult.success) {
    throw new Error(`打包失败: ${bundleResult.error}`);
  }

  // 2. 发布
  const publishResult = await provider.publish({
    name: 'v1.2.3',
    description: 'Bug fixes and performance improvements',
    rollout: 100,
  });

  if (!publishResult.success) {
    throw new Error(`发布失败: ${publishResult.error}`);
  }

  console.log('构建和发布完成！');
}
```

#### 2. CI/CD 集成

```typescript
async function ciBuild() {
  const provider = moduleManager.getProvider();

  const result = await provider.bundle({
    platform: process.env.PLATFORM as 'ios' | 'android',
    dev: process.env.NODE_ENV !== 'production',
    sourcemap: process.env.NODE_ENV === 'production',
  });

  return result;
}
```

#### 3. 应用管理服务

```typescript
class AppManagementService {
  private provider = moduleManager.getProvider();

  async setupNewApp(name: string, platform: Platform) {
    // 创建应用
    const createResult = await this.provider.createApp(name, platform);

    if (createResult.success) {
      // 获取应用信息
      const { appId } = await this.provider.getSelectedApp(platform);

      // 列出版本
      await this.provider.listVersions(appId);

      return { appId, success: true };
    }

    return { success: false, error: createResult.error };
  }
}
```

### ⚠️ 注意事项

1. **错误处理**: 所有 Provider 方法都返回`CommandResult`，需要检查`success`字段
2. **类型安全**: Provider 提供完整的 TypeScript 类型支持
3. **会话管理**: 使用前确保已登录，可通过`loadSession()`检查
4. **平台支持**: 支持`'ios' | 'android' | 'harmony'`三个平台

### 🔧 高级功能

#### 自定义工作流

```typescript
// 注册自定义工作流
provider.registerWorkflow({
  name: 'quick-release',
  description: '快速发布流程',
  steps: [
    {
      name: 'bundle',
      execute: async () => {
        return await provider.bundle({ platform: 'ios', dev: false });
      },
    },
    {
      name: 'publish',
      execute: async (context, bundleResult) => {
        if (!bundleResult.success) {
          throw new Error('打包失败，无法发布');
        }
        return await provider.publish({ name: 'auto-release', rollout: 50 });
      },
    },
  ],
});

// 执行工作流
await provider.executeWorkflow('quick-release', { args: [], options: {} });
```

### 📚 完整示例

```typescript
import { moduleManager } from 'react-native-update-cli';

class ReactNativeUpdateService {
  private provider = moduleManager.getProvider();

  async initialize() {
    // 加载会话
    await this.provider.loadSession();
  }

  async buildAndDeploy(platform: Platform, version: string) {
    try {
      // 1. 打包
      const bundleResult = await this.provider.bundle({
        platform,
        dev: false,
        sourcemap: true,
      });

      if (!bundleResult.success) {
        throw new Error(`打包失败: ${bundleResult.error}`);
      }

      // 2. 发布
      const publishResult = await this.provider.publish({
        name: version,
        description: `Release ${version}`,
        rollout: 100,
      });

      if (!publishResult.success) {
        throw new Error(`发布失败: ${publishResult.error}`);
      }

      return { success: true, data: publishResult.data };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async getAppInfo(platform: Platform) {
    const { appId } = await this.provider.getSelectedApp(platform);
    const versions = await this.provider.listVersions(appId);

    return { appId, versions };
  }
}

// 使用示例
const service = new ReactNativeUpdateService();
await service.initialize();
await service.buildAndDeploy('ios', 'v1.0.0');
```
