#!/usr/bin/env node

import { loadSession } from './api';
import { appCommands } from './app';
import { bundleCommands } from './bundle';
import { diffCommands } from './diff';
import { installCommands } from './install';
import { packageCommands } from './package';
import { userCommands } from './user';
import { printVersionCommand } from './utils';
import { t } from './utils/i18n';
import { versionCommands } from './versions';

type CliCommandHandler = (argv: any) => Promise<unknown> | unknown;

interface CliArgv {
  command: string;
  args: string[];
  options: Record<string, any>;
}

function printUsage(exitCode = 1) {
  console.log('React Native Update CLI');
  console.log('');
  console.log('Commands:');
  for (const name of Object.keys(commandHandlers)) {
    console.log(`  ${name}`);
  }

  console.log('');
  console.log('Special commands:');
  console.log('  list: List all available commands');
  console.log('  help: Show this help message');

  console.log('');
  console.log(
    'Visit `https://github.com/reactnativecn/react-native-update` for document.',
  );
  process.exit(exitCode);
}

const commandHandlers: Record<string, CliCommandHandler> = {
  ...userCommands,
  ...bundleCommands,
  ...diffCommands,
  ...appCommands,
  ...packageCommands,
  ...versionCommands,
  ...installCommands,
  help: printUsage,
};

async function run() {
  await printVersionCommand();
  if (process.argv.indexOf('-v') >= 0 || process.argv[2] === 'version') {
    process.exit();
  }

  const argv: CliArgv = require('cli-arguments').parse(require('../cli.json'));
  global.NO_INTERACTIVE = argv.options['no-interactive'];
  global.USE_ACC_OSS = argv.options.acc;

  try {
    await loadSession();

    if (argv.command === 'help') {
      printUsage(0);
    } else if (argv.command === 'list') {
      printUsage(0);
    } else if (commandHandlers[argv.command]) {
      const handler = commandHandlers[argv.command];
      await handler(argv);
    } else {
      throw new Error(`Unknown command: ${argv.command}`);
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

export { moduleManager } from './module-manager';
export { CLIProviderImpl } from './provider';
export type {
  CLIModule,
  CLIProvider,
  CommandDefinition,
} from './types';

run();
