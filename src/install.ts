import { spawnSync } from 'child_process';
import path from 'path';
import type { CommandContext } from './types';

export const installCommands = {
  install: async ({ args }: CommandContext) => {
    if (args.length === 0) {
      return;
    }

    const cliDir = path.resolve(__dirname, '..');

    spawnSync('npm', ['install', ...args], {
      cwd: cliDir,
      stdio: 'inherit',
      shell: true,
    });
  },
};
