#!/usr/bin/env node

import { loadSession } from './api';
import { getAppCommands } from './app';
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

function isTruthyEnv(value: string | undefined): boolean {
  return value === '1' || value?.toLowerCase() === 'true';
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
  ...getAppCommands(),
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
  global.NO_INTERACTIVE =
    Boolean(argv.options['no-interactive']) ||
    isTruthyEnv(process.env.NO_INTERACTIVE);
  global.USE_ACC_OSS =
    Boolean(argv.options.acc) || isTruthyEnv(process.env.USE_ACC_OSS);

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
      throw new Error(t('unknownCommand', { command: argv.command }));
    }
  } catch (err: any) {
    if (err.status === 401) {
      console.log(t('loginFirst'));
      process.exit(1);
    }
    console.error(err.stack);
    process.exit(1);
  }
}

run();
