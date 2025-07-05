#!/usr/bin/env node

import { loadSession } from './api';
import { printVersionCommand } from './utils';
import { t } from './utils/i18n';
import { moduleManager } from './module-manager';
import { builtinModules } from './modules';
import type { CommandContext } from './types';

// 注册内置模块
function registerBuiltinModules() {
  for (const module of builtinModules) {
    try {
      moduleManager.registerModule(module);
    } catch (error) {
      console.error(`Failed to register module ${module.name}:`, error);
    }
  }
}

function printUsage() {
  console.log('React Native Update CLI - Modular Version');
  console.log('');
  console.log('Available commands:');
  
  const commands = moduleManager.getRegisteredCommands();
  for (const command of commands) {
    console.log(`  ${command.name}: ${command.description || 'No description'}`);
  }
  
  console.log('');
  console.log('Available workflows:');
  const workflows = moduleManager.getRegisteredWorkflows();
  for (const workflow of workflows) {
    console.log(`  ${workflow.name}: ${workflow.description || 'No description'}`);
  }
  
  console.log('');
  console.log('Visit `https://github.com/reactnativecn/react-native-update` for document.');
  process.exit(1);
}

async function run() {
  await printVersionCommand();
  
  // 检查版本参数
  if (process.argv.indexOf('-v') >= 0 || process.argv[2] === 'version') {
    process.exit();
  }

  // 注册内置模块
  registerBuiltinModules();

  // 解析命令行参数
  const argv = require('cli-arguments').parse(require('../cli.json'));
  global.NO_INTERACTIVE = argv.options['no-interactive'];
  global.USE_ACC_OSS = argv.options.acc;

  // 创建命令上下文
  const context: CommandContext = {
    args: argv.args || [],
    options: argv.options || {},
  };

  try {
    // 加载会话
    await loadSession();
    context.session = require('./api').getSession();

    // 执行命令或工作流
    if (argv.command === 'help') {
      printUsage();
    } else if (argv.command === 'list') {
      moduleManager.listAll();
    } else if (argv.command === 'workflow') {
      const workflowName = argv.args[0];
      if (!workflowName) {
        console.error('Workflow name is required');
        process.exit(1);
      }
      
      const result = await moduleManager.executeWorkflow(workflowName, context);
      if (!result.success) {
        console.error('Workflow execution failed:', result.error);
        process.exit(1);
      }
      console.log('Workflow completed successfully:', result.data);
    } else {
      // 执行普通命令
      const result = await moduleManager.executeCommand(argv.command, context);
      if (!result.success) {
        console.error('Command execution failed:', result.error);
        process.exit(1);
      }
      console.log('Command completed successfully:', result.data);
    }
  } catch (err: any) {
    if (err.status === 401) {
      console.log(t('loginFirst'));
      return;
    }
    console.error(err.stack);
    process.exit(-1);
  }
}

// 导出模块管理器，供外部使用
export { moduleManager };
export { CLIProviderImpl } from './provider';
export type { CLIProvider, CLIModule, CommandDefinition, CustomWorkflow, WorkflowStep } from './types';

// 如果直接运行此文件，则执行CLI
if (require.main === module) {
  run();
} 