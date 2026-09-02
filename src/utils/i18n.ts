import i18next from 'i18next';
import en from '../locales/en';
import zh from '../locales/zh';
import { IS_CRESC } from './constants';

/**
 * UI language: `RNU_LANG=en|zh` (a locale such as `zh_CN` counts by its
 * prefix) overrides the brand default, Chinese for pushy and English for cresc.
 */
export function resolveLanguage(
  env: NodeJS.ProcessEnv = process.env,
  isCresc = IS_CRESC,
): 'en' | 'zh' {
  const override = env.RNU_LANG?.trim().toLowerCase();
  if (override?.startsWith('zh')) return 'zh';
  if (override?.startsWith('en')) return 'en';
  return isCresc ? 'en' : 'zh';
}

i18next.init({
  lng: resolveLanguage(),
  // debug: process.env.NODE_ENV !== 'production',
  // debug: true,
  resources: {
    en: {
      translation: en,
    },
    zh: {
      translation: zh,
    },
  },
  interpolation: {
    escapeValue: false,
  },
});

declare module 'i18next' {
  // Extend CustomTypeOptions
  interface CustomTypeOptions {
    // custom namespace type, if you changed it
    defaultNS: 'en';
    // custom resources type
    resources: {
      en: typeof en;
      zh: typeof zh;
    };
    // other
  }
}

export function t(key: string, options?: any): string {
  return i18next.t(key as any, options);
}
