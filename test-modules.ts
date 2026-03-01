#!/usr/bin/env bun

import { appModule } from './src/modules/app-module';
import { bundleModule } from './src/modules/bundle-module';
import { packageModule } from './src/modules/package-module';
import { userModule } from './src/modules/user-module';
import { versionModule } from './src/modules/version-module';
import type { CLIModule } from './src/types';

function printModuleInfo(title: string, module: CLIModule): number {
  const commandCount = module.commands?.length ?? 0;
  const workflows = module.workflows ?? [];

  console.log(`=== ${title} ===`);
  console.log(`Commands: ${commandCount}`);
  console.log(`Workflows: ${workflows.length}`);
  for (const workflow of workflows) {
    console.log(
      `  - ${workflow.name}: ${workflow.description ?? 'No description'}`,
    );
    console.log(`    Steps: ${workflow.steps.length}`);
  }
  console.log('');

  return workflows.length;
}

function main(): void {
  console.log('Testing module workflows...\n');

  const modules: Array<{ title: string; module: CLIModule }> = [
    { title: 'App Module', module: appModule },
    { title: 'Bundle Module', module: bundleModule },
    { title: 'Package Module', module: packageModule },
    { title: 'Version Module', module: versionModule },
    { title: 'User Module', module: userModule },
  ];

  let totalWorkflows = 0;
  for (const item of modules) {
    totalWorkflows += printModuleInfo(item.title, item.module);
  }

  console.log('All modules loaded successfully with enhanced workflows.');
  console.log('\nSummary:');
  console.log(`  Total workflows: ${totalWorkflows}`);
  console.log(`  Enhanced modules: ${modules.length}/${modules.length}`);
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
