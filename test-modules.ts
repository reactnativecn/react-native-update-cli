#!/usr/bin/env bun

import { appModule } from './src/modules/app-module';
import { bundleModule } from './src/modules/bundle-module';
import { packageModule } from './src/modules/package-module';
import { userModule } from './src/modules/user-module';
import { versionModule } from './src/modules/version-module';
import type { CLIModule } from './src/types';

function printModuleInfo(title: string, module: CLIModule): void {
  const commandCount = module.commands?.length ?? 0;

  console.log(`=== ${title} ===`);
  console.log(`Commands: ${commandCount}`);
  console.log('');
}

function main(): void {
  console.log('Testing modules...\n');

  const modules: Array<{ title: string; module: CLIModule }> = [
    { title: 'App Module', module: appModule },
    { title: 'Bundle Module', module: bundleModule },
    { title: 'Package Module', module: packageModule },
    { title: 'Version Module', module: versionModule },
    { title: 'User Module', module: userModule },
  ];

  for (const item of modules) {
    printModuleInfo(item.title, item.module);
  }

  console.log('All modules loaded successfully.');
  console.log('\nSummary:');
  console.log(`  Modules: ${modules.length}/${modules.length}`);
}

try {
  main();
} catch (error: unknown) {
  if (error instanceof Error) {
    console.error('Error testing modules:', error.message);
  } else {
    console.error('Error testing modules:', error);
  }
  process.exit(1);
}
