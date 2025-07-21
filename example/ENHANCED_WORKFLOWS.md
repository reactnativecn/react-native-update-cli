# 核心模块增强工作流

这个文档详细介绍了为React Native Update CLI核心模块设计的增强工作流，包括`app-module`、`bundle-module`、`package-module`、`user-module`、`version-module`的高级工作流功能。

## 📋 目录

- [App模块工作流](#app模块工作流)
- [Bundle模块工作流](#bundle模块工作流)
- [Package模块工作流](#package模块工作流)
- [User模块工作流](#user模块工作流)
- [Version模块工作流](#version模块工作流)
- [工作流使用示例](#工作流使用示例)
- [最佳实践](#最佳实践)

## 🚀 快速开始

```bash
# 运行所有增强工作流演示
npx ts-node example/scripts/enhanced-workflow-demo.ts

# 交互式执行特定工作流
npx ts-node example/scripts/enhanced-workflow-demo.ts interactive [工作流名称] [参数...]

# 示例：应用初始化
npx ts-node example/scripts/enhanced-workflow-demo.ts interactive app-initialization --name MyApp --platform ios

# 示例：智能打包
npx ts-node example/scripts/enhanced-workflow-demo.ts interactive intelligent-bundle --platform android --optimize true

# 示例：版本发布
npx ts-node example/scripts/enhanced-workflow-demo.ts interactive version-release-management --name v1.0.0 --platform ios --dryRun true
```

---

## 📱 App模块工作流

### 1. 应用初始化工作流 (`app-initialization`)

**用途**: 完整的应用创建和初始化流程

**功能特性**:
- ✅ 参数验证和格式检查
- ✅ 应用存在性检查和冲突处理
- ✅ 应用创建和配置
- ✅ 自动选择新创建的应用
- ✅ 完整性验证和健康检查

**工作流步骤**:
1. **参数验证**: 检查应用名称、平台、下载URL格式
2. **存在性检查**: 验证应用是否已存在，支持强制覆盖
3. **应用创建**: 执行应用创建操作
4. **基本配置**: 设置更新策略、安全参数、版本控制
5. **应用选择**: 自动选择新创建的应用
6. **设置验证**: 验证应用配置的完整性和可用性

**使用示例**:
```typescript
await moduleManager.executeWorkflow('app-initialization', {
  args: [],
  options: {
    name: 'MyAwesomeApp',           // 应用名称 (必需)
    platform: 'ios',               // 平台 (必需)
    downloadUrl: 'https://...',    // 下载URL (可选)
    force: false                    // 强制覆盖 (可选)
  }
});
```

**适用场景**:
- 新项目应用创建
- 多环境应用设置
- 自动化部署脚本

### 2. 多平台应用管理工作流 (`multi-platform-app-management`)

**用途**: 跨平台应用统一管理和优化

**功能特性**:
- 🔍 全平台应用扫描
- 📊 应用状态分析和统计
- ⚡ 自动优化建议和执行
- 📈 应用健康度评估

**工作流步骤**:
1. **平台扫描**: 扫描iOS、Android、Harmony平台的所有应用
2. **状态分析**: 分析应用活跃度、版本分布、平台分布
3. **问题识别**: 识别非活跃应用、配置问题
4. **自动优化**: 执行应用配置优化和清理

**使用示例**:
```typescript
await moduleManager.executeWorkflow('multi-platform-app-management', {
  args: [],
  options: {
    includeInactive: true,    // 包含非活跃应用
    autoOptimize: true        // 自动优化配置
  }
});
```

**适用场景**:
- 应用生态管理
- 定期健康检查
- 批量优化操作

---

## 📦 Bundle模块工作流

### 1. 智能打包工作流 (`intelligent-bundle`)

**用途**: 自动优化的多平台智能构建

**功能特性**:
- 🖥️ 构建环境自动检测
- 📂 项目结构智能分析
- ⚙️ 自动优化配置
- 🏗️ 多平台并行构建
- 🔍 构建质量检查

**工作流步骤**:
1. **环境检测**: 检查Node.js版本、内存、平台兼容性
2. **项目分析**: 分析项目类型、依赖、预估大小
3. **优化设置**: 根据项目特征自动配置优化选项
4. **多平台构建**: 并行构建指定平台或所有平台
5. **质量检查**: 检查构建质量、包大小、构建时间

**使用示例**:
```typescript
await moduleManager.executeWorkflow('intelligent-bundle', {
  args: [],
  options: {
    platform: 'ios',      // 目标平台 (可选，不指定则构建所有)
    dev: false,            // 开发模式
    sourcemap: true,       // 生成源码映射
    optimize: true         // 启用自动优化
  }
});
```

**适用场景**:
- 自动化CI/CD构建
- 多平台发布准备
- 性能优化构建

### 2. 增量构建工作流 (`incremental-build`)

**用途**: 高效的增量更新包生成

**功能特性**:
- 🔍 自动基准版本检测
- 🏗️ 当前版本构建
- 📥 基准版本下载
- 🔄 智能差异计算
- ✅ 差异包验证

**工作流步骤**:
1. **基准检测**: 自动检测或使用指定的基准版本
2. **当前构建**: 构建当前版本的Bundle
3. **基准下载**: 下载基准版本的Bundle文件
4. **差异生成**: 计算并生成差异包
5. **验证测试**: 验证差异包的完整性和可用性

**使用示例**:
```typescript
await moduleManager.executeWorkflow('incremental-build', {
  args: [],
  options: {
    platform: 'android',        // 目标平台 (必需)
    baseVersion: 'v1.0.0',      // 基准版本 (可选，自动检测)
    skipValidation: false       // 跳过验证
  }
});
```

**适用场景**:
- 热更新包生成
- 减少更新下载大小
- 快速增量发布

---

## 📄 Package模块工作流

### 1. 批量包处理工作流 (`batch-package-processing`)

**用途**: 批量处理多个应用包文件

**功能特性**:
- 🔍 智能文件扫描
- 📊 包信息分析统计
- 🔍 批量内容解析
- 📤 自动上传处理
- 📋 详细处理报告

**工作流步骤**:
1. **文件扫描**: 扫描指定目录的包文件（IPA、APK、APP）
2. **信息分析**: 分析包大小、平台分布、版本信息
3. **内容解析**: 批量解析包的元信息、权限、资源
4. **批量上传**: 自动上传解析成功的包文件
5. **报告生成**: 生成详细的处理报告和统计信息

**使用示例**:
```typescript
await moduleManager.executeWorkflow('batch-package-processing', {
  args: [],
  options: {
    directory: './packages',              // 包文件目录
    pattern: '*.{ipa,apk,app}',          // 文件匹配模式
    skipUpload: false                     // 跳过上传步骤
  }
});
```

**适用场景**:
- 批量包文件处理
- 包文件质量检查
- 自动化包管理

---

## 👤 User模块工作流

> User模块已经在现有代码中包含了完善的工作流：

### 1. 认证状态检查工作流 (`auth-check`)

**功能特性**:
- 🔐 会话状态检查
- ✅ 服务端验证
- 👤 用户信息获取
- 🔄 自动登录支持

### 2. 完整登录流程工作流 (`login-flow`)

**功能特性**:
- 🔍 现有会话检查
- 🔐 用户登录执行
- ✅ 登录状态验证
- 📋 流程状态汇总

---

## 🏷️ Version模块工作流

### 1. 版本发布管理工作流 (`version-release-management`)

**用途**: 完整的版本发布生命周期管理

**功能特性**:
- 🔍 发布前全面检查
- ✅ 版本信息验证
- ⚙️ 发布参数配置
- 🚀 发布执行和监控
- 📊 发布后监控分析
- 📋 完整发布报告

**工作流步骤**:
1. **发布前检查**: 验证版本格式、平台支持、构建环境、依赖完整性
2. **版本验证**: 检查版本冲突、规范性、发布类型
3. **发布准备**: 生成发布说明、配置分发参数、设置回滚策略
4. **执行发布**: 上传版本包、更新信息、配置分发、激活版本
5. **发布监控**: 监控下载成功率、安装成功率、崩溃率等关键指标
6. **发布总结**: 生成完整的发布报告和统计信息

**使用示例**:
```typescript
await moduleManager.executeWorkflow('version-release-management', {
  args: [],
  options: {
    name: 'v2.1.0',                    // 版本名称 (必需)
    description: 'Major update',       // 版本描述
    platform: 'ios',                  // 目标平台 (必需)
    rollout: 50,                       // 发布覆盖率
    packageVersion: '2.1.0',           // 包版本号
    dryRun: false,                     // 模拟发布
    force: false                       // 强制发布
  }
});
```

**适用场景**:
- 正式版本发布
- 灰度发布管理
- 发布质量控制

---

## 🔗 工作流使用示例

### 1. 完整发布流程组合

```typescript
// 完整的应用发布流程
async function completeReleaseFlow() {
  // 1. 应用初始化
  await moduleManager.executeWorkflow('app-initialization', {
    args: [],
    options: {
      name: 'ProductionApp',
      platform: 'ios',
      force: true
    }
  });
  
  // 2. 智能打包
  await moduleManager.executeWorkflow('intelligent-bundle', {
    args: [],
    options: {
      platform: 'ios',
      dev: false,
      optimize: true
    }
  });
  
  // 3. 版本发布
  await moduleManager.executeWorkflow('version-release-management', {
    args: [],
    options: {
      name: 'v1.0.0',
      platform: 'ios',
      rollout: 100
    }
  });
}
```

### 2. 多平台批量构建

```typescript
async function multiPlatformBuild() {
  const platforms = ['ios', 'android', 'harmony'];
  
  for (const platform of platforms) {
    await moduleManager.executeWorkflow('intelligent-bundle', {
      args: [],
      options: {
        platform,
        dev: false,
        optimize: true
      }
    });
  }
}
```

### 3. 增量更新流程

```typescript
async function incrementalUpdateFlow() {
  // 1. 生成增量包
  const buildResult = await moduleManager.executeWorkflow('incremental-build', {
    args: [],
    options: {
      platform: 'android',
      baseVersion: 'v1.0.0'
    }
  });
  
  // 2. 发布增量更新
  if (buildResult.success) {
    await moduleManager.executeWorkflow('version-release-management', {
      args: [],
      options: {
        name: 'v1.0.1',
        platform: 'android',
        rollout: 20 // 小范围发布
      }
    });
  }
}
```

---

## 📋 最佳实践

### 1. 工作流选择指南

| 场景 | 推荐工作流 | 配置建议 |
|------|------------|----------|
| 新应用创建 | `app-initialization` | 启用force参数避免冲突 |
| 生产发布 | `intelligent-bundle` + `version-release-management` | 关闭dev模式，启用优化 |
| 热更新 | `incremental-build` | 指定合适的基准版本 |
| 批量管理 | `batch-package-processing` | 定期执行包文件清理 |
| 灰度发布 | `version-release-management` | 设置合适的rollout比例 |

### 2. 错误处理策略

```typescript
async function robustWorkflowExecution() {
  try {
    const result = await moduleManager.executeWorkflow('app-initialization', {
      args: [],
      options: { name: 'MyApp', platform: 'ios' }
    });
    
    if (!result.success) {
      console.error('工作流执行失败:', result.error);
      // 执行回滚或重试逻辑
    }
  } catch (error) {
    console.error('工作流异常:', error);
    // 异常处理逻辑
  }
}
```

### 3. 工作流监控

```typescript
// 工作流执行监控
const workflowMonitor = {
  async executeWithMonitoring(workflowName: string, context: any) {
    const startTime = Date.now();
    console.log(`开始执行工作流: ${workflowName}`);
    
    try {
      const result = await moduleManager.executeWorkflow(workflowName, context);
      const duration = Date.now() - startTime;
      
      console.log(`工作流执行完成: ${workflowName}, 耗时: ${duration}ms`);
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`工作流执行失败: ${workflowName}, 耗时: ${duration}ms`, error);
      throw error;
    }
  }
};
```

### 4. 配置管理

```typescript
// 工作流配置管理
const workflowConfigs = {
  development: {
    'intelligent-bundle': { dev: true, optimize: false },
    'version-release-management': { dryRun: true, rollout: 10 }
  },
  production: {
    'intelligent-bundle': { dev: false, optimize: true },
    'version-release-management': { dryRun: false, rollout: 100 }
  }
};

async function executeWithConfig(workflowName: string, environment: string) {
  const config = workflowConfigs[environment]?.[workflowName] || {};
  
  return await moduleManager.executeWorkflow(workflowName, {
    args: [],
    options: config
  });
}
```

---

## 🎯 总结

这些增强的核心工作流为React Native Update CLI提供了：

1. **完整的应用生命周期管理** - 从创建到发布的全流程覆盖
2. **智能化构建和优化** - 自动环境检测和性能优化
3. **高效的增量更新** - 减少更新包大小，提升用户体验
4. **批量处理能力** - 提高大规模应用管理效率
5. **规范化发布流程** - 确保发布质量和一致性

每个工作流都经过精心设计，包含详细的步骤、错误处理、进度反馈和结果验证，为开发者提供了强大而可靠的自动化工具。