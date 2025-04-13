import { plugins } from './plugin-config';
import { t } from './i18n';

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

  for (const plugin of plugins) {
    try {
      const isEnabled = await plugin.detect();
      if (isEnabled && plugin.bundleParams) {
        Object.assign(params, plugin.bundleParams);
        console.log(t('pluginDetected', { name: plugin.name }));
      }
    } catch (err) {
      console.warn(t('pluginDetectionError', { name: plugin.name, error: err }));
    }
  }

  return params;
}
