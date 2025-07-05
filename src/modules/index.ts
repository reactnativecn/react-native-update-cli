import { bundleModule } from './bundle-module';
import { versionModule } from './version-module';
import { appModule } from './app-module';
import { userModule } from './user-module';

export { bundleModule } from './bundle-module';
export { versionModule } from './version-module';
export { appModule } from './app-module';
export { userModule } from './user-module';

// 导出所有内置模块的数组，方便批量注册
export const builtinModules = [
  bundleModule,
  versionModule,
  appModule,
  userModule
]; 