export default {
  addedToGitignore: '已将 {{line}} 添加到 .gitignore',
  androidCrunchPngsWarning:
    'android 的 crunchPngs 选项似乎尚未禁用（如已禁用则请忽略此提示），这可能导致热更包体积异常增大，具体请参考 https://pushy.reactnative.cn/docs/getting-started.html#%E7%A6%81%E7%94%A8-android-%E7%9A%84-crunch-%E4%BC%98%E5%8C%96 \n',
  appId: '应用 id',
  appIdMismatchApk:
    'appId不匹配！当前apk: {{appIdInPkg}}, 当前update.json: {{appId}}',
  appIdMismatchApp:
    'appId不匹配！当前app: {{appIdInPkg}}, 当前update.json: {{appId}}',
  appIdMismatchIpa:
    'appId不匹配！当前ipa: {{appIdInPkg}}, 当前update.json: {{appId}}',
  appKeyMismatchApk:
    'appKey不匹配！当前apk: {{appKeyInPkg}}, 当前update.json: {{appKey}}',
  appKeyMismatchApp:
    'appKey不匹配！当前app: {{appKeyInPkg}}, 当前update.json: {{appKey}}',
  appKeyMismatchIpa:
    'appKey不匹配！当前ipa: {{appKeyInPkg}}, 当前update.json: {{appKey}}',
  appName: '应用名称',
  appNameQuestion: '应用名称:',
  appNotSelected:
    '尚未选择应用。请先运行 `pushy selectApp --platform {{platform}}` 来选择应用',
  appUploadSuccess:
    '已成功上传app原生包（id: {{id}}, version: {{version}}, buildTime: {{buildTime}}）',
  apkUploadSuccess:
    '已成功上传apk原生包（id: {{id}}, version: {{version}}, buildTime: {{buildTime}}）',
  boundTo: ', 已绑定：{{name}} ({{id}})',
  buildTimeNotFound:
    '无法获取此包的编译时间戳。请更新 `react-native-update` 到最新版本后重新打包上传。',
  bundleCommandError: '"react-native bundle" 命令退出，代码为 {{code}}。',
  bundleNotFound:
    '找不到 bundle 文件。请确保此 {{packageType}} 为 release 版本，且 bundle 文件名为默认的 `{{entryFile}}`',
  bundlingWithRN: '正在使用 react-native {{version}} 打包',
  cancelled: '已取消',
  composingSourceMap: '正在生成 source map',
  copyFileFailed: '复制文件失败：{{error}}',
  copyHarmonyBundleError: '复制 Harmony bundle 错误：{{error}}',
  copyingDebugId: '正在复制 debugid',
  createAppSuccess: '已成功创建应用（id: {{id}}）',
  deleteFile: '删除 {{- file}}',
  deletingFile: '删除 {{- file}}',
  enterAppIdQuestion: '输入应用 id:',
  enterNativePackageId: '输入原生包 id:',
  errorInHarmonyApp: '获取 Harmony 应用入口时出错：{{error}}',
  expiredStatus: '(已过期)',
  failedToParseIcon: '[警告] 解析图标失败：{{error}}',
  failedToParseUpdateJson: '无法解析文件 `update.json`。请手动删除它。',
  fileGenerated: '已生成 {{- file}}',
  fileSizeExceeded:
    '此文件大小 {{fileSize}} , 超出当前额度 {{maxSize}} 。您可以考虑升级付费业务以提升此额度。详情请访问: {{- pricingPageUrl}}',
  forceHermes: '强制启用 Hermes 编译',
  hermesEnabledCompiling: 'Hermes 已启用，正在编译为 hermes 字节码：\n',
  ipaUploadSuccess:
    '已成功上传ipa原生包（id: {{id}}, version: {{version}}, buildTime: {{buildTime}}）',
  keyStrings: '键字符串：',
  latestVersionTag: '（最新：{{version}}）',
  lockBestPractice: `
关于 lock 文件的最佳实践：
1. 开发团队中的所有成员应该使用相同的包管理器，维护同一份 lock 文件。
2. 将 lock 文件添加到版本控制中（但不要同时提交多种不同格式的 lock 文件）。
3. 代码审核时应关注 lock 文件的变化。
这样可以最大限度避免因依赖关系不一致而导致的热更异常，也降低供应链攻击等安全隐患。
`,
  lockNotFound:
    '没有检测到任何 lock 文件，这可能导致依赖关系不一致而使热更异常。',
  loggedOut: '已退出登录',
  loginExpired: '登录信息已过期，请使用 `pushy login` 命令重新登录',
  loginFirst: '尚未登录。\n请在项目目录中运行`pushy login`命令来登录',
  multipleLocksFound:
    '检测到多种不同格式的锁文件({{- lockFiles}})，这可能导致依赖关系不一致而使热更异常。',
  nativePackageId: '原生包 Id',
  nativeVersion: '原生版本',
  nativeVersionNotFoundGte: '未查询到 >= {{version}} 的原生版本',
  nativeVersionNotFoundLte: '未查询到 <= {{version}} 的原生版本',
  nativeVersionNotFoundMatch: '未查询到匹配原生版本：{{version}}',
  nativePackageIdNotFound: '未查询到原生包 id: {{id}}',
  noPackagesFound: '未查询到任何原生包（appId: {{appId}}）',
  offset: '偏移量 {{offset}}',
  operationComplete: '操作完成，共已绑定 {{count}} 个原生版本',
  operationSuccess: '操作成功',
  packageIdRequired: '请提供 packageId 或 packageVersion 参数',
  packageUploadSuccess: '已成功上传新热更包（id: {{id}}）',
  packing: '正在打包',
  pausedStatus: '(已暂停)',
  platform: '平台',
  platformPrompt: '平台(ios/android/harmony):',
  platformQuestion: '平台(ios/android/harmony):',
  platformRequired: '必须指定平台。',
  pluginDetectionError: '检测 {{name}} 插件时出错：{{error}}',
  pluginDetected: '检测到 {{name}} 插件',
  ppkPackageGenerated: 'ppk 热更包已生成并保存到: {{- output}}',
  processingError: '处理文件时出错：{{error}}',
  processingPackage: '正在处理包 {{count}}...',
  processingStringPool: '正在处理字符串池...',
  publishUsage:
    '使用方法: pushy publish ppk后缀文件 --platform ios|android|harmony',
  rnuVersionNotFound:
    'react-native-update: 无法获取版本号。请在项目目录中运行命令',
  rolloutConfigSet:
    '已在原生版本 {{versions}} 上设置灰度发布 {{rollout}}% 热更包 {{version}}',
  rolloutRangeError: 'rollout 必须是 1-100 的整数',
  runningHermesc: '运行 hermesc：{{- command}} {{- args}}',
  sentryCliNotFound: '无法找到 Sentry CLI 工具，请确保已正确安装 @sentry/cli',
  sentryReleaseCreated: '已为版本 {{version}} 创建 Sentry release',
  totalApps: '共 {{count}} 个 {{platform}} 应用',
  totalPackages: '共 {{count}} 个包',
  typeStrings: '类型字符串：',
  unsupportedPlatform: '无法识别的平台 `{{platform}}`',
  uploadBundlePrompt: '是否现在上传此热更包?(Y/N)',
  uploadingSourcemap: '正在上传 sourcemap',
  usageDiff: '用法：pushy {{command}} <origin> <next>',
  usageParseApk: '使用方法: pushy parseApk apk后缀文件',
  usageParseAab: '使用方法: pushy parseAab aab后缀文件',
  usageParseApp: '使用方法: pushy parseApp app后缀文件',
  usageParseIpa: '使用方法: pushy parseIpa ipa后缀文件',
  usageUploadApk: '使用方法: pushy uploadApk apk后缀文件',
  usageUploadApp: '使用方法: pushy uploadApp app后缀文件',
  usageUploadIpa: '使用方法: pushy uploadIpa ipa后缀文件',
  versionBind:
    '已将热更包 {{version}} 绑定到原生版本 {{nativeVersion}} (id: {{id}})',
  welcomeMessage: '欢迎使用 pushy 热更新服务，{{name}}。',
  versionNameQuestion: '输入版本名称:',
  versionDescriptionQuestion: '输入版本描述:',
  versionMetaInfoQuestion: '输入自定义的 meta info:',
  updateNativePackageQuestion: '是否现在将此热更应用到原生包上？(Y/N)',
  unnamed: '(未命名)',
  dryRun: '以下是 dry-run 模拟运行结果，不会实际执行任何操作：',
  usingCustomVersion: '使用自定义版本：{{version}}',
  confirmDeletePackage: '确认删除原生包 {{packageId}}? 此操作不可撤销 (Y/N):',
  deletePackageSuccess: '原生包 {{packageId}} 删除成功',
  deletePackageError: '删除原生包 {{packageId}} 失败: {{error}}',
  usageDeletePackage:
    '使用方法: pushy deletePackage [packageId] --appId [appId]',
  deleteVersionSuccess: '热更包 {{versionId}} 删除成功',
  deleteVersionError: '删除热更包 {{versionId}} 失败: {{error}}',
  bundleFileNotFound: '未找到 bundle 文件！请使用默认的 bundle 文件名和路径。',
  diffPackageGenerated: '{{- output}} 已生成。',
  nodeBsdiffRequired:
    '此功能需要 "node-bsdiff"。请运行 "{{scriptName}} install node-bsdiff" 来安装',
  nodeHdiffpatchRequired:
    '此功能需要 "node-hdiffpatch"。请运行 "{{scriptName}} install node-hdiffpatch" 来安装',
};
