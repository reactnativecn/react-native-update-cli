const lockFiles = [
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'bun.lock',
];

const lockNotFound = `
没有检测到任何 lock 文件，这可能导致依赖关系不一致而使热更异常。
`;

const multipleLocksFound = `
检测到多个锁文件()，这可能导致依赖关系不一致而使热更异常。
`;


const lockBestPractice = `
关于 lock 文件的最佳实践：
1. 开发团队中的所有成员应该使用相同的包管理器，维护同一份 lock 文件。
2. 将 lock 文件添加到版本控制中（但不要同时提交多种不同格式的 lock 文件）。
3. 代码审核时应关注 lock 文件的变化。
这样可以最大限度避免因依赖关系不一致而导致的热更异常，也降低供应链攻击等安全隐患。
`;
