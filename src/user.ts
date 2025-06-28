import { question } from './utils';
import { post, get, replaceSession, saveSession, closeSession } from './api';
import crypto from 'crypto';
import { t } from './utils/i18n';

function md5(str: string) {
  return crypto.createHash('md5').update(str).digest('hex');
}

export const userCommands = {
  login: async ({ args }: { args: string[] }) => {
    const email = args[0] || (await question('email:'));
    const pwd = args[1] || (await question('password:', true));
    const { token, info } = await post('/user/login', {
      email,
      pwd: md5(pwd),
    });
    replaceSession({ token });
    await saveSession();
    console.log(t('welcomeMessage', { name: info.name }));
  },
  logout: async () => {
    await closeSession();
    console.log(t('loggedOut'));
  },
  me: async () => {
    const me = await get('/user/me');
    for (const k in me) {
      if (k !== 'ok') {
        console.log(`${k}: ${me[k]}`);
      }
    }
  },
};
