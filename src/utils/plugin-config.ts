import fs from 'fs';

interface PluginConfig {
  name: string;
  bundleParams?: {
    [key: string]: any;
  };
  detect: () => Promise<boolean>;
}

export const plugins: PluginConfig[] = [
  {
    name: 'sentry',
    bundleParams: {
      sentry: true,
      sourcemap: true,
    },
    detect: async () => {
      try {
        await fs.promises.access('ios/sentry.properties');
        return true;
      } catch {
        try {
          await fs.promises.access('android/sentry.properties');
          return true;
        } catch {
          return false;
        }
      }
    },
  },
];
