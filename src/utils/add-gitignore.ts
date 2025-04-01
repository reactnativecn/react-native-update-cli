import fs from 'node:fs';
import path from 'node:path';
import { credentialFile, tempDir } from './constants';

export function addGitIgnore() {
  const shouldIgnore = [credentialFile, tempDir];

  const gitignorePath = path.join(process.cwd(), '.gitignore');

  if (!fs.existsSync(gitignorePath)) {
    return;
  }

  const gitignoreContent = fs.readFileSync(gitignorePath, 'utf-8');

  const gitignoreLines = gitignoreContent.split('\n');

  for (const line of gitignoreLines) {
    const index = shouldIgnore.indexOf(line);
    if (index !== -1) {
      shouldIgnore.splice(index, 1);
    }
  }

  if (shouldIgnore.length > 0) {
    for (const line of shouldIgnore) {
      gitignoreLines.push(line);
      console.log(`Added ${line} to .gitignore`);
    }

    fs.writeFileSync(gitignorePath, gitignoreLines.join('\n'));
  }
}
