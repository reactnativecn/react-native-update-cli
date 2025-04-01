#!/usr/bin/env node

import { loadSession } from './api';
import updateNotifier from 'update-notifier';
import { printVersionCommand } from './utils';
import pkg from '../package.json';
import { t } from './utils/i18n';
import { addGitIgnore } from './utils/add-gitignore';

updateNotifier({ pkg }).notify({
  isGlobal: true,
  message: t('updateNotifier'),
});

function printUsage() {
  // const commandName = args[0];
  // TODO: print usage of commandName, or print global usage.

  console.log('Usage is under development now.');
  console.log(
    'Visit `https://github.com/reactnativecn/react-native-update` for document.',
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

async function run() {
  addGitIgnore();
  await printVersionCommand();
  if (process.argv.indexOf('-v') >= 0 || process.argv[2] === 'version') {
    process.exit();
  }

  const argv = require('cli-arguments').parse(require('../cli.json'));
  global.NO_INTERACTIVE = argv.options['no-interactive'];
  global.USE_ACC_OSS = argv.options.acc;

  loadSession()
    .then(() => commands[argv.command](argv))
    .catch((err) => {
      if (err.status === 401) {
        console.log(t('loginFirst'));
        return;
      }
      console.error(err.stack);
      process.exit(-1);
    });
}

run();
