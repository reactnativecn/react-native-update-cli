#!/usr/bin/env node

// Simple test script to verify module loading and workflows
console.log('🔍 Testing module workflows...\n');

try {
  // Test app module
  console.log('=== App Module ===');
  const { appModule } = require('./lib/modules/app-module');
  console.log(`✅ Commands: ${appModule.commands.length}`);
  console.log(`✅ Workflows: ${appModule.workflows.length}`);
  appModule.workflows.forEach((w) => {
    console.log(`   - ${w.name}: ${w.description}`);
    console.log(`     Steps: ${w.steps.length}`);
  });
  console.log();

  // Test bundle module
  console.log('=== Bundle Module ===');
  const { bundleModule } = require('./lib/modules/bundle-module');
  console.log(`✅ Commands: ${bundleModule.commands.length}`);
  console.log(`✅ Workflows: ${bundleModule.workflows.length}`);
  bundleModule.workflows.forEach((w) => {
    console.log(`   - ${w.name}: ${w.description}`);
    console.log(`     Steps: ${w.steps.length}`);
  });
  console.log();

  // Test package module
  console.log('=== Package Module ===');
  const { packageModule } = require('./lib/modules/package-module');
  console.log(`✅ Commands: ${packageModule.commands.length}`);
  console.log(`✅ Workflows: ${packageModule.workflows.length}`);
  packageModule.workflows.forEach((w) => {
    console.log(`   - ${w.name}: ${w.description}`);
    console.log(`     Steps: ${w.steps.length}`);
  });
  console.log();

  // Test version module
  console.log('=== Version Module ===');
  const { versionModule } = require('./lib/modules/version-module');
  console.log(`✅ Commands: ${versionModule.commands.length}`);
  console.log(`✅ Workflows: ${versionModule.workflows.length}`);
  versionModule.workflows.forEach((w) => {
    console.log(`   - ${w.name}: ${w.description}`);
    console.log(`     Steps: ${w.steps.length}`);
  });
  console.log();

  // Test user module
  console.log('=== User Module ===');
  const { userModule } = require('./lib/modules/user-module');
  console.log(`✅ Commands: ${userModule.commands.length}`);
  console.log(`✅ Workflows: ${userModule.workflows.length}`);
  userModule.workflows.forEach((w) => {
    console.log(`   - ${w.name}: ${w.description}`);
    console.log(`     Steps: ${w.steps.length}`);
  });
  console.log();

  console.log('🎉 All modules loaded successfully with enhanced workflows!');

  // Summary
  const totalWorkflows = [
    appModule,
    bundleModule,
    packageModule,
    versionModule,
    userModule,
  ].reduce((sum, module) => sum + module.workflows.length, 0);

  console.log(`\n📊 Summary:`);
  console.log(`   Total workflows: ${totalWorkflows}`);
  console.log(`   Enhanced modules: 5/5`);
} catch (error) {
  console.error('❌ Error testing modules:', error.message);
  process.exit(1);
}
