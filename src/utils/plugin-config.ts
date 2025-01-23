import fs from 'fs-extra';

interface PluginConfig {
  name: string;
  bundleParams?: {
    minify?: boolean;
    [key: string]: any;
  };
  detect: () => Promise<boolean>;
}

export const plugins: PluginConfig[] = [
  {
    name: 'sentry',
    bundleParams: {
      sentry: true,
      minify: false,
      sourcemap: true,
    },
    detect: async () => {
      try {
        await fs.access('ios/sentry.properties');
        return true;
      } catch {
        try {
          await fs.access('android/sentry.properties');
          return true;
        } catch {
          return false;
        }
      }
    }
  }
];