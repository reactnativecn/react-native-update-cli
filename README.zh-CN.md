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
npm install -g react-native-update-cli
```

命令行工具始终全局安装，直接调用 `pushy` 或 `cresc`；不要使用项目本地 CLI，也不要给命令添加 `npx` 前缀。

### CLI 后台自动更新

全局安装的 CLI 会在命令成功结束后启动独立后台进程完成自更新，不会让当前命令等待安装。更新会沿用这份全局安装实际所属的包管理器（`npm`、`pnpm`、Yarn Classic 或 Bun），并使用当前 `.npmrc` / 环境中的 registry 配置，因此私有镜像、认证、代理和自定义全局目录均可继续生效。

网络失败会静默降级并在冷却期后重试；并发命令通过锁避免重复安装。全局目录不可写时不会自动调用 `sudo`，下次运行会给出修复权限后可执行的准确命令。本地依赖、npx 临时安装和 CI 环境不会被修改。

设置 `RNU_AUTO_UPDATE=0`（或 `RNU_DISABLE_AUTO_UPDATE=1`）可关闭；`RNU_AUTO_UPDATE_PACKAGE_MANAGER=npm|pnpm|yarn|bun` 可覆盖包管理器识别结果。

## 基础用法

```bash
pushy help
pushy list

pushy bundle --platform ios
pushy publish --platform ios --name 1.0.0
pushy uploadIpa ./app.ipa
```

## 编程调用

Provider API 属于库集成，与全局 CLI 分开。只有在代码中导入该 API 时才把包加入构建工具依赖；命令行仍然使用全局的 `pushy` / `cresc`。

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

Hermes 工程：`bundle` 调用 hermesc 时始终带 `-output-source-map`，因此字节码不含 debug info 段（小 15%～40%，与 React Native 自身 release 构建一致）。Hermes sourcemap 保留在中间目录（`.pushy/intermedia/<platform>/<bundle>.map`，不会打进 ppk），并与 packager map 合成——自 2.23 起 `--sourcemap` 默认开启（`--no-sourcemap` 关闭）。`bundle` 发布时会把这份最终 map 上传并随版本归档（`sourceMapKey`），之后用 `pushy symbolicate` 即可把崩溃堆栈（含 Hermes 的 `address at` 帧）还原到源码。别处打好的 ppk 可用 `pushy publish <ppk> --sourcemap <file.map>` 归档；不带 map 发布会打印警告。

Hermes delta 模式（`-base-bytecode`）：默认 `--hermesBase auto`，`bundle` 会以同一应用上一版的 HBC 为 base 编译，让 Hermes 字符串 ID 跨版本稳定，热更 patch 可缩小 5～30 倍。base 由服务端（`GET /app/:id/hermesBase`）给出、按 sha256 校验并存入本地缓存（`.pushy/cache/<sha256>`，默认 500 MB / 20 个，可用 `PUSHY_CACHE_DIR` / `--cacheMaxMb` 调整，`pushy cache [clean]` 查看或清空）。`--hermesBase none` 关闭；`--hermesBase <file.hbc|.ppk|.apk|.ipa>` 指定本地文件（比如商店包）作 base。`--verifyHermesBase`（默认开）会并行再做一次普通编译并比对两份反汇编；任何不一致或失败都静默回退到普通编译，不会阻塞发版。只有包含上游 delta 模式修复的 hermesc 才会启用（经典 `react-native/sdks/hermesc`，或 `hermes-compiler` ≥ 250829098）。base 编译失败时，完整的 hermesc 输出会写到中间目录旁边的 `hermes-base-error.log`。`--resetCache false` 可跳过 Metro 的 `--reset-cache`，复用其转换缓存，重复打包会快很多。

### Version

- `publish`: 发布新版本（`--sourcemap <file.map>` 随版本归档 source map）
- `symbolicate`: 用归档的 map 还原崩溃堆栈：`pushy symbolicate stack.txt --hash <热更 hash>`（`-` 读 stdin，可用 `--versionId` 代替 `--hash`，`--output <文件>` 写文件）；hash 即设备上 `getUpdateMetadata().currentVersion`
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
  symbolicate(options: SymbolicateOptions): Promise<CommandResult>;
  upload(options: UploadOptions): Promise<CommandResult>;

  createApp(name: string, platform: Platform): Promise<CommandResult>;
  listApps(platform?: Platform): Promise<CommandResult>;
  getSelectedApp(
    platform?: Platform,
    config?: string,
  ): Promise<{ appId: string; platform: Platform }>;

  listVersions(appId: string): Promise<CommandResult>;
  updateVersion(
    appId: string,
    versionId: string,
    updates: UpdateVersionOptions,
  ): Promise<CommandResult>;
  listPackages(appId?: string): Promise<CommandResult>;

  getPlatform(platform?: Platform): Promise<Platform>;
  loadSession(): Promise<Session>;
}
```

## 环境变量

`publish` 需要通过 `filePath` 传入已生成的 `.ppk` 文件路径。Provider 的列表方法会把数据放在 `CommandResult.data`，不会进入交互式翻页。

```bash
export PUSHY_REGISTRY=https://your-api-endpoint.com
export NO_INTERACTIVE=true
export RNU_LANG=en      # 界面语言（默认：pushy 为 zh，cresc 为 en）
export RNU_DEBUG=1      # 出错时打印完整堆栈
```

## Sentry Sourcemap

当项目存在 `ios/sentry.properties` 或 `android/sentry.properties` 时，`bundle` 会为 OTA 包上传 sourcemap。默认使用 Sentry Debug ID 匹配，不再根据原生包推导 release/dist。

React Native 项目需要在 `metro.config.js` 中接入 `@sentry/react-native/metro`，确保生成的 bundle 和 sourcemap 带有相同 Debug ID。Hermes 场景下 CLI 会把 packager sourcemap 的 Debug ID 复制到合成后的 Hermes sourcemap，并使用：

```bash
sentry-cli sourcemaps upload --debug-id-reference
```

旧版 self-hosted Sentry 或旧版 `@sentry/cli` 不支持 Debug ID 时，可以显式指定 legacy release/dist：

```bash
pushy bundle --platform android --name "4.1" --sentry-release "com.example@1.0.0+10+pushy:4.1" --sentry-dist "pushy:4.1"
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
