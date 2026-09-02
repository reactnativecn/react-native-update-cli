#!/usr/bin/env node

import { loadSession } from './api';
import { commandNames, loadCommandHandler } from './commands';
import { printVersionCommand } from './utils';
import { t } from './utils/i18n';

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
  for (const name of commandNames) {
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

/**
 * Errors reaching the top level are almost always about the user's input,
 * project or network: print their message. The stack trace, which only helps
 * when the CLI itself is at fault, is printed on request (RNU_DEBUG=1).
 */
function reportError(err: unknown) {
  if (isTruthyEnv(process.env.RNU_DEBUG)) {
    console.error(err instanceof Error ? err.stack : err);
    // fetch failures wrap the real reason (ECONNREFUSED, TLS, ...) as `cause`
    for (
      let cause = (err as { cause?: unknown })?.cause;
      cause;
      cause = (cause as { cause?: unknown })?.cause
    ) {
      console.error('Caused by:', cause);
    }
    return;
  }
  console.error(err instanceof Error ? err.message : String(err));
  console.error(t('errorStackHint'));
}

async function run() {
  const versionOnly = ['-v', '--version', 'version'].includes(
    process.argv[2] ?? '',
  );
  // The registry check for newer versions runs alongside the command (from a
  // 1-day cache when possible) and only ever delays `-v`/`version` itself; its
  // hint is printed once the command is done, or at exit for commands that
  // exit on their own.
  const versionCheck = await printVersionCommand({ wait: versionOnly });
  if (versionOnly) {
    versionCheck.startAutoUpdate();
    process.exit();
  }
  process.on('exit', (code) => {
    if (code === 0) {
      versionCheck.printHints();
      versionCheck.startAutoUpdate();
    }
  });

  try {
    // inside the try: an unknown command or option is reported like any other
    // error instead of crashing with an unhandled rejection
    const argv: CliArgv = require('cli-arguments').parse(
      require('../cli.json'),
    );
    global.NO_INTERACTIVE =
      Boolean(argv.options['no-interactive']) ||
      isTruthyEnv(process.env.NO_INTERACTIVE);
    global.USE_ACC_OSS =
      Boolean(argv.options.acc) || isTruthyEnv(process.env.USE_ACC_OSS);

    await loadSession();

    if (argv.command === 'help' || argv.command === 'list') {
      printUsage(0);
    }
    const handler = loadCommandHandler(argv.command);
    if (!handler) {
      throw new Error(t('unknownCommand', { command: argv.command }));
    }
    await handler(argv);
    // a check still in flight (cold cache) gets a short grace period; the
    // registry request itself is unref'd, so exiting never waits on it
    await versionCheck.settle(500);
    versionCheck.printHints();
    versionCheck.startAutoUpdate();
  } catch (err: any) {
    if (err?.status === 401) {
      console.log(t('loginFirst'));
      process.exit(1);
    }
    reportError(err);
    process.exit(1);
  }
}

run();
