import { cacheStats, cleanCache } from './utils/hermes-base';
import { t } from './utils/i18n';

export const cacheCommands = {
  cache: async ({ args }: { args?: string[] }) => {
    if (args?.[0] === 'clean') {
      const removed = await cleanCache();
      console.log(t('cacheCleaned', { count: removed }));
      return;
    }
    const stats = await cacheStats();
    console.log(
      t('cacheStats', {
        dir: stats.dir,
        files: stats.files,
        mb: (stats.bytes / 1024 / 1024).toFixed(1),
      }),
    );
  },
};
