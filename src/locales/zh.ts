export default {
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
    '检测到多种不同格式的锁文件({{- lockFiles}})，这可能导致依赖关系不一致而使热更异常。',
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
  totalApps: '共 {{count}} 个 {{platform}} 应用',
  appNotSelected:
    '尚未选择应用。请先运行 `pushy selectApp --platform {{platform}}` 来选择应用',
  enterAppIdQuestion: '输入应用 id:',
  appNameQuestion: '应用名称:',
  platformQuestion: '平台(ios/android/harmony):',
  createAppSuccess: '已成功创建应用（id: {{id}}）',
  cancelled: '已取消',
  operationSuccess: '操作成功',
  failedToParseUpdateJson: '无法解析文件 `update.json`。请手动删除它。',
  ppkPackageGenerated: 'ppk 热更包已生成并保存到: {{- output}}',
  welcomeMessage: '欢迎使用 pushy 热更新服务，{{name}}。',
  loggedOut: '已退出登录',
  usageUnderDevelopment: '使用说明正在开发中。',
  hermesDisabled: 'Hermes 已禁用',
  hermesEnabled: 'Hermes 已启用，正在编译为 hermes 字节码：\n',
  runningHermesc: '运行 hermesc：{{command}} {{args}}',
  composingSourceMap: '正在生成 source map',
  copyingDebugId: '正在复制 debugid',
  sentryCliNotFound: '无法找到 Sentry CLI 工具，请确保已正确安装 @sentry/cli',
  sentryReleaseCreated: '已为版本 {{version}} 创建 Sentry release',
  uploadingSourcemap: '正在上传 sourcemap',
  packing: '正在打包',
  deletingFile: '删除 {{- file}}',
  bundlingWithRN: '正在使用 react-native {{version}} 打包',
  fileGenerated: '已生成 {{- file}}',
  processingError: '处理文件时出错：{{error}}',
  usageDiff: '用法：pushy {{command}} <origin> <next>',
  pluginDetected: '检测到 {{name}} 插件',
  pluginDetectionError: '检测 {{name}} 插件时出错：{{error}}',
  addedToGitignore: '已将 {{line}} 添加到 .gitignore',
  processingStringPool: '正在处理字符串池...',
  processingPackage: '正在处理包 {{count}}...',
  typeStrings: '类型字符串：',
  keyStrings: '键字符串：',
  failedToParseIcon: '[警告] 解析图标失败：{{error}}',
  errorInHarmonyApp: '获取 Harmony 应用入口时出错：{{error}}',
  totalPackages: '共 {{count}} 个包',
  usageUploadIpa: '使用方法: pushy uploadIpa ipa后缀文件',
  usageUploadApk: '使用方法: pushy uploadApk apk后缀文件',
  usageUploadApp: '使用方法: pushy uploadApp app后缀文件',
  usageParseApp: '使用方法: pushy parseApp app后缀文件',
  usageParseIpa: '使用方法: pushy parseIpa ipa后缀文件',
  usageParseApk: '使用方法: pushy parseApk apk后缀文件',
  offset: '偏移量 {{offset}}',
  packageUploadSuccess: '已成功上传新热更包（id: {{id}}）',
  rolloutRangeError: 'rollout 必须是 1-100 的整数',
  nativeVersionNotFound: '未查询到 >= {{version}} 的原生版本',
  nativeVersionNotFoundLess: '未查询到 <= {{version}} 的原生版本',
  nativeVersionNotFoundMatch: '未查询到匹配原生版本：{{version}}',
  packageIdRequired: '请提供 packageId 或 packageVersion 参数',
  operationComplete: '操作完成，共已绑定 {{count}} 个原生版本',
  platformRequired: '必须指定平台。',
  bundleCommandError: '"react-native bundle" 命令退出，代码为 {{code}}。',
  copyHarmonyBundleError: '复制 Harmony bundle 错误：{{error}}',
  copyFileFailed: '复制文件失败：{{error}}',
  deleteFile: '删除 {{- file}}',
  rolloutConfigSet:
    '已在原生版本 {{versions}} 上设置灰度发布 {{rollout}}% 热更版本 {{version}}',
  versionBind:
    '已将热更版本 {{version}} 绑定到原生版本 {{nativeVersion}} (id: {{id}})',
};
