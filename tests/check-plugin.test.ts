import { describe, expect, mock, spyOn, test, beforeEach, afterEach } from 'bun:test';

// Mock dependencies before imports
mock.module('fs-extra', () => ({
  default: {
    access: async () => {},
  },
}));

mock.module('i18next', () => ({
  default: {
    init: () => {},
    t: (key: string) => key,
  },
}));

import { checkPlugins } from '../src/utils/check-plugin';
import * as pluginConfig from '../src/utils/plugin-config';

describe('checkPlugins', () => {
  test('should detect plugins concurrently (simulated)', async () => {
    const mockPlugins = [
      {
        name: 'plugin1',
        bundleParams: { p1: true },
        detect: async () => {
          await new Promise(resolve => setTimeout(resolve, 100));
          return true;
        }
      },
      {
        name: 'plugin2',
        bundleParams: { p2: true },
        detect: async () => {
          await new Promise(resolve => setTimeout(resolve, 100));
          return true;
        }
      },
      {
        name: 'plugin3',
        bundleParams: { p3: true },
        detect: async () => {
          await new Promise(resolve => setTimeout(resolve, 100));
          return true;
        }
      }
    ];

    // Replacing the plugins array in plugin-config
    const originalPlugins = [...pluginConfig.plugins];
    (pluginConfig.plugins as any).splice(0, pluginConfig.plugins.length, ...mockPlugins);

    const start = Date.now();
    const result = await checkPlugins();
    const end = Date.now();
    const duration = end - start;

    console.log(`Duration with optimized implementation: ${duration}ms`);

    expect(result).toEqual({
      sentry: false, // default
      sourcemap: false, // default
      p1: true,
      p2: true,
      p3: true
    } as any);

    // Now it's concurrent, so we expect around 100ms.
    // We'll allow some buffer, but it should definitely be less than 250ms.
    expect(duration).toBeLessThan(250);

    // Restore original plugins
    (pluginConfig.plugins as any).splice(0, pluginConfig.plugins.length, ...originalPlugins);
  });
});
