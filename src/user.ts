import crypto from 'crypto';
import { closeSession, get, post, replaceSession, saveSession } from './api';
import type { CommandContext } from './types';
import { question } from './utils';
import { addGitIgnore } from './utils/add-gitignore';
import { scriptName } from './utils/constants';
import { t } from './utils/i18n';

function md5(str: string) {
  return crypto.createHash('md5').update(str).digest('hex');
}

export const userCommands = {
  login: async ({ args }: { args: string[] }) => {
    const email = args[0] || (await question('email:'));
    const pwd = args[1] || (await question('password:', true));
    if (!email || !pwd) {
      // without a terminal `question` answers '': fail here instead of
      // sending empty credentials to the server
      throw new Error(t('loginCredentialsRequired', { scriptName }));
    }
    const { token, info } = await post('/user/login', {
      email,
      pwd: md5(pwd),
    });
    replaceSession({ token });
    await saveSession();
    // make sure the token file is ignored before the user's next commit,
    // not only when they first run `bundle`
    addGitIgnore();
    console.log(t('welcomeMessage', { name: info.name }));
  },
  logout: async (_context: CommandContext) => {
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
