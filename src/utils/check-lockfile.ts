import fs from 'node:fs';
import { t } from './i18n';

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
  if (existingLockFiles.length === 1) {
    return;
  }
  console.warn(t('lockBestPractice'));
  if (existingLockFiles.length === 0) {
    throw new Error(t('lockNotFound'));
  }
  throw new Error(
    t('multipleLocksFound', { lockFiles: existingLockFiles.join(', ') }),
  );
}
