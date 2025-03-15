import { question } from './utils';
import fs from 'node:fs';
import Table from 'tty-table';

import { post, get, doDelete } from './api';
import type { Platform } from './types';

const validPlatforms = {
  ios: 1,
  android: 1,
  harmony: 1,
};

export function checkPlatform(platform: Platform) {
  if (!validPlatforms[platform]) {
    throw new Error(`无法识别的平台 '${platform}'`);
  }
  return platform;
}

export function getSelectedApp(platform: Platform) {
  checkPlatform(platform);

  if (!fs.existsSync('update.json')) {
    throw new Error(
      `App not selected. run 'pushy selectApp --platform ${platform}' first!`,
    );
  }
  const updateInfo = JSON.parse(fs.readFileSync('update.json', 'utf8'));
  if (!updateInfo[platform]) {
    throw new Error(
      `App not selected. run 'pushy selectApp --platform ${platform}' first!`,
    );
  }
  return updateInfo[platform];
}

export async function listApp(platform: Platform) {
  const { data } = await get('/app/list');
  const list = platform ? data.filter((v) => v.platform === platform) : data;

  const header = [
    { value: '应用 id' },
    { value: '应用名称' },
    { value: '平台' },
  ];
  const rows = [];
  for (const app of list) {
    rows.push([app.id, app.name, app.platform]);
  }

  console.log(Table(header, rows).render());

  if (platform) {
    console.log(`\共 ${list.length} ${platform} 个应用`);
  } else {
    console.log(`\共 ${list.length} 个应用`);
  }
  return list;
}

export async function chooseApp(platform: Platform) {
  const list = await listApp(platform);

  while (true) {
    const id = await question('输入应用 id:');
    const app = list.find((v) => v.id === Number(id));
    if (app) {
      return app;
    }
  }
}

export const commands = {
  createApp: async function ({
    options,
  }: {
    options: { name: string; downloadUrl: string; platform: Platform };
  }) {
    const name = options.name || (await question('应用名称:'));
    const { downloadUrl } = options;
    const platform = checkPlatform(
      options.platform || (await question('平台(ios/android/harmony):')),
    );
    const { id } = await post('/app/create', { name, platform, downloadUrl });
    console.log(`已成功创建应用（id: ${id}）`);
    await this.selectApp({
      args: [id],
      options: { platform },
    });
  },
  deleteApp: async ({ args, options }: { args: string[]; options: { platform: Platform } }) => {
    const { platform } = options;
    const id = args[0] || chooseApp(platform);
    if (!id) {
      console.log('已取消');
    }
    await doDelete(`/app/${id}`);
    console.log('操作成功');
  },
  apps: async ({ options }: { options: { platform: Platform } }) => {
    const { platform } = options;
    listApp(platform);
  },
  selectApp: async ({ args, options }: { args: string[]; options: { platform: Platform } }) => {
    const platform = checkPlatform(
      options.platform || (await question('平台(ios/android/harmony):')),
    );
    const id = args[0]
      ? Number.parseInt(args[0])
      : (await chooseApp(platform)).id;

    let updateInfo: Partial<Record<Platform, { appId: number; appKey: string }>> = {};
    if (fs.existsSync('update.json')) {
      try {
        updateInfo = JSON.parse(fs.readFileSync('update.json', 'utf8'));
      } catch (e) {
        console.error(
          'Failed to parse file `update.json`. Try to remove it manually.',
        );
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
