declare global {
  var NO_INTERACTIVE: boolean;
  var USE_ACC_OSS: boolean;
  var IS_CRESC: boolean;
}

export interface Session {
  token: string;
}

export type Platform = 'ios' | 'android' | 'harmony';
