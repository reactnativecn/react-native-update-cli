import { describe, expect, it } from 'bun:test';

const loadConstantsWithArgv = async (argv1: string) => {
  const originalArgv = process.argv;
  process.argv = ['node', argv1];
  try {
    const url = `../src/utils/constants.ts?t=${Date.now()}_${Math.random()}`;
    const mod = await import(url);
    return mod;
  } finally {
    process.argv = originalArgv;
  }
};

describe('constants', () => {
  it('should initialize correctly when script is cresc', async () => {
    const mod = await loadConstantsWithArgv('/usr/local/bin/cresc');
    expect(mod.scriptName).toBe('cresc');
    expect(mod.IS_CRESC).toBe(true);
    expect(mod.credentialFile).toBe('.cresc.token');
    expect(mod.updateJson).toBe('cresc.config.json');
    expect(mod.tempDir).toBe('.cresc.temp');
    expect(mod.pricingPageUrl).toBe('https://cresc.dev/pricing');
    expect(mod.defaultEndpoints).toEqual([
      'https://api.cresc.dev',
      'https://api.cresc.app',
    ]);
  });

  it('should initialize correctly when script is pushy', async () => {
    const mod = await loadConstantsWithArgv('/usr/local/bin/pushy');
    expect(mod.scriptName).toBe('pushy');
    expect(mod.IS_CRESC).toBe(false);
    expect(mod.credentialFile).toBe('.update');
    expect(mod.updateJson).toBe('update.json');
    expect(mod.tempDir).toBe('.pushy');
    expect(mod.pricingPageUrl).toBe(
      'https://pushy.reactnative.cn/pricing.html',
    );
    expect(mod.defaultEndpoints).toEqual([
      'https://update.reactnative.cn/api',
      'https://update.react-native.cn/api',
    ]);
  });

  it('should identify PPK bundle file names correctly', async () => {
    const { isPPKBundleFileName } = await import('../src/utils/constants.ts');
    expect(isPPKBundleFileName('index.bundlejs')).toBe(true);
    expect(isPPKBundleFileName('bundle.harmony.js')).toBe(true);
    expect(isPPKBundleFileName('index.js')).toBe(false);
    expect(isPPKBundleFileName('main.bundlejs')).toBe(false);
  });
});
