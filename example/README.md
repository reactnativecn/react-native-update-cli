# Custom Modules and Workflows Examples

[中文文档](./README.zh-CN.md) | [Chinese Documentation](./README.zh-CN.md)

This directory contains complete examples of React Native Update CLI custom modules and workflows, demonstrating how to extend the CLI functionality.

## 📁 Directory Structure

```
example/
├── modules/                    # Custom module examples
│   ├── custom-deploy-module.ts # Custom deployment module
│   └── analytics-module.ts     # Analytics module
├── workflows/                  # Custom workflow examples
│   └── custom-workflows.ts     # Complex workflow collection
├── scripts/                    # Execution script examples
│   ├── register-modules.ts     # Module registration and execution
│   ├── provider-api-example.ts # Provider API usage examples
│   └── workflow-demo.ts        # Workflow demonstration script
└── README.md                   # This documentation
```

## 🚀 Quick Start

### 1. Run Module Registration and Execution Examples

```bash
# Compile TypeScript (if needed)
npm run build

# Run module examples
npx ts-node example/scripts/register-modules.ts
```

### 2. Run Provider API Examples

```bash
npx ts-node example/scripts/provider-api-example.ts
```

### 3. Run Workflow Demonstrations

```bash
# Run all workflow demonstrations
npx ts-node example/scripts/workflow-demo.ts

# Interactive execution of specific workflows
npx ts-node example/scripts/workflow-demo.ts interactive canary-deployment --version 1.0.0 --initialRollout 5

# Multi-environment deployment workflow
npx ts-node example/scripts/workflow-demo.ts interactive multi-env-deploy --version 1.0.0

# Rollback workflow
npx ts-node example/scripts/workflow-demo.ts interactive rollback-workflow --targetVersion 0.9.5
```

## 📦 Custom Module Examples

### 1. Custom Deployment Module (`custom-deploy-module.ts`)

This module demonstrates how to create a complete deployment management module, including:

#### Commands:
- `deploy-dev`: Deploy to development environment
- `deploy-prod`: Deploy to production environment  
- `rollback`: Rollback to specified version

#### Workflows:
- `full-deploy`: Complete deployment process (development → testing → production)
- `hotfix-deploy`: Quick hotfix deployment process

#### Usage Example:
```typescript
import { moduleManager } from 'react-native-update-cli';
import { customDeployModule } from './modules/custom-deploy-module';

// Register module
moduleManager.registerModule(customDeployModule);

// Execute development deployment
await moduleManager.executeCommand('deploy-dev', {
  args: [],
  options: { platform: 'ios', force: true }
});

// Execute complete deployment workflow
await moduleManager.executeWorkflow('full-deploy', {
  args: [],
  options: { version: '1.2.3' }
});
```

### 2. Analytics Module (`analytics-module.ts`)

Demonstrates how to create analytics and statistics functionality:

#### Commands:
- `track-deployment`: Record deployment statistics
- `deployment-report`: Generate deployment reports

#### Workflows:
- `deploy-with-analytics`: Deployment process with analytics

## 🔄 Custom Workflow Examples

### 1. Canary Deployment Workflow (`canary-deployment`)

Implements a complete canary deployment process:

- ✅ Prepare canary deployment environment
- ✅ Initial small-scale deployment
- ✅ Monitor key metrics
- ✅ Automatically expand deployment based on metrics
- ✅ Final validation

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

### 2. Multi-Environment Deployment Workflow (`multi-env-deploy`)

Implements a standard multi-environment deployment process:

- ✅ Deploy to development environment
- ✅ Run integration tests
- ✅ Deploy to staging environment
- ✅ Run end-to-end tests
- ✅ Deploy to production environment
- ✅ Post-deployment validation

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

### 3. Rollback Workflow (`rollback-workflow`)

Safe application rollback process:

- ✅ Validate target version
- ✅ Backup current state
- ✅ Execute rollback operation
- ✅ Verify rollback results
- ✅ Notify relevant personnel

```typescript
await moduleManager.executeWorkflow('rollback-workflow', {
  args: [],
  options: {
    targetVersion: '2.0.5',
    skipVerification: false
  }
});
```

## 🛠️ Provider API Usage Examples

Provider API provides programmatic interfaces suitable for integration in applications:

