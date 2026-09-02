import fs from 'fs';
// import path from 'path';
import { credentialFile, tempDir } from './constants';
import { t } from './i18n';

export function addGitIgnore() {
  const shouldIgnore = [credentialFile, tempDir];

  const gitignorePath = '.gitignore';

  if (!fs.existsSync(gitignorePath)) {
    return;
  }

  const gitignoreContent = fs.readFileSync(gitignorePath, 'utf-8');

  const gitignoreLines = gitignoreContent.split('\n');

  // `.pushy`, `/.pushy` and `.pushy/` all ignore the same directory; a
  // trailing slash only matches directories, so it counts for tempDir alone
  const covers = (entry: string, line: string) => {
    const pattern = line.trim().replace(/^\//, '');
    return pattern === entry || (entry === tempDir && pattern === `${entry}/`);
  };
  for (const line of gitignoreLines) {
    const index = shouldIgnore.findIndex((entry) => covers(entry, line));
    if (index !== -1) {
      shouldIgnore.splice(index, 1);
    }
  }

  if (shouldIgnore.length > 0) {
    gitignoreLines.push('# react-native-update');
    for (const line of shouldIgnore) {
      gitignoreLines.push(line);
      console.log(t('addedToGitignore', { line }));
    }

    fs.writeFileSync(gitignorePath, gitignoreLines.join('\n'));
  }
}
