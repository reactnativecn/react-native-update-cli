# React Native Update CLI

[中文文档](./README.zh-CN.md)

A React Native Update command line tool for bundling, uploading native packages, publishing OTA versions, and managing apps/packages.

## Features

- Single `pushy` / `cresc` CLI entrypoint
- Backward-compatible command set
- Programmatic provider API for build scripts and CI/CD
- TypeScript type definitions

## Installation

```bash
npm install -g react-native-update-cli
```

The command-line tool is installed globally. Invoke `pushy` or `cresc` directly; do not use a project-local CLI or prefix commands with `npx`.

### Background CLI updates

Global installations update themselves in a detached background process after
a successful command. The foreground command is never held open for the
install. The CLI reuses the package manager that owns the global installation
(`npm`, `pnpm`, Yarn Classic, or Bun) and the registry configured in the current
`.npmrc`/environment, so private mirrors, credentials, proxies, and custom
global prefixes keep working.

Network failures are silent and retried after a cooldown. Concurrent commands
share a lock. A non-writable global directory is never escalated with `sudo`;
the next invocation prints the exact manual command after the permission issue
has been fixed. Project-local/npx installations and CI are not modified.

Set `RNU_AUTO_UPDATE=0` (or `RNU_DISABLE_AUTO_UPDATE=1`) to disable the feature.
`RNU_AUTO_UPDATE_PACKAGE_MANAGER=npm|pnpm|yarn|bun` overrides manager detection.

## Basic Usage

```bash
pushy help
pushy list

pushy bundle --platform ios
pushy publish --platform ios --name 1.0.0
pushy uploadIpa ./app.ipa
```

## Programmatic Usage

The Provider API is a library integration, separate from the globally installed CLI. Add the package to build-tool dependencies only when importing this API; command-line usage continues to use the global `pushy` / `cresc` binaries.

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

## Built-in Commands

### Bundle

- `bundle`: Bundle JavaScript code and optionally publish
- `hdiff`: Generate hdiff between two PPK files
- `hdiffFromApk`: Generate hdiff from APK files
- `hdiffFromApp`: Generate hdiff from APP files
- `hdiffFromIpa`: Generate hdiff from IPA files

Hermes projects: `bundle` always runs hermesc with `-output-source-map`, so the debug info section is stripped from the bytecode (15–40% smaller, same as React Native's own release builds). The Hermes sourcemap stays in the intermediate directory (`.pushy/intermedia/<platform>/<bundle>.map`, never packed into the ppk) and is composed with the packager map — `--sourcemap` is on by default since 2.23 (`--no-sourcemap` opts out). When `bundle` publishes, that final map is uploaded and archived with the version (`sourceMapKey`), so `pushy symbolicate` can map crash stacks — including Hermes `address at` frames — back to source later. `pushy publish <ppk> --sourcemap <file.map>` archives a map for a ppk built elsewhere; publishing without a map prints a warning.

Hermes delta mode (`-base-bytecode`): by default (`--hermesBase auto`) `bundle` compiles against the previous HBC of the same app, which keeps Hermes string IDs stable and makes hot-update patches 5–30× smaller. The base comes from the server (`GET /app/:id/hermesBase`), verified by sha256 and kept in a local cache (`.pushy/cache/<sha256>`, 500 MB / 20 files, `PUSHY_CACHE_DIR` / `--cacheMaxMb` to tune, `pushy cache [clean]` to inspect or clear). `--hermesBase none` disables it; `--hermesBase <file.hbc|.ppk|.apk|.ipa>` uses a local artifact (for example the store build). `--verifyHermesBase` (default on) additionally compiles without the base (concurrently with the base compile) and compares both disassemblies; on any mismatch or failure the CLI silently falls back to the plain compile, so the feature can never block a release. Only hermesc builds that include the upstream delta-mode fix are used (classic `react-native/sdks/hermesc`, or `hermes-compiler` ≥ 250829098). If a base compile fails, the full hermesc output is written to `hermes-base-error.log` next to the intermediate directory. `--resetCache false` skips Metro's `--reset-cache` and reuses its transform cache, which makes repeated bundles much faster.

### Version

- `publish`: Publish a new version (`--sourcemap <file.map>` archives the source map with it)
- `symbolicate`: Map a crash stack to source using the archived map: `pushy symbolicate stack.txt --hash <updateHash>` (`-` reads stdin, `--versionId` instead of `--hash`, `--output <file>`); the hash is `getUpdateMetadata().currentVersion` on the device
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

## Environment Variables

`publish` requires a generated `.ppk` path via `filePath`. Provider list methods return data in `CommandResult.data` and do not enter interactive paging.

```bash
export PUSHY_REGISTRY=https://your-api-endpoint.com
export NO_INTERACTIVE=true
```

## Sentry Sourcemaps

When `ios/sentry.properties` or `android/sentry.properties` exists, `bundle` uploads sourcemaps for OTA packages. The default matching path is Sentry Debug IDs; the CLI no longer infers release/dist from the native package.

React Native projects should use `@sentry/react-native/metro` in `metro.config.js` so the generated bundle and sourcemap share the same Debug ID. For Hermes, the CLI copies the packager sourcemap Debug ID to the composed Hermes sourcemap and uploads with:

```bash
sentry-cli sourcemaps upload --debug-id-reference
```

For older self-hosted Sentry versions or older `@sentry/cli` versions without Debug ID support, pass explicit legacy release/dist values:

```bash
pushy bundle --platform android --name "4.1" --sentry-release "com.example@1.0.0+10+pushy:4.1" --sentry-dist "pushy:4.1"
```

In legacy mode, the app runtime must report exactly the same Sentry `release` and `dist` values.

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
