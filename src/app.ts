import fs from 'fs';
import { doDelete, get, post } from './api';
import type { Platform } from './types';
import { loadTtyTable, question } from './utils';
import { updateJson } from './utils/constants';
import { t } from './utils/i18n';

interface AppSummary {
  id: number;
  name: string;
  platform: Platform;
}

export interface AppTargetOptions {
  appId?: string;
  config?: string;
  platform?: Platform | '';
}

/** The selected-app config file was missing or has no entry for the platform. */
export class AppNotSelectedError extends Error {
  readonly code = 'APP_NOT_SELECTED';
  constructor(platform: Platform) {
    super(t('appNotSelected', { platform }));
    this.name = 'AppNotSelectedError';
  }
}

/** Resolve an explicit platform or prompt for one interactively. */
export async function getPlatform(platform?: string) {
  return assertPlatform(
    platform || (await question(t('platformQuestion'))),
  ) as Platform;
}

/** Validate that a string names a platform supported by the update service. */
export function assertPlatform(platform: string): Platform {
  if (platform !== 'ios' && platform !== 'android' && platform !== 'harmony') {
    throw new Error(t('unsupportedPlatform', { platform }));
  }
  return platform as Platform;
}

/** Read the selected app for a platform from the requested config file. */
export async function getSelectedApp(
  platform: Platform,
  configPath?: string,
): Promise<{ appId: string; appKey: string; platform: Platform }> {
  assertPlatform(platform);

  const resolvedConfigPath = configPath || updateJson;
  let raw: string;
  try {
    raw = await fs.promises.readFile(resolvedConfigPath, 'utf8');
  } catch (e: any) {
    if (e.code === 'ENOENT') {
      throw new AppNotSelectedError(platform);
    }
    throw e;
  }
  let updateInfo: Partial<Record<Platform, { appId: number; appKey: string }>>;
  try {
    updateInfo = JSON.parse(raw);
  } catch {
    throw new Error(
      t('failedToParseUpdateJson', { configPath: resolvedConfigPath }),
    );
  }
  const info = updateInfo[platform];
  if (!info) {
    throw new AppNotSelectedError(platform);
  }
  return {
    appId: String(info.appId),
    appKey: info.appKey,
    platform,
  };
}

/**
 * Fail fast when an explicit `--appId` names an app of another platform.
 * The server accepts a bundle for any app the account owns and never sees
 * the platform it was built for, so this is the only place the mistake can
 * be caught before it reaches devices. A missing or foreign app fails here
 * too (403/404) instead of after the expensive work.
 */
async function assertAppPlatform(appId: string, platform: Platform) {
  const app = (await get(`/app/${appId}`)) as { platform?: Platform };
  if (app.platform && app.platform !== platform) {
    throw new Error(
      t('appPlatformMismatch', { appId, appPlatform: app.platform, platform }),
    );
  }
}

/**
 * Resolve the app an operation targets: an explicit `--appId` wins, otherwise
 * the app selected for the platform in `--config` (default: update.json).
 * Prompts for the platform only when it is needed and not given.
 */
export async function resolveAppId(
  options: AppTargetOptions = {},
): Promise<string> {
  if (options.platform) {
    assertPlatform(options.platform);
  }
  if (options.appId) {
    const appId = String(options.appId);
    if (options.platform) {
      await assertAppPlatform(appId, options.platform);
    }
    return appId;
  }
  const platform = await getPlatform(options.platform || undefined);
  return (await getSelectedApp(platform, options.config)).appId;
}

/** List apps, optionally filtering them to one platform. */
export async function listApp(platform: Platform | '' = '') {
  const { data } = await get('/app/list');
  const allApps = data as AppSummary[];
  const list = platform
    ? allApps.filter((app: AppSummary) => app.platform === platform)
    : allApps;

  const header = [
    { value: t('appId') },
    { value: t('appName') },
    { value: t('platform') },
  ];
  const rows = [];
  for (const app of list) {
    rows.push([app.id, app.name, app.platform]);
  }

  // tty-table is ~25 ms to load; only pay for it when a table is rendered
  const Table = loadTtyTable();
  console.log(Table(header, rows).render());

  console.log(`\n${t('totalApps', { count: list.length, platform })}`);
  return list;
}

/** Prompt until the user chooses an app belonging to the target platform. */
export async function chooseApp(platform: Platform) {
  const list = await listApp(platform);

  while (true) {
    const id = await question(t('enterAppIdQuestion'));
    const app = list.find((item: AppSummary) => item.id === Number(id));
    if (app) {
      return app;
    }
  }
}

/** Persist an app selection in the requested brand-aware config file. */
async function selectApp({
  args,
  options,
}: {
  args: string[];
  options: { platform?: Platform | ''; config?: string };
}) {
  const platform = await getPlatform(options.platform);
  const id = args[0]
    ? Number.parseInt(args[0], 10)
    : (await chooseApp(platform)).id;

  const configPath = options.config || updateJson;
  let updateInfo: Partial<Record<Platform, { appId: number; appKey: string }>> =
    {};
  try {
    updateInfo = JSON.parse(await fs.promises.readFile(configPath, 'utf8'));
  } catch (e: any) {
    if (e.code !== 'ENOENT') {
      console.error(t('failedToParseUpdateJson', { configPath }));
      throw e;
    }
  }
  const { appKey } = await get(`/app/${id}`);
  updateInfo[platform] = {
    appId: id,
    appKey,
  };
  await fs.promises.writeFile(
    configPath,
    JSON.stringify(updateInfo, null, 4),
    'utf8',
  );
}

/** Build the application-management command handlers used by the CLI. */
export function getAppCommands() {
  return {
    /** Create an app and select it in the same configuration file. */
    createApp: async ({
      options,
    }: {
      options: {
        name: string;
        downloadUrl: string;
        platform?: Platform | '';
        config?: string;
      };
    }) => {
      const name = options.name || (await question(t('appNameQuestion')));
      const { downloadUrl } = options;
      const platform = await getPlatform(options.platform);
      const { id } = await post('/app/create', { name, platform, downloadUrl });
      console.log(t('createAppSuccess', { id }));
      await selectApp({
        args: [String(id)],
        options: { platform, config: options.config },
      });
    },
    /** Delete the specified app, or prompt for one when no ID is supplied. */
    deleteApp: async ({
      args,
      options,
    }: {
      args: string[];
      options: { platform: Platform };
    }) => {
      const { platform } = options;
      const id = args[0] || (await chooseApp(platform)).id;
      if (!id) {
        console.log(t('cancelled'));
        return;
      }
      await doDelete(`/app/${id}`);
      console.log(t('operationSuccess'));
    },
    /** List apps through the command interface. */
    apps: async ({ options }: { options: { platform?: Platform | '' } }) => {
      const { platform = '' } = options;
      return listApp(platform);
    },
    selectApp,
  };
}
