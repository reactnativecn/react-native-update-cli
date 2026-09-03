declare global {
  var NO_INTERACTIVE: boolean | undefined;
  var USE_ACC_OSS: boolean | undefined;
}

export interface Session {
  token: string;
}

export type Platform = 'ios' | 'android' | 'harmony';

export interface Package {
  // server-side ids are numeric (auto-increment primary keys)
  id: number;
  name: string;
  version?: string;
  status?: string;
  appId?: string;
  appKey?: string;
  versionName?: string | number | null;
  buildTime?: string | number | null;
  deps?: Record<string, string> | string | null;
}

export interface Version {
  id: number;
  hash: string;
  name: string;
  packages?: Package[];
  deps?: Record<string, string> | string | null;
  /** storage key of the archived source map (absent when published without one) */
  sourceMapKey?: string;
}

export interface CommandContext<
  TOptions extends Record<string, unknown> = Record<string, unknown>,
> {
  args: string[];
  options: TOptions;
  platform?: Platform;
  appId?: string;
  session?: Session;
}

export interface CommandResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface BundleOptions {
  dev?: boolean;
  platform?: Platform;
  bundleName?: string;
  entryFile?: string;
  output?: string;
  sourcemap?: boolean;
  taro?: boolean;
  expo?: boolean;
  rncli?: boolean;
  hermes?: boolean;
  /** 'auto' (default) | 'none' | path to a .hbc/.ppk/.apk/.ipa used as hermesc -base-bytecode */
  hermesBase?: string;
  /** run the disassembly equivalence check after a base compile (default true) */
  verifyHermesBase?: boolean;
  /** pass --reset-cache to Metro (default true); false reuses its transform cache */
  resetCache?: boolean;
  sentryRelease?: string;
  sentryDist?: string;
  /** publish to this app instead of the one selected in the config file */
  appId?: string;
  /** selected-app config file (default: update.json) */
  config?: string;
}

export interface PublishOptions {
  filePath?: string;
  /** path of the final source map to archive with the version */
  sourcemap?: string;
  platform?: Platform;
  name?: string;
  description?: string;
  metaInfo?: string;
  packageId?: string;
  packageVersion?: string;
  minPackageVersion?: string;
  maxPackageVersion?: string;
  packageVersionRange?: string;
  rollout?: number | string;
  dryRun?: boolean;
  appId?: string;
  config?: string;
}

export interface UploadOptions {
  platform?: Platform;
  filePath: string;
  appId?: string;
  appKey?: string;
  version?: string;
  config?: string;
}

export interface UpdateVersionOptions {
  platform?: Platform;
  packageId?: string;
  packageVersion?: string;
  minPackageVersion?: string;
  maxPackageVersion?: string;
  packageVersionRange?: string;
  rollout?: number | string;
  dryRun?: boolean;
}

export interface SymbolicateOptions {
  /** stack trace file ('-' for stdin) */
  stackFile?: string;
  /** update hash of the running version (from getUpdateMetadata().currentVersion) */
  hash?: string;
  versionId?: string;
  platform?: Platform;
  appId?: string;
  config?: string;
  /** write the symbolicated stack here instead of stdout */
  output?: string;
}

export interface CLIProvider {
  bundle: (options: BundleOptions) => Promise<CommandResult>;
  publish: (options: PublishOptions) => Promise<CommandResult>;
  symbolicate: (options: SymbolicateOptions) => Promise<CommandResult>;
  upload: (options: UploadOptions) => Promise<CommandResult>;

  createApp: (name: string, platform: Platform) => Promise<CommandResult>;
  listApps: (platform?: Platform) => Promise<CommandResult>;
  getSelectedApp: (
    platform?: Platform,
    config?: string,
  ) => Promise<{ appId: string; platform: Platform }>;

  listVersions: (appId: string) => Promise<CommandResult>;
  updateVersion: (
    appId: string,
    versionId: string,
    updates: UpdateVersionOptions,
  ) => Promise<CommandResult>;
  listPackages: (appId: string) => Promise<CommandResult>;

  getPlatform: (platform?: Platform) => Promise<Platform>;
  loadSession: () => Promise<Session>;
}
