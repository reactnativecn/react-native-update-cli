export default {
  updateNotifier:
    'Run `{updateCommand}` to update the CLI to get continuous improvements in features, performance, and security.',
  loginFirst:
    'Not logged in.\nPlease run `cresc login` in the project directory to login.',
  lockNotFound:
    'No lock file detected, which may cause inconsistent dependencies and hot-updating issues.',
  multipleLocksFound:
    'Multiple lock files detected ({lockFiles}), which may cause inconsistent dependencies and hot-updating issues.',
  lockBestPractice: `
Best practices for lock files:
1. All members of the development team should use the same package manager to maintain a single lock file.
2. Add the lock file to version control (but do not commit multiple lock files of different formats).
3. Pay attention to changes in the lock file during code review.
This can reduce the risk of inconsistent dependencies and supply chain attacks.
`,
};
