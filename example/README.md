# 自定义模块和工作流示例

这个目录包含了 React Native Update CLI 自定义模块和工作流的完整示例，演示如何扩展 CLI 的功能。

## 📁 目录结构

```
example/
├── modules/                    # 自定义模块示例
│   ├── custom-deploy-module.ts # 自定义部署模块
│   └── analytics-module.ts     # 分析统计模块
├── workflows/                  # 自定义工作流示例
│   └── custom-workflows.ts     # 复杂工作流集合
├── scripts/                    # 执行脚本示例
│   ├── register-modules.ts     # 模块注册和执行
│   ├── provider-api-example.ts # Provider API 使用示例
│   └── workflow-demo.ts        # 工作流演示脚本
└── README.md                   # 本文档
```

## 🚀 快速开始

### 1. 运行模块注册和执行示例

```bash
# 编译TypeScript (如果需要)
npm run build

# 运行模块示例
npx ts-node example/scripts/register-modules.ts
```

### 2. 运行Provider API示例

```bash
npx ts-node example/scripts/provider-api-example.ts
```

### 3. 运行工作流演示

```bash
# 运行所有工作流演示
npx ts-node example/scripts/workflow-demo.ts

# 交互式执行特定工作流
npx ts-node example/scripts/workflow-demo.ts interactive canary-deployment --version 1.0.0 --initialRollout 5

# 多环境部署工作流
npx ts-node example/scripts/workflow-demo.ts interactive multi-env-deploy --version 1.0.0

# 回滚工作流
npx ts-node example/scripts/workflow-demo.ts interactive rollback-workflow --targetVersion 0.9.5
```

## 📦 自定义模块示例

### 1. 自定义部署模块 (`custom-deploy-module.ts`)

这个模块演示了如何创建一个完整的部署管理模块，包含：

#### 命令：
- `deploy-dev`: 部署到开发环境
- `deploy-prod`: 部署到生产环境  
- `rollback`: 回滚到指定版本

#### 工作流：
- `full-deploy`: 完整部署流程（开发 → 测试 → 生产）
- `hotfix-deploy`: 热修复快速部署流程

#### 使用示例：
```typescript
import { moduleManager } from 'react-native-update-cli';
import { customDeployModule } from './modules/custom-deploy-module';

// 注册模块
moduleManager.registerModule(customDeployModule);

// 执行开发部署
await moduleManager.executeCommand('deploy-dev', {
  args: [],
  options: { platform: 'ios', force: true }
});

// 执行完整部署工作流
await moduleManager.executeWorkflow('full-deploy', {
  args: [],
  options: { version: '1.2.3' }
});
```

### 2. 分析统计模块 (`analytics-module.ts`)

演示如何创建分析和统计功能：

#### 命令：
- `track-deployment`: 记录部署统计信息
- `deployment-report`: 生成部署报告

#### 工作流：
- `deploy-with-analytics`: 带统计的部署流程

## 🔄 自定义工作流示例

### 1. 灰度发布工作流 (`canary-deployment`)

实现完整的灰度发布流程：

- ✅ 准备灰度发布环境
- ✅ 初始小范围部署
- ✅ 监控关键指标
- ✅ 基于指标自动扩大发布范围
- ✅ 最终验证

```typescript
await moduleManager.executeWorkflow('canary-deployment', {
  args: [],
  options: {
    version: '2.1.0',
    initialRollout: 10,    // 初始10%用户
    autoExpand: true       // 自动扩大范围
  }
});
```

### 2. 多环境发布工作流 (`multi-env-deploy`)

实现标准的多环境发布流程：

- ✅ 部署到开发环境
- ✅ 运行集成测试
- ✅ 部署到预发布环境
- ✅ 运行端到端测试
- ✅ 部署到生产环境
- ✅ 部署后验证

```typescript
await moduleManager.executeWorkflow('multi-env-deploy', {
  args: [],
  options: {
    version: '2.1.0',
    skipProduction: false,     // 不跳过生产部署
    forceProduction: false     // 测试失败时不强制部署
  }
});
```

### 3. 回滚工作流 (`rollback-workflow`)

安全的应用回滚流程：

- ✅ 验证目标版本
- ✅ 备份当前状态
- ✅ 执行回滚操作
- ✅ 验证回滚结果
- ✅ 通知相关人员

```typescript
await moduleManager.executeWorkflow('rollback-workflow', {
  args: [],
  options: {
    targetVersion: '2.0.5',
    skipVerification: false
  }
});
```

## 🛠️ Provider API 使用示例

