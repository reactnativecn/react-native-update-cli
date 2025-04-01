import fs from 'node:fs';
import { t } from '../../lib/utils/i18n';

const lockFiles = [
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'bun.lock',
];

const existingLockFiles: string[] = [];
export function checkLockFiles() {
  for (const file of lockFiles) {
    if (fs.existsSync(file)) {
      existingLockFiles.push(file);
    }
  }
  if (existingLockFiles.length === 0) {
    console.warn(t('lockFilesNotFound'));
  } else if (existingLockFiles.length > 1) {
    console.warn(t('multipleLockFilesFound'));
  }
}