### Basic Usage

```typescript
import { moduleManager } from 'react-native-update-cli';

const provider = moduleManager.getProvider();

// Bundle application
const bundleResult = await provider.bundle({
  platform: 'ios',
  dev: false,
  sourcemap: true
});

// Publish version
const publishResult = await provider.publish({
  name: 'v1.0.0',
  description: 'Bug fixes',
  rollout: 100
});

// Upload file
const uploadResult = await provider.upload({
  filePath: 'app.ipa',
  platform: 'ios'
});
```

### Application Management

```typescript
// Create application
await provider.createApp('MyApp', 'ios');

// Get current application
const { appId, platform } = await provider.getSelectedApp('ios');

// List versions
const versions = await provider.listVersions(appId);

// Update version
await provider.updateVersion(appId, versionId, {
  name: 'v1.1.0',
  description: 'New features'
});
```

### Automation Service Class

```typescript
class DeploymentService {
  private provider = moduleManager.getProvider();
  
  async buildAndPublish(platform: Platform, version: string) {
    // 1. Bundle
    const bundleResult = await this.provider.bundle({
      platform, dev: false, sourcemap: true
    });
    
    // 2. Publish
    const publishResult = await this.provider.publish({
      name: version, rollout: 100
    });
    
    return { bundleResult, publishResult };
  }
}
```

## 🎯 Advanced Features

### 1. Workflow Validation

```typescript
const workflow: CustomWorkflow = {
  name: 'my-workflow',
  steps: [...],
  validate: (context) => {
    if (!context.options.version) {
      console.error('Version number must be specified');
      return false;
    }
    return true;
  }
};
```

### 2. Conditional Execution

```typescript
const step: WorkflowStep = {
  name: 'conditional-step',
  execute: async (context) => { /* ... */ },
  condition: (context) => {
    return context.options.environment === 'production';
  }
};
```

### 3. Error Handling

```typescript
try {
  const result = await moduleManager.executeCommand('deploy-prod', {
    args: [],
    options: {} // Missing required parameters
  });
} catch (error) {
  console.error('Execution failed:', error.message);
}
```

### 4. Custom Workflow Registration

```typescript
const provider = moduleManager.getProvider();

provider.registerWorkflow({
  name: 'custom-workflow',
  description: 'Custom workflow',
  steps: [
    {
      name: 'step1',
      execute: async (context, previousResult) => {
        // Execution logic
        return { step1: 'completed' };
      }
    }
  ]
});

// Execute workflow
await provider.executeWorkflow('custom-workflow', {
  args: [],
  options: {}
});
```

## 📝 Best Practices

### 1. Module Design

- **Single Responsibility**: Each module focuses on specific functional domains
- **Clear Naming**: Use descriptive command and option names
- **Complete Documentation**: Provide descriptions for all commands and options
- **Error Handling**: Provide clear error messages and recovery suggestions

### 2. Workflow Design

- **Atomic Operations**: Each step should be atomic and independently executable
- **State Passing**: Properly use previousResult to pass state
- **Error Recovery**: Consider cleanup and recovery mechanisms for failures
- **Progress Feedback**: Provide clear progress information to users

### 3. Development Recommendations

- **Type Safety**: Make full use of the TypeScript type system
- **Test Coverage**: Write tests for custom modules
- **Documentation Maintenance**: Keep examples and documentation synchronized
- **Version Management**: Set appropriate version numbers for modules

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

2. **Command Execution Failed**
   ```typescript
   // Check command name and parameters
   await moduleManager.executeCommand('correct-command-name', {
     args: [],
     options: { requiredParam: 'value' }
   });
   ```

3. **Workflow Validation Failed**
   ```typescript
   // Ensure all required options are provided
   await moduleManager.executeWorkflow('workflow-name', {
     args: [],
     options: { version: '1.0.0' } // Required parameter
   });
   ```

## 📖 Related Documentation

- [Main Project README](../README.md)
- [Modular Architecture Documentation](../docs/architecture.md)
- [API Reference Documentation](../docs/api-reference.md)
- [Contributing Guide](../CONTRIBUTING.md)

## 🤝 Contributing

Welcome to submit more examples and improvement suggestions! Please check the main project's contributing guide.