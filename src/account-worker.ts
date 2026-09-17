import fs from 'fs';
import path from 'path';
import { get, replaceSession, setApiToken } from './api';

// Isolated from the command: even DNS, endpoint probing and slow sockets cannot
// keep the CLI alive. Bound the detached worker's lifetime as well.
if (require.main === module) {
  const deadline = setTimeout(() => process.exit(0), 15000);
  process.once(
    'message',
    async (input: { token: string; apiToken?: string; cacheFile: string }) => {
      try {
        replaceSession({ token: input.token });
        if (input.apiToken) setApiToken(input.apiToken);
        const result = await get('/user/me');
        const account = {
          name: result.name,
          email: result.email,
          tier: result.tier,
          tierExpiresAt: result.tierExpiresAt,
          serverTime: result.serverTime,
        };
        const entry = { account, fetchedAt: Date.now() };
        fs.mkdirSync(path.dirname(input.cacheFile), {
          recursive: true,
          mode: 0o700,
        });
        const temporary = `${input.cacheFile}.${process.pid}.tmp`;
        fs.writeFileSync(temporary, JSON.stringify(entry), { mode: 0o600 });
        fs.renameSync(temporary, input.cacheFile);
        if (process.connected) {
          process.send?.(entry, () => process.exit(0));
          return;
        }
      } catch {
        // Background refresh is best effort; retain the last successful cache.
      }
      clearTimeout(deadline);
      process.exit(0);
    },
  );
}
