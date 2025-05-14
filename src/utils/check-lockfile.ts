import fs from 'fs';
import path from 'path';
import { t } from './i18n';

const lockFiles = [
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'bun.lock',
];

// Function to check if a package.json has a workspaces field
function hasWorkspaces(dir: string): boolean {
  const pkgPath = path.join(dir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      return !!pkg.workspaces;
    } catch (e) {
      // Ignore parsing errors
    }
  }
  return false;
}

// Helper function to find lock files in a specific directory
function findLockFilesInDir(directory: string): string[] {
  const found: string[] = [];
  for (const file of lockFiles) {
    const filePath = path.join(directory, file);
    if (fs.existsSync(filePath)) {
      found.push(filePath);
    }
  }
  return found;
}

export function checkLockFiles() {
  const cwd = process.cwd();
  let searchDir = cwd;
  let foundLockFiles = findLockFilesInDir(searchDir);

  // If no lock file in cwd, try to find monorepo root and check there
  if (foundLockFiles.length === 0) {
    // Search upwards for package.json with workspaces
    let currentDir = path.dirname(cwd); // Start searching from parent
    let projectRootDir: string | null = null;

    while (true) {
      if (hasWorkspaces(currentDir)) {
        projectRootDir = currentDir;
        break;
      }
      const parentDir = path.dirname(currentDir);
      if (parentDir === currentDir) {
        // Reached the filesystem root
        break;
      }
      currentDir = parentDir;
    }

    // If a potential root was found, switch search directory and re-check
    if (projectRootDir) {
      searchDir = projectRootDir;
      foundLockFiles = findLockFilesInDir(searchDir);
    }
    // If no projectRootDir found, foundLockFiles remains empty and searchDir remains cwd
  }

  // Handle results based on findings in the final searchDir
  if (foundLockFiles.length === 1) {
    // Successfully found one lock file in the determined searchDir
    return;
  }

  if (foundLockFiles.length > 1) {
    // Found multiple lock files in the determined searchDir
    console.warn(t('lockBestPractice'));
    throw new Error(
      t('multipleLocksFound', { lockFiles: foundLockFiles.join(', ') }),
    );
  }

  // If we reach here, foundLockFiles.length === 0
  console.warn(t('lockBestPractice'));
  // Warn instead of throwing an error if no lock file is found
  console.warn(t('lockNotFound'));
}
