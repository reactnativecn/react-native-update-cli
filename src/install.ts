import { spawnSync } from 'child_process';
import path from 'path';
import type { CommandContext } from './types';
import { getInstallCommand } from './utils/runtime';

export const installCommands = {
  install: async ({ args }: CommandContext) => {
    if (args.length === 0) {
      return;
    }

    const cliDir = path.resolve(__dirname, '..');
    const installCommand = getInstallCommand(args, cliDir);

    spawnSync(installCommand.command, installCommand.args, {
      cwd: cliDir,
      stdio: 'inherit',
      shell: true,
    });
  },
};
