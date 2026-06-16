declare global {
  var NO_INTERACTIVE: boolean | undefined;
  var USE_ACC_OSS: boolean | undefined;
}

export interface Session {
  token: string;
}

export type Platform = 'ios' | 'android' | 'harmony';

export interface Package {
  id: string;
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
  id: string;
  hash: string;
  name: string;
  packages?: Package[];
  deps?: Record<string, string> | string | null;
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
  sentryRelease?: string;
  sentryDist?: string;
}

export interface PublishOptions {
  filePath?: string;
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
}

export interface UploadOptions {
  platform?: Platform;
  filePath: string;
  appId?: string;
  appKey?: string;
  version?: string;
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

export interface CLIProvider {
  bundle: (options: BundleOptions) => Promise<CommandResult>;
  publish: (options: PublishOptions) => Promise<CommandResult>;
  upload: (options: UploadOptions) => Promise<CommandResult>;

  createApp: (name: string, platform: Platform) => Promise<CommandResult>;
  listApps: (platform?: Platform) => Promise<CommandResult>;
  getSelectedApp: (
    platform?: Platform,
  ) => Promise<{ appId: string; platform: Platform }>;

  listVersions: (appId: string) => Promise<CommandResult>;
  updateVersion: (
    appId: string,
    versionId: string,
    updates: UpdateVersionOptions,
  ) => Promise<CommandResult>;

  getPlatform: (platform?: Platform) => Promise<Platform>;
  loadSession: () => Promise<Session>;
}
