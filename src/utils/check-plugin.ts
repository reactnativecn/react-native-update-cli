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

  for (const plugin of plugins) {
    try {
      const isEnabled = await plugin.detect();
      if (isEnabled && plugin.bundleParams) {
        Object.assign(params, plugin.bundleParams);
        console.log(`detected ${plugin.name} plugin`);
      }
    } catch (err) {
      console.warn(`error while detecting ${plugin.name} plugin:`, err);
    }
  }

  return params;
}
