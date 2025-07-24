import { appModule } from './app-module';
import { bundleModule } from './bundle-module';
import { packageModule } from './package-module';
import { userModule } from './user-module';
import { versionModule } from './version-module';

export { bundleModule } from './bundle-module';
export { versionModule } from './version-module';
export { appModule } from './app-module';
export { userModule } from './user-module';
export { packageModule } from './package-module';

export const builtinModules = [
  bundleModule,
  versionModule,
  appModule,
  userModule,
  packageModule,
];
