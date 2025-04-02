export default {
  updateNotifier:
    '建议运行 `{updateCommand}` 来更新命令行工具以获得功能、性能和安全性的持续改进',
  loginFirst: '尚未登录。\n请在项目目录中运行`pushy login`命令来登录',
  lockNotFound:
    '没有检测到任何 lock 文件，这可能导致依赖关系不一致而使热更异常。',
  lockBestPractice: `
关于 lock 文件的最佳实践：
1. 开发团队中的所有成员应该使用相同的包管理器，维护同一份 lock 文件。
2. 将 lock 文件添加到版本控制中（但不要同时提交多种不同格式的 lock 文件）。
3. 代码审核时应关注 lock 文件的变化。
这样可以最大限度避免因依赖关系不一致而导致的热更异常，也降低供应链攻击等安全隐患。
`,
  multipleLocksFound:
    '检测到多种不同格式的锁文件({{lockFiles}})，这可能导致依赖关系不一致而使热更异常。',
  loginExpired: '登录信息已过期，请使用 `pushy login` 命令重新登录',
  fileSizeExceeded:
    '此文件大小 {{fileSize}} , 超出当前额度 {{maxSize}} 。您可以考虑升级付费业务以提升此额度。详情请访问: {{pricingPageUrl}}',
  bundleNotFound:
    '找不到 bundle 文件。请确保此 {{packageType}} 为 release 版本，且 bundle 文件名为默认的 `{{entryFile}}`',
  buildTimeNotFound:
    '无法获取此包的编译时间戳。请更新 `react-native-update` 到最新版本后重新打包上传。',
  latestVersionTag: '（最新：{{version}}）',
  rnuVersionNotFound:
    'react-native-update: 无法获取版本号。请在项目目录中运行命令',
  unsupportedPlatform: '无法识别的平台 `{{platform}}`',
  appId: '应用 id',
  appName: '应用名称',
  platform: '平台',
  totalApps: '共 {{count}} 个{{platform}}应用',
  appNotSelected:
    '尚未选择应用。请先运行 `pushy selectApp --platform {{platform}}` 来选择应用',
  enterAppIdQuestion: '输入应用 id:',
  appNameQuestion: '应用名称:',
  platformQuestion: '平台(ios/android/harmony):',
  createAppSuccess: '已成功创建应用（id: {{id}}）',
  cancelled: '已取消',
  operationSuccess: '操作成功',
  failedToParseUpdateJson: '无法解析文件 `update.json`。请手动删除它。',
  ppkPackageGenerated: 'ppk 热更包已生成并保存到: {{output}}',
};
