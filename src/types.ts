declare global {
  var NO_INTERACTIVE: boolean;
  var USE_ACC_OSS: boolean;
}

export interface Session {
  token: string;
}

export type Platform = 'ios' | 'android' | 'harmony';

export interface Package {
  id: string;
  name: string;
}

export interface Version {
  id: string;
  hash: string;
  name: string;
  packages?: Package[];
}
