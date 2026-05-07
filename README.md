# React Native Update CLI

[中文文档](./README.zh-CN.md)

A React Native Update command line tool for bundling, uploading native packages, publishing OTA versions, and managing apps/packages.

## Features

- Single `pushy` / `cresc` CLI entrypoint
- Backward-compatible command set
- Programmatic provider API for build scripts and CI/CD
- Modular command registration for custom extensions
- TypeScript type definitions

## Installation

```bash
npm install react-native-update-cli
```

## Basic Usage

```bash
npx pushy help
npx pushy list

npx pushy bundle --platform ios
npx pushy publish --platform ios --name 1.0.0
npx pushy uploadIpa ./app.ipa
```

## Programmatic Usage

```typescript
import { moduleManager } from 'react-native-update-cli';

const provider = moduleManager.getProvider();

const bundleResult = await provider.bundle({
  platform: 'ios',
  dev: false,
  sourcemap: true,
});

if (!bundleResult.success) {
  throw new Error(bundleResult.error);
}

const publishResult = await provider.publish({
  name: 'v1.2.3',
  description: 'Bug fixes and improvements',
  rollout: 100,
});
```

## Custom Modules

```typescript
import type {
  CLIModule,
  CommandContext,
  CommandResult,
} from 'react-native-update-cli';

export const myCustomModule: CLIModule = {
  name: 'my-custom',
  version: '1.0.0',
  commands: [
    {
      name: 'custom-command',
      description: 'My custom command',
      handler: async (
        context: CommandContext,
      ): Promise<CommandResult> => {
        return {
          success: true,
          data: { options: context.options },
        };
      },
      options: {
        param: { hasValue: true, description: 'Custom parameter' },
      },
    },
  ],
  init: () => {
    console.log('Custom module initialized');
  },
  cleanup: () => {
    console.log('Custom module cleanup');
  },
};
```

```typescript
import { moduleManager } from 'react-native-update-cli';
import { myCustomModule } from './my-custom-module';

moduleManager.registerModule(myCustomModule);

const result = await moduleManager.executeCommand('custom-command', {
  args: [],
  options: { param: 'value' },
});
```

## Built-in Commands

### Bundle

- `bundle`: Bundle JavaScript code and optionally publish
- `hdiff`: Generate hdiff between two PPK files
- `hdiffFromApk`: Generate hdiff from APK files
- `hdiffFromApp`: Generate hdiff from APP files
- `hdiffFromIpa`: Generate hdiff from IPA files

### Version

- `publish`: Publish a new version
- `versions`: List versions
- `update`: Update version package rules
- `updateVersionInfo`: Update version metadata
- `deleteVersion`: Delete a version

### App

- `createApp`: Create an app
- `apps`: List apps
- `selectApp`: Select an app
- `deleteApp`: Delete an app

### Package

- `uploadIpa`: Upload IPA files
- `uploadApk`: Upload APK files
- `uploadAab`: Upload AAB files
- `uploadApp`: Upload APP files
- `parseApp`: Parse APP file information
- `parseIpa`: Parse IPA file information
- `parseApk`: Parse APK file information
- `parseAab`: Parse AAB file information
- `extractApk`: Extract a universal APK from an AAB
- `packages`: List packages
- `deletePackage`: Delete a package

### User

- `login`: Login
- `logout`: Logout
- `me`: Show current user information

## Provider API

```typescript
interface CLIProvider {
  bundle(options: BundleOptions): Promise<CommandResult>;
  publish(options: PublishOptions): Promise<CommandResult>;
  upload(options: UploadOptions): Promise<CommandResult>;

  getSelectedApp(
    platform?: Platform,
  ): Promise<{ appId: string; platform: Platform }>;
  listApps(platform?: Platform): Promise<CommandResult>;
  createApp(name: string, platform: Platform): Promise<CommandResult>;

  listVersions(appId: string): Promise<CommandResult>;
  updateVersion(
    appId: string,
    versionId: string,
    updates: Partial<Version>,
  ): Promise<CommandResult>;

  getPlatform(platform?: Platform): Promise<Platform>;
  loadSession(): Promise<Session>;
}
```

## Environment Variables

```bash
export PUSHY_REGISTRY=https://your-api-endpoint.com
export NO_INTERACTIVE=true
```

## Configuration

Create `update.json` in your React Native project:

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

## Notes

All provider methods return `CommandResult`; check `success` before consuming `data`. The CLI supports `ios`, `android`, and `harmony` platforms.
