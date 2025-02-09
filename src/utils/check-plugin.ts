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
        console.log(`检测到 ${plugin.name} 插件,应用相应打包配置`);
      }
    } catch (err) {
      console.warn(`检测 ${plugin.name} 插件时出错:`, err);
    }
  }

  return params;
}
