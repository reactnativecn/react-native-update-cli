# React Native Update CLI

[English Documentation](./README.md)

React Native Update 命令行工具，用于打包、上传原生包、发布 OTA 版本，以及管理应用和包。

## 功能

- 统一的 `pushy` / `cresc` CLI 入口
- 保持既有命令兼容
- 可用于构建脚本和 CI/CD 的 Provider API
- 提供 TypeScript 类型定义

## 安装

```bash
npm install react-native-update-cli
```

## 基础用法

```bash
npx pushy help
npx pushy list

npx pushy bundle --platform ios
npx pushy publish --platform ios --name 1.0.0
npx pushy uploadIpa ./app.ipa
```

## 编程调用

```typescript
import { CLIProviderImpl } from 'react-native-update-cli';

const provider = new CLIProviderImpl();

const bundleResult = await provider.bundle({
  platform: 'ios',
  dev: false,
  sourcemap: true,
});

if (!bundleResult.success) {
  throw new Error(bundleResult.error);
}

const publishResult = await provider.publish({
  filePath: '.pushy/output/ios.ppk',
  platform: 'ios',
  name: 'v1.2.3',
  description: 'Bug fixes and improvements',
  rollout: 100,
});
```

## 内置命令

### Bundle

- `bundle`: 打包 JavaScript 代码，可选择发布
- `hdiff`: 基于两个 PPK 文件生成 hdiff
- `hdiffFromApk`: 基于 APK 文件生成 hdiff
- `hdiffFromApp`: 基于 APP 文件生成 hdiff
- `hdiffFromIpa`: 基于 IPA 文件生成 hdiff

### Version

- `publish`: 发布新版本
- `versions`: 列出版本
- `update`: 更新版本包规则
- `updateVersionInfo`: 更新版本元信息
- `deleteVersion`: 删除版本

### App

- `createApp`: 创建应用
- `apps`: 列出应用
- `selectApp`: 选择应用
- `deleteApp`: 删除应用

### Package

- `uploadIpa`: 上传 IPA 文件
- `uploadApk`: 上传 APK 文件
- `uploadAab`: 上传 AAB 文件
- `uploadApp`: 上传 APP 文件
- `parseApp`: 解析 APP 文件信息
- `parseIpa`: 解析 IPA 文件信息
- `parseApk`: 解析 APK 文件信息
- `parseAab`: 解析 AAB 文件信息
- `extractApk`: 从 AAB 提取通用 APK
- `packages`: 列出包
- `deletePackage`: 删除包

### User

- `login`: 登录
- `logout`: 退出登录
- `me`: 查看当前用户信息

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

## 环境变量

`publish` 需要通过 `filePath` 传入已生成的 `.ppk` 文件路径。Provider 的列表方法会把数据放在 `CommandResult.data`，不会进入交互式翻页。

```bash
export PUSHY_REGISTRY=https://your-api-endpoint.com
export NO_INTERACTIVE=true
```

## Sentry Sourcemap

当项目存在 `ios/sentry.properties` 或 `android/sentry.properties` 时，`bundle` 会为 OTA 包上传 sourcemap。默认使用 Sentry Debug ID 匹配，不再根据原生包推导 release/dist。

React Native 项目需要在 `metro.config.js` 中接入 `@sentry/react-native/metro`，确保生成的 bundle 和 sourcemap 带有相同 Debug ID。Hermes 场景下 CLI 会把 packager sourcemap 的 Debug ID 复制到合成后的 Hermes sourcemap，并使用：

```bash
sentry-cli sourcemaps upload --debug-id-reference
```

旧版 self-hosted Sentry 或旧版 `@sentry/cli` 不支持 Debug ID 时，可以显式指定 legacy release/dist：

```bash
npx pushy bundle --platform android --name "4.1" --sentry-release "com.example@1.0.0+10+pushy:4.1" --sentry-dist "pushy:4.1"
```

这种 legacy 模式要求 App 运行时上报到 Sentry 的 `release` 和 `dist` 与上传参数完全一致。

## 配置文件

在 React Native 项目中创建 `update.json`：

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

## 注意事项

Provider 方法都会返回 `CommandResult`，消费 `data` 前需要检查 `success`。CLI 支持 `ios`、`android` 和 `harmony` 三个平台。
