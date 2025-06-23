import { question } from './utils';
import fs from 'fs';
import Table from 'tty-table';

import { post, get, doDelete } from './api';
import type { Platform } from './types';
import { t } from './utils/i18n';

const validPlatforms = ['ios', 'android', 'harmony'];

export async function getPlatform(platform?: string) {
  return assertPlatform(
    platform || (await question(t('platformQuestion'))),
  ) as Platform;
}

export function assertPlatform(platform: string) {
  if (!validPlatforms.includes(platform)) {
    throw new Error(t('unsupportedPlatform', { platform }));
  }
  return platform;
}

export function getSelectedApp(platform: Platform) {
  assertPlatform(platform);

  if (!fs.existsSync('update.json')) {
    throw new Error(t('appNotSelected', { platform }));
  }
  const updateInfo = JSON.parse(fs.readFileSync('update.json', 'utf8'));
  if (!updateInfo[platform]) {
    throw new Error(t('appNotSelected', { platform }));
  }
  return updateInfo[platform];
}

export async function listApp(platform: Platform | '' = '') {
  const { data } = await get('/app/list');
  const list = platform ? data.filter((v) => v.platform === platform) : data;

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
    const app = list.find((v) => v.id === Number(id));
    if (app) {
      return app;
    }
  }
}

export const appCommands = {
  createApp: async function ({
    options,
  }: {
    options: { name: string; downloadUrl: string; platform: Platform };
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
    const id = args[0] || chooseApp(platform);
    if (!id) {
      console.log(t('cancelled'));
    }
    await doDelete(`/app/${id}`);
    console.log(t('operationSuccess'));
  },
  apps: async ({ options }: { options: { platform: Platform } }) => {
    const { platform } = options;
    listApp(platform);
  },
  selectApp: async ({
    args,
    options,
  }: {
    args: string[];
    options: { platform: Platform };
  }) => {
    const platform = await getPlatform(options.platform);
    const id = args[0]
      ? Number.parseInt(args[0])
      : (await chooseApp(platform)).id;

    let updateInfo: Partial<
      Record<Platform, { appId: number; appKey: string }>
    > = {};
    if (fs.existsSync('update.json')) {
      try {
        updateInfo = JSON.parse(fs.readFileSync('update.json', 'utf8'));
      } catch (e) {
        console.error(t('failedToParseUpdateJson'));
        throw e;
      }
    }
    const { appKey } = await get(`/app/${id}`);
    updateInfo[platform] = {
      appId: id,
      appKey,
    };
    fs.writeFileSync(
      'update.json',
      JSON.stringify(updateInfo, null, 4),
      'utf8',
    );
  },
};