Provider API 提供了编程式接口，适合在应用程序中集成：

### 基本使用

```typescript
import { moduleManager } from 'react-native-update-cli';

const provider = moduleManager.getProvider();

// 打包应用
const bundleResult = await provider.bundle({
  platform: 'ios',
  dev: false,
  sourcemap: true
});

// 发布版本
const publishResult = await provider.publish({
  name: 'v1.0.0',
  description: 'Bug fixes',
  rollout: 100
});

// 上传文件
const uploadResult = await provider.upload({
  filePath: 'app.ipa',
  platform: 'ios'
});
```

### 应用管理

```typescript
// 创建应用
await provider.createApp('MyApp', 'ios');

// 获取当前应用
const { appId, platform } = await provider.getSelectedApp('ios');

// 列出版本
const versions = await provider.listVersions(appId);

// 更新版本
await provider.updateVersion(appId, versionId, {
  name: 'v1.1.0',
  description: 'New features'
});
```

### 自动化服务类

```typescript
class DeploymentService {
  private provider = moduleManager.getProvider();
  
  async buildAndPublish(platform: Platform, version: string) {
    // 1. 打包
    const bundleResult = await this.provider.bundle({
      platform, dev: false, sourcemap: true
    });
    
    // 2. 发布
    const publishResult = await this.provider.publish({
      name: version, rollout: 100
    });
    
    return { bundleResult, publishResult };
  }
}
```

## 🎯 高级特性

### 1. 工作流验证

```typescript
const workflow: CustomWorkflow = {
  name: 'my-workflow',
  steps: [...],
  validate: (context) => {
    if (!context.options.version) {
      console.error('必须指定版本号');
      return false;
    }
    return true;
  }
};
```

### 2. 条件执行

```typescript
const step: WorkflowStep = {
  name: 'conditional-step',
  execute: async (context) => { /* ... */ },
  condition: (context) => {
    return context.options.environment === 'production';
  }
};
```

### 3. 错误处理

```typescript
try {
  const result = await moduleManager.executeCommand('deploy-prod', {
    args: [],
    options: {} // 缺少必需参数
  });
} catch (error) {
  console.error('执行失败:', error.message);
}
```

### 4. 自定义工作流注册

```typescript
const provider = moduleManager.getProvider();

provider.registerWorkflow({
  name: 'custom-workflow',
  description: '自定义工作流',
  steps: [
    {
      name: 'step1',
      execute: async (context, previousResult) => {
        // 执行逻辑
        return { step1: 'completed' };
      }
    }
  ]
});

// 执行工作流
await provider.executeWorkflow('custom-workflow', {
  args: [],
  options: {}
});
```

## 📝 最佳实践

### 1. 模块设计

- **单一职责**: 每个模块专注于特定功能领域
- **清晰命名**: 使用描述性的命令和选项名称
- **完整文档**: 为所有命令和选项提供描述
- **错误处理**: 提供清晰的错误信息和恢复建议

### 2. 工作流设计

- **原子操作**: 每个步骤应该是原子的，可独立执行
- **状态传递**: 合理使用 previousResult 传递状态
- **错误恢复**: 考虑失败时的清理和恢复机制
- **进度反馈**: 提供清晰的进度信息给用户

### 3. 开发建议

- **类型安全**: 充分利用 TypeScript 类型系统
- **测试覆盖**: 为自定义模块编写测试
- **文档维护**: 保持示例和文档的同步更新
- **版本管理**: 为模块设置合适的版本号

## 🐛 故障排除

### 常见问题

1. **模块注册失败**
   ```typescript
   // 确保模块符合 CLIModule 接口
   const module: CLIModule = {
     name: 'my-module',
     version: '1.0.0',
     commands: [...],
     workflows: [...]
   };
   ```

2. **命令执行失败**
   ```typescript
   // 检查命令名称和参数
   await moduleManager.executeCommand('correct-command-name', {
     args: [],
     options: { requiredParam: 'value' }
   });
   ```

3. **工作流验证失败**
   ```typescript
   // 确保提供所有必需的选项
   await moduleManager.executeWorkflow('workflow-name', {
     args: [],
     options: { version: '1.0.0' } // 必需参数
   });
   ```

## 📖 相关文档

- [主项目 README](../README.md)
- [模块化架构文档](../docs/architecture.md)
- [API 参考文档](../docs/api-reference.md)
- [贡献指南](../CONTRIBUTING.md)

## 🤝 贡献

欢迎提交更多示例和改进建议！请查看主项目的贡献指南。