#!/usr/bin/env node

import { loadSession } from './api';
import updateNotifier from 'update-notifier';
import { printVersionCommand } from './utils/index.js';
import pkg from '../package.json';

updateNotifier({ pkg }).notify({
  isGlobal: true,
  message:
    '建议运行 `{updateCommand}` 来更新命令行工具以获得功能、性能和安全性的持续改进',
});

function printUsage() {
  // const commandName = args[0];
  // TODO: print usage of commandName, or print global usage.

  console.log('Usage is under development now.');
  console.log(
    'Visit `https://github.com/reactnativecn/react-native-pushy` for early document.',
  );
  process.exit(1);
}

const commands = {
  ...require('./user').commands,
  ...require('./bundle').commands,
  ...require('./app').commands,
  ...require('./package').commands,
  ...require('./versions').commands,
  help: printUsage,
};

function run() {
  printVersionCommand();
  if (process.argv.indexOf('-v') >= 0 || process.argv[2] === 'version') {
    process.exit();
  }

  const argv = require('cli-arguments').parse(require('../cli.json'));
  global.NO_INTERACTIVE = argv.options['no-interactive'];
  global.USE_ACC_OSS = argv.options['acc'];

  loadSession()
    .then(() => commands[argv.command](argv))
    .catch((err) => {
      if (err.status === 401) {
        console.log('尚未登录。\n请在项目目录中运行`pushy login`命令来登录');
        return;
      }
      console.error(err.stack);
      process.exit(-1);
    });
}

run();
