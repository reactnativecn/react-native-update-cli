# React Native Update CLI

[中文文档](./README.zh-CN.md) | [Chinese Documentation](./README.zh-CN.md)

A unified React Native Update CLI that supports both traditional commands and modular architecture with custom publishing workflows.

## 🚀 Features

- **Unified CLI**: Single `pushy` command for all functionality
- **Backward Compatibility**: All existing commands work as before
- **Modular Architecture**: Split CLI functionality into independent modules
- **Custom Workflows**: Support for creating custom publishing workflows
- **Extensibility**: Users can import and register custom modules
- **Type Safety**: Complete TypeScript type support

## 📦 Installation

```bash
npm install react-native-update-cli
```

## 🎯 Quick Start

### Basic Usage

```bash
# Use unified CLI
npx pushy help

# List all available commands and workflows
npx pushy list

# Execute built-in workflow
npx pushy workflow setup-app

# Execute custom workflow
npx pushy workflow custom-publish
```

### Programmatic Usage

```typescript
import { moduleManager, CLIProviderImpl } from 'react-native-update-cli';

// Get CLI provider
const provider = moduleManager.getProvider();

// Execute bundling
const bundleResult = await provider.bundle({
  platform: 'ios',
  dev: false,
  sourcemap: true,
});

// Publish version
const publishResult = await provider.publish({
  name: 'v1.2.3',
  description: 'Bug fixes and improvements',
  rollout: 100,
});
```

## 🔧 Creating Custom Modules

### 1. Define Module

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

### 2. Register Module

```typescript
import { moduleManager } from 'react-native-update-cli';
import { myCustomModule } from './my-custom-module';

// Register custom module
moduleManager.registerModule(myCustomModule);

// Execute custom command
const result = await moduleManager.executeCommand('custom-command', {
  args: [],
  options: { param: 'value' },
});

// Execute custom workflow
const workflowResult = await moduleManager.executeWorkflow('my-workflow', {
  args: [],
  options: {},
});
```

## 🔄 Workflow System

### Workflow Steps

Each workflow step contains:

- `name`: Step name
- `description`: Step description
- `execute`: Execution function
- `condition`: Optional condition function

### Conditional Execution

```typescript
{
  name: 'conditional-step',
  description: 'Only execute in production',
  execute: async (context, previousResult) => {
    // Execution logic
  },
  condition: (context) => {
    return context.options.environment === 'production';
  }
}
```

### Workflow Validation

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

## 📋 Built-in Modules

### Bundle Module (`bundle`)

- `bundle`: Bundle JavaScript code and optionally publish
- `diff`: Generate differences between two PPK files
- `hdiff`: Generate hdiff between two PPK files
- `diffFromApk`: Generate differences from APK files
- `hdiffFromApk`: Generate hdiff from APK files
- `hdiffFromApp`: Generate hdiff from APP files
- `diffFromIpa`: Generate differences from IPA files
- `hdiffFromIpa`: Generate hdiff from IPA files

### Version Module (`version`)

- `publish`: Publish new version
- `versions`: List all versions
- `update`: Update version information
- `updateVersionInfo`: Update version metadata

### App Module (`app`)

- `createApp`: Create new application
- `apps`: List all applications
- `selectApp`: Select application
- `deleteApp`: Delete application

### Package Module (`package`)

- `uploadIpa`: Upload IPA files (supports `--version` to override extracted version)
- `uploadApk`: Upload APK files (supports `--version` to override extracted version)
- `uploadApp`: Upload APP files (supports `--version` to override extracted version)
- `parseApp`: Parse APP file information
- `parseIpa`: Parse IPA file information
- `parseApk`: Parse APK file information
- `packages`: List packages

### User Module (`user`)

- `login`: Login
- `logout`: Logout
- `me`: Show user information

## 🛠️ CLI Provider API

### Core Functionality

```typescript
interface CLIProvider {
  // Bundle
  bundle(options: BundleOptions): Promise<CommandResult>;

  // Publish
  publish(options: PublishOptions): Promise<CommandResult>;

  // Upload
  upload(options: UploadOptions): Promise<CommandResult>;

  // Application management
  getSelectedApp(
    platform?: Platform,
  ): Promise<{ appId: string; platform: Platform }>;
  listApps(platform?: Platform): Promise<CommandResult>;
  createApp(name: string, platform: Platform): Promise<CommandResult>;

  // Version management
  listVersions(appId: string): Promise<CommandResult>;
  getVersion(appId: string, versionId: string): Promise<CommandResult>;
  updateVersion(
    appId: string,
    versionId: string,
    updates: Partial<Version>,
  ): Promise<CommandResult>;

  // Package management
  listPackages(appId: string, platform?: Platform): Promise<CommandResult>;
  getPackage(appId: string, packageId: string): Promise<CommandResult>;

  // Utility functions
  getPlatform(platform?: Platform): Promise<Platform>;
  loadSession(): Promise<Session>;
  saveToLocal(key: string, value: string): void;
  question(prompt: string): Promise<string>;

  // Workflows
  registerWorkflow(workflow: CustomWorkflow): void;
  executeWorkflow(
    workflowName: string,
    context: CommandContext,
  ): Promise<CommandResult>;
}
```

### Custom Commands

