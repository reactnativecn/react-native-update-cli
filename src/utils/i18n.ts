import i18next from 'i18next';
import en from '../locales/en';
import zh from '../locales/zh';
import { IS_CRESC } from './constants';

i18next.init({
  lng: IS_CRESC ? 'en' : 'zh',
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

export const t = i18next.t;
