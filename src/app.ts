import fs from 'fs';
import Table from 'tty-table';
import { question } from './utils';

import { doDelete, get, post } from './api';
import type { Platform } from './types';
import { t } from './utils/i18n';

interface AppSummary {
  id: number;
  name: string;
  platform: Platform;
}

const validPlatforms = ['ios', 'android', 'harmony'] as const;

export async function getPlatform(platform?: string) {
  return assertPlatform(
    platform || (await question(t('platformQuestion'))),
  ) as Platform;
}

export function assertPlatform(platform: string): Platform {
  if (!validPlatforms.includes(platform as Platform)) {
    throw new Error(t('unsupportedPlatform', { platform }));
  }
  return platform as Platform;
}

export async function getSelectedApp(
  platform: Platform,
): Promise<{ appId: string; appKey: string; platform: Platform }> {
  assertPlatform(platform);

  let updateInfo: Partial<Record<Platform, { appId: number; appKey: string }>> =
    {};
  try {
    updateInfo = JSON.parse(await fs.promises.readFile('update.json', 'utf8'));
  } catch (e: any) {
    if (e.code === 'ENOENT') {
      throw new Error(t('appNotSelected', { platform }));
    }
    throw e;
  }
  const info = updateInfo[platform];
  if (!info) {
    throw new Error(t('appNotSelected', { platform }));
  }
  return {
    appId: String(info.appId),
    appKey: info.appKey,
    platform,
  };
}

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

  console.log(Table(header, rows).render());

  console.log(`\n${t('totalApps', { count: list.length, platform })}`);
  return list;
}

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

export const appCommands = {
  createApp: async function ({
    options,
  }: {
    options: { name: string; downloadUrl: string; platform?: Platform | '' };
  }) {
    const name = options.name || (await question(t('appNameQuestion')));
    const { downloadUrl } = options;
    const platform = await getPlatform(options.platform);
    const { id } = await post('/app/create', { name, platform, downloadUrl });
    console.log(t('createAppSuccess', { id }));
    await this.selectApp({
      args: [id],
      options: { platform },
    });
  },
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
    }
    await doDelete(`/app/${id}`);
    console.log(t('operationSuccess'));
  },
  apps: async ({ options }: { options: { platform?: Platform | '' } }) => {
    const { platform = '' } = options;
    await listApp(platform);
  },
  selectApp: async ({
    args,
    options,
  }: {
    args: string[];
    options: { platform?: Platform | '' };
  }) => {
    const platform = await getPlatform(options.platform);
    const id = args[0]
      ? Number.parseInt(args[0])
      : (await chooseApp(platform)).id;

    let updateInfo: Partial<
      Record<Platform, { appId: number; appKey: string }>
    > = {};
    try {
      updateInfo = JSON.parse(
        await fs.promises.readFile('update.json', 'utf8'),
      );
    } catch (e: any) {
      if (e.code !== 'ENOENT') {
        console.error(t('failedToParseUpdateJson'));
        throw e;
      }
    }
    const { appKey } = await get(`/app/${id}`);
    updateInfo[platform] = {
      appId: id,
      appKey,
    };
    await fs.promises.writeFile(
      'update.json',
      JSON.stringify(updateInfo, null, 4),
      'utf8',
    );
  },
};