```typescript
// Execute custom bundle command
const bundleResult = await moduleManager.executeCommand('custom-bundle', {
  args: [],
  options: {
    platform: 'android',
    validate: true,
    optimize: true,
  },
});

// Generate diff file
const diffResult = await moduleManager.executeCommand('diff', {
  args: [],
  options: {
    origin: './build/v1.0.0.ppk',
    next: './build/v1.1.0.ppk',
    output: './build/diff.patch',
  },
});

// Generate diff from APK files
const apkDiffResult = await moduleManager.executeCommand('diffFromApk', {
  args: [],
  options: {
    origin: './build/app-v1.0.0.apk',
    next: './build/app-v1.1.0.apk',
    output: './build/apk-diff.patch',
  },
});
```

## 🔧 Configuration

### Environment Variables

```bash
# Set API endpoint
export PUSHY_REGISTRY=https://your-api-endpoint.com

# Set non-interactive mode
export NO_INTERACTIVE=true
```

### Configuration File

Create `update.json` file:

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

## 🚨 Important Notes

1. **Backward Compatibility**: The new modular CLI maintains compatibility with existing CLI
2. **Type Safety**: All APIs have complete TypeScript type definitions
3. **Error Handling**: All operations return standardized result formats
4. **Resource Cleanup**: Modules support cleanup functions to release resources
5. **Module Separation**: Functionality is logically separated into different modules for easy maintenance and extension

## 🤝 Contributing

Welcome to submit Issues and Pull Requests to improve this project!

## 🚀 Provider API Usage Guide

Provider provides a concise programming interface suitable for integrating React Native Update CLI functionality in applications.

### 📋 Core API Methods

#### Core Business Functions

```typescript
// Bundle application
await provider.bundle({
  platform: 'ios',
  dev: false,
  sourcemap: true,
});

// Publish version
await provider.publish({
  name: 'v1.0.0',
  description: 'Bug fixes',
  rollout: 100,
});

// Upload file
await provider.upload({
  filePath: 'app.ipa',
  platform: 'ios',
});
```

#### Application Management

```typescript
// Create application
await provider.createApp('MyApp', 'ios');

// List applications
await provider.listApps('ios');

// Get current application
const { appId, platform } = await provider.getSelectedApp('ios');
```

#### Version Management

```typescript
// List versions
await provider.listVersions('app123');

// Update version
await provider.updateVersion('app123', 'version456', {
  name: 'v1.1.0',
  description: 'New features',
});
```

#### Utility Functions

```typescript
// Get platform
const platform = await provider.getPlatform('ios');

// Load session
const session = await provider.loadSession();
```

### 🎯 Use Cases

#### 1. Automated Build Scripts

```typescript
import { moduleManager } from 'react-native-update-cli';

async function buildAndPublish() {
  const provider = moduleManager.getProvider();

  // 1. Bundle
  const bundleResult = await provider.bundle({
    platform: 'ios',
    dev: false,
    sourcemap: true,
  });

  if (!bundleResult.success) {
    throw new Error(`Bundle failed: ${bundleResult.error}`);
  }

  // 2. Publish
  const publishResult = await provider.publish({
    name: 'v1.2.3',
    description: 'Bug fixes and performance improvements',
    rollout: 100,
  });

  if (!publishResult.success) {
    throw new Error(`Publish failed: ${publishResult.error}`);
  }

  console.log('Build and publish completed!');
}
```

#### 2. CI/CD Integration

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

#### 3. Application Management Service

```typescript
class AppManagementService {
  private provider = moduleManager.getProvider();

  async setupNewApp(name: string, platform: Platform) {
    // Create application
    const createResult = await this.provider.createApp(name, platform);

    if (createResult.success) {
      // Get application information
      const { appId } = await this.provider.getSelectedApp(platform);

      // List versions
      await this.provider.listVersions(appId);

      return { appId, success: true };
    }

    return { success: false, error: createResult.error };
  }
}
```

### ⚠️ Important Notes

1. **Error Handling**: All Provider methods return `CommandResult`, need to check the `success` field
2. **Type Safety**: Provider provides complete TypeScript type support
3. **Session Management**: Ensure login before use, can check via `loadSession()`
4. **Platform Support**: Supports `'ios' | 'android' | 'harmony'` three platforms

### 🔧 Advanced Features

#### Custom Workflows

```typescript
// Register custom workflow
provider.registerWorkflow({
  name: 'quick-release',
  description: 'Quick release process',
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
          throw new Error('Bundle failed, cannot publish');
        }
        return await provider.publish({ name: 'auto-release', rollout: 50 });
      },
    },
  ],
});

// Execute workflow
await provider.executeWorkflow('quick-release', { args: [], options: {} });
```

### 📚 Complete Example

```typescript
import { moduleManager } from 'react-native-update-cli';

class ReactNativeUpdateService {
  private provider = moduleManager.getProvider();

  async initialize() {
    // Load session
    await this.provider.loadSession();
  }

  async buildAndDeploy(platform: Platform, version: string) {
    try {
      // 1. Bundle
      const bundleResult = await this.provider.bundle({
        platform,
        dev: false,
        sourcemap: true,
      });

      if (!bundleResult.success) {
        throw new Error(`Bundle failed: ${bundleResult.error}`);
      }

      // 2. Publish
      const publishResult = await this.provider.publish({
        name: version,
        description: `Release ${version}`,
        rollout: 100,
      });

      if (!publishResult.success) {
        throw new Error(`Publish failed: ${publishResult.error}`);
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

// Usage example
const service = new ReactNativeUpdateService();
await service.initialize();
await service.buildAndDeploy('ios', 'v1.0.0');
```
