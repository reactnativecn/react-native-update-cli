import { t } from './i18n';
import { plugins } from './plugin-config';

interface BundleParams {
  sentry: boolean;
  sourcemap: boolean;
  [key: string]: any;
}

export async function checkPlugins(): Promise<BundleParams> {
  const params: BundleParams = {
    sentry: false,
    sourcemap: false,
  };

  const results = await Promise.all(
    plugins.map(async (plugin) => {
      try {
        const isEnabled = await plugin.detect();
        return { isEnabled, error: null };
      } catch (error) {
        return { isEnabled: false, error };
      }
    }),
  );

  results.forEach(({ isEnabled, error }, index) => {
    const plugin = plugins[index];
    if (error) {
      console.warn(t('pluginDetectionError', { name: plugin.name, error }));
    } else if (isEnabled && plugin.bundleParams) {
      Object.assign(params, plugin.bundleParams);
      console.log(t('pluginDetected', { name: plugin.name }));
    }
  });

  return params;
}
