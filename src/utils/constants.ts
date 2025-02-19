import path from 'node:path';

const scriptName: 'cresc' | 'pushy' = path.basename(process.argv[1]) as
  | 'cresc'
  | 'pushy';
export const IS_CRESC = scriptName === 'cresc';

export const credentialFile = IS_CRESC ? '.cresc.token' : '.update';
export const updateJson = IS_CRESC ? 'cresc.config.json' : 'update.json';
export const tempDir = IS_CRESC ? '.cresc.temp' : '.pushy';
export const pricingPageUrl = IS_CRESC
  ? 'https://cresc.dev/pricing'
  : 'https://pushy.reactnative.cn/pricing.html';
