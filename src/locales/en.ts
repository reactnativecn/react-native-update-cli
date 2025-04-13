export default {
  updateNotifier:
    'Run `{updateCommand}` to update the CLI to get continuous improvements in features, performance, and security.',
  loginFirst:
    'Not logged in.\nPlease run `cresc login` in the project directory to login.',
  lockNotFound:
    'No lock file detected, which may cause inconsistent dependencies and hot-updating issues.',
  multipleLocksFound:
    'Multiple lock files detected ({{lockFiles}}), which may cause inconsistent dependencies and hot-updating issues.',
  lockBestPractice: `
Best practices for lock files:
1. All members of the development team should use the same package manager to maintain a single lock file.
2. Add the lock file to version control (but do not commit multiple lock files of different formats).
3. Pay attention to changes in the lock file during code review.
This can reduce the risk of inconsistent dependencies and supply chain attacks.
`,
  loginExpired:
    'Login information has expired. Please use `cresc login` command to re-login',
  fileSizeExceeded:
    'This file size is {{fileSize}} , exceeding the current quota {{maxSize}} . You may consider upgrading to a higher plan to increase this quota. Details can be found at: {{pricingPageUrl}}',
  bundleNotFound:
    'Bundle file not found. Please ensure that this {{packageType}} is a release version and the bundle file name is the default `{{entryFile}}`',
  buildTimeNotFound:
    'Cannot get the build timestamp of this package. Please update `react-native-update` to the latest version and re-package and upload.',
  latestVersionTag: '(latest: {{version}})',
  rnuVersionNotFound:
    'react-native-update: Cannot get the version number. Please run the command in the project directory',
  unsupportedPlatform: 'Unsupported platform `{{platform}}`',
  appId: 'App ID',
  appName: 'App Name',
  platform: 'Platform',
  totalApps: 'Total {{count}} {{platform}} apps',
  appNotSelected:
    'App not selected. run `cresc selectApp --platform {{platform}}` first!',
  enterAppIdQuestion: 'Enter AppId:',
  appNameQuestion: 'App Name:',
  platformQuestion: 'Platform(ios/android/harmony):',
  createAppSuccess: 'App created successfully (id: {{id}})',
  cancelled: 'Cancelled',
  operationSuccess: 'Operation successful',
  failedToParseUpdateJson: 'Failed to parse file `update.json`. Try to remove it manually.',
  ppkPackageGenerated: 'ppk package generated and saved to: {{- output}}',
  Message: 'Welcome to Cresc hot update service, {{name}}.',
  loggedOut: 'Logged out',
  usageUnderDevelopment: 'Usage is under development now.',
  hermesDisabled: 'Hermes disabled',
  hermesEnabled: 'Hermes enabled, now compiling to hermes bytecode:\n',
  runningHermesc: 'Running hermesc: {{command}} {{args}}',
  composingSourceMap: 'Composing source map',
  copyingDebugId: 'Copying debugid',
  sentryCliNotFound: 'Cannot find Sentry CLI tool, please make sure @sentry/cli is properly installed',
  sentryReleaseCreated: 'Sentry release created for version: {{version}}',
  uploadingSourcemap: 'Uploading sourcemap',
  packing: 'Packing',
  deletingFile: 'Delete {{file}}',
  bundlingWithRN: 'Bundling with react-native: {{version}}',
  fileGenerated: '{{file}} generated.',
  processingError: 'Error processing file: {{error}}',
  usageDiff: 'Usage: pushy {{command}} <origin> <next>',
  pluginDetected: 'detected {{name}} plugin',
  pluginDetectionError: 'error while detecting {{name}} plugin: {{error}}',
  addedToGitignore: 'Added {{line}} to .gitignore',
  processingStringPool: 'Processing the string pool ...',
  processingPackage: 'Processing the package {{count}} ...',
  typeStrings: 'Type strings:',
  keyStrings: 'Key strings:',
  failedToParseIcon: '[Warning] failed to parse icon: {{error}}',
  errorInHarmonyApp: 'Error in getEntryFromHarmonyApp: {{error}}',
  totalPackages: 'Total {{count}} packages',
  usageUploadIpa: 'Usage: pushy uploadIpa <ipa file>',
  usageUploadApk: 'Usage: pushy uploadApk <apk file>',
  usageUploadApp: 'Usage: pushy uploadApp <app file>',
  usageParseApp: 'Usage: pushy parseApp <app file>',
  usageParseIpa: 'Usage: pushy parseIpa <ipa file>',
  usageParseApk: 'Usage: pushy parseApk <apk file>',
  offset: 'Offset {{offset}}',
  packageUploadSuccess: 'Successfully uploaded new hot update package (id: {{id}})',
  rolloutRangeError: 'rollout must be an integer between 1-100',
  nativeVersionNotFound: 'No native version found >= {{version}}',
  nativeVersionNotFoundLess: 'No native version found <= {{version}}',
  nativeVersionNotFoundMatch: 'No matching native version found: {{version}}',
  packageIdRequired: 'Please provide packageId or packageVersion parameter',
  operationComplete: 'Operation complete, bound to {{count}} native versions',
  platformRequired: 'Platform must be specified.',
  bundleCommandError: '"react-native bundle" command exited with code {{code}}.',
  copyHarmonyBundleError: 'Error copying Harmony bundle: {{error}}',
  copyFileFailed: 'Failed to copy file: {{error}}',
  deleteFile: 'Delete {{file}}',
  rolloutConfigSet: 'Set {{rollout}}% rollout for version {{version}} on native version(s) {{versions}}',
  versionBind: 'Bound version {{version}} to native version {{nativeVersion}} (id: {{id}})',
};
