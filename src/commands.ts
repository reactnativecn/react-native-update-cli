// Command registry. Every command group is `require`d on first use, so a
// command only pays for its own modules: `apps` never loads Metro/Hermes
// plumbing, `bundle` never loads the source-map library, and so on.

type CliCommandHandler = (argv: any) => Promise<unknown> | unknown;
type HandlerMap = Record<string, CliCommandHandler>;

const groups = {
  app: () => require('./app').getAppCommands() as HandlerMap,
  bundle: () => require('./bundle').bundleCommands as HandlerMap,
  cache: () => require('./cache').cacheCommands as HandlerMap,
  diff: () => require('./diff').diffCommands as HandlerMap,
  install: () => require('./install').installCommands as HandlerMap,
  package: () => require('./package').packageCommands as HandlerMap,
  symbolicate: () => require('./symbolicate').symbolicateCommands as HandlerMap,
  user: () => require('./user').userCommands as HandlerMap,
  versions: () => require('./versions').versionCommands as HandlerMap,
};

/**
 * command name → group. Kept in sync with cli.json by tests/commands.test.ts,
 * so a command added to one place but not the other fails the suite.
 */
const commandGroups: Record<string, keyof typeof groups> = {
  login: 'user',
  logout: 'user',
  me: 'user',
  createApp: 'app',
  apps: 'app',
  deleteApp: 'app',
  selectApp: 'app',
  uploadIpa: 'package',
  uploadApk: 'package',
  uploadAab: 'package',
  uploadApp: 'package',
  parseApp: 'package',
  parseIpa: 'package',
  parseApk: 'package',
  parseAab: 'package',
  extractApk: 'package',
  packages: 'package',
  deletePackage: 'package',
  publish: 'versions',
  versions: 'versions',
  update: 'versions',
  updateVersionInfo: 'versions',
  deleteVersion: 'versions',
  bundle: 'bundle',
  hdiff: 'diff',
  hdiffFromApk: 'diff',
  hdiffFromApp: 'diff',
  hdiffFromIpa: 'diff',
  install: 'install',
  cache: 'cache',
  symbolicate: 'symbolicate',
};

/** names of all commands, in the order they are listed by `help` */
export const commandNames: readonly string[] = Object.keys(commandGroups);

/** the handler of `name`, loading its module now; undefined for unknown names */
export function loadCommandHandler(
  name: string,
): CliCommandHandler | undefined {
  const group = commandGroups[name];
  if (!group) {
    return undefined;
  }
  return groups[group]()[name];
}
