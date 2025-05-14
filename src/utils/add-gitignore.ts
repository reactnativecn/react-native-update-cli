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

  for (const line of gitignoreLines) {
    const index = shouldIgnore.indexOf(line.trim());
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
