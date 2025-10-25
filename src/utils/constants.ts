import path from 'path';

export const scriptName = path.basename(process.argv[1]) as 'cresc' | 'pushy';
export const IS_CRESC = scriptName === 'cresc';

export const ppkBundleFileNames = ['index.bundlejs', 'bundle.harmony.js'];
export const isPPKBundleFileName = (fileName: string) =>
  ppkBundleFileNames.includes(fileName);

export const credentialFile = IS_CRESC ? '.cresc.token' : '.update';
export const updateJson = IS_CRESC ? 'cresc.config.json' : 'update.json';
export const tempDir = IS_CRESC ? '.cresc.temp' : '.pushy';
export const pricingPageUrl = IS_CRESC
  ? 'https://cresc.dev/pricing'
  : 'https://pushy.reactnative.cn/pricing.html';

export const defaultEndpoints = IS_CRESC
  ? ['https://api.cresc.dev', 'https://api.cresc.app']
  : ['https://update.reactnative.cn/api', 'https://update.react-native.cn/api'];
