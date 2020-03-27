#!/usr/bin/env node
/**
 * Created by tdzl2003 on 2/13/16.
 */

const {loadSession} = require('./api');
const updateNotifier = require('update-notifier');
import { printVersionCommand } from './utils/index.js';
const pkg = require('../package.json');

updateNotifier({pkg}).notify({isGlobal: true});

function printUsage({args}) {
  // const commandName = args[0];
  // TODO: print usage of commandName, or print global usage.

  console.log('Usage is under development now.')
  console.log('Visit `https://github.com/reactnativecn/react-native-pushy` for early document.');
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
  if (process.argv.indexOf('-v') >= 0 || process.argv[2] === 'version') {
    printVersionCommand();
    process.exit();
  }
  
  const argv = require('cli-arguments').parse(require('../cli.json'));
  global.NO_INTERACTIVE = argv.options['no-interactive'];

  loadSession()
    .then(()=>commands[argv.command](argv))
    .catch(err=>{
      if (err.status === 401) {
        console.log('Not loggined.\nRun `pushy login` at your project directory to login.');
        return;
      }
      console.error(err.stack);
      process.exit(-1);
    });
};

run();