import { question } from './utils';
import { post, get, replaceSession, saveSession, closeSession } from './api';
import crypto from 'crypto';

function md5(str) {
  return crypto.createHash('md5').update(str).digest('hex');
}

export const commands = {
  login: async function ({ args }) {
    const email = args[0] || (await question('email:'));
    const pwd = args[1] || (await question('password:', true));
    const { token, info } = await post('/user/login', {
      email,
      pwd: md5(pwd),
    });
    replaceSession({ token });
    await saveSession();
    console.log(`欢迎使用 pushy 热更新服务， ${info.name}.`);
  },
  logout: async function () {
    await closeSession();
    console.log('已退出登录');
  },
  me: async function () {
    const me = await get('/user/me');
    for (const k in me) {
      if (k !== 'ok') {
        console.log(`${k}: ${me[k]}`);
      }
    }
  },
};
