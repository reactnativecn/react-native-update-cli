export default {
  addedToGitignore: 'Added {{line}} to .gitignore',
  androidCrunchPngsWarning:
    'The crunchPngs option of android seems not disabled (Please ignore this warning if already disabled), which may cause abnormal consumption of mobile network traffic. Please refer to https://cresc.dev/docs/getting-started#disable-crunchpngs-on-android \n',
  appId: 'App ID',
  appIdMismatchApk:
    'App ID mismatch! Current APK: {{appIdInPkg}}, current update.json: {{appId}}',
  appIdMismatchApp:
    'App ID mismatch! Current APP: {{appIdInPkg}}, current update.json: {{appId}}',
  appIdMismatchIpa:
    'App ID mismatch! Current IPA: {{appIdInPkg}}, current update.json: {{appId}}',
  appKeyMismatchApk:
    'App Key mismatch! Current APK: {{appKeyInPkg}}, current update.json: {{appKey}}',
  appKeyMismatchApp:
    'App Key mismatch! Current APP: {{appKeyInPkg}}, current update.json: {{appKey}}',
  appKeyMismatchIpa:
    'App Key mismatch! Current IPA: {{appKeyInPkg}}, current update.json: {{appKey}}',
  appName: 'App Name',
  appNameQuestion: 'App Name:',
  appNotSelected:
    'App not selected. run `cresc selectApp --platform {{platform}}` first!',
  appUploadSuccess:
    'Successfully uploaded APP native package (id: {{id}}, version: {{version}}, buildTime: {{buildTime}})',
  apkUploadSuccess:
    'Successfully uploaded APK native package (id: {{id}}, version: {{version}}, buildTime: {{buildTime}})',
  boundTo: ', bound to: {{name}} ({{id}})',
  buildTimeNotFound:
    'Cannot get the build timestamp of this package. Please update `react-native-update` to the latest version and re-package and upload.',
  bundleCommandError:
    '"react-native bundle" command exited with code {{code}}.',
  bundleNotFound:
    'Bundle file not found. Please ensure that this {{packageType}} is a release version and the bundle file name is the default `{{entryFile}}`',
  bundlingWithRN: 'Bundling with react-native: {{version}}',
  cancelled: 'Cancelled',
  composingSourceMap: 'Composing source map',
  copyFileFailed: 'Failed to copy file: {{error}}',
  copyHarmonyBundleError: 'Error copying Harmony bundle: {{error}}',
  copyingDebugId: 'Copying debugid',
  createAppSuccess: 'App created successfully (id: {{id}})',
  deleteFile: 'Delete {{- file}}',
  deletingFile: 'Delete {{- file}}',
  enterAppIdQuestion: 'Enter AppId:',
  enterNativePackageId: 'Enter native package ID:',
  errorInHarmonyApp: 'Error in getEntryFromHarmonyApp: {{error}}',
  expiredStatus: '(Expired)',
  failedToParseIcon: '[Warning] failed to parse icon: {{error}}',
  failedToParseUpdateJson:
    'Failed to parse file `update.json`. Try to remove it manually.',
  fileGenerated: '{{- file}} generated.',
  fileSizeExceeded:
    'This file size is {{fileSize}} , exceeding the current quota {{maxSize}} . You may consider upgrading to a higher plan to increase this quota. Details can be found at: {{pricingPageUrl}}',
  hermesDisabled: 'Hermes disabled',
  hermesEnabledCompiling: 'Hermes enabled, now compiling to hermes bytecode:\n',
  ipaUploadSuccess:
    'Successfully uploaded IPA native package (id: {{id}}, version: {{version}}, buildTime: {{buildTime}})',
  keyStrings: 'Key strings:',
  latestVersionTag: '(latest: {{version}})',
  lockBestPractice: `
Best practices for lock files:
1. All members of the development team should use the same package manager to maintain a single lock file.
2. Add the lock file to version control (but do not commit multiple lock files of different formats).
3. Pay attention to changes in the lock file during code review.
This can reduce the risk of inconsistent dependencies and supply chain attacks.
`,
  lockNotFound:
    'No lock file detected, which may cause inconsistent dependencies and hot-updating issues.',
  loggedOut: 'Logged out',
  loginExpired:
    'Login information has expired. Please use `cresc login` command to re-login',
  loginFirst:
    'Not logged in.\nPlease run `cresc login` in the project directory to login.',
  multipleLocksFound:
    'Multiple lock files detected ({{- lockFiles}}), which may cause inconsistent dependencies and hot-updating issues.',
  nativePackageId: 'Native Package ID',
  nativeVersion: 'Native Version',
  nativeVersionNotFound: 'No native version found >= {{version}}',
  nativeVersionNotFoundLess: 'No native version found <= {{version}}',
  nativeVersionNotFoundMatch: 'No matching native version found: {{version}}',
  offset: 'Offset {{offset}}',
  operationComplete: 'Operation complete, bound to {{count}} native versions',
  operationSuccess: 'Operation successful',
  packageIdRequired: 'Please provide packageId or packageVersion parameter',
  packageUploadSuccess:
    'Successfully uploaded new hot update package (id: {{id}})',
  packing: 'Packing',
  pausedStatus: '(Paused)',
  platform: 'Platform',
  platformPrompt: 'Platform (ios/android/harmony):',
  platformQuestion: 'Platform(ios/android/harmony):',
  platformRequired: 'Platform must be specified.',
  pluginDetectionError: 'error while detecting {{name}} plugin: {{error}}',
  pluginDetected: 'detected {{name}} plugin',
  ppkPackageGenerated: 'ppk package generated and saved to: {{- output}}',
  processingError: 'Error processing file: {{error}}',
  processingPackage: 'Processing the package {{count}} ...',
  processingStringPool: 'Processing the string pool ...',
  publishUsage:
    'Usage: pushy publish <ppk file> --platform ios|android|harmony',
  rnuVersionNotFound:
    'react-native-update: Cannot get the version number. Please run the command in the project directory',
  rolloutConfigSet:
    'Set {{rollout}}% rollout for version {{version}} on native version(s) {{versions}}',
  rolloutRangeError: 'rollout must be an integer between 1-100',
  runningHermesc: 'Running hermesc: {{- command}} {{- args}}',
  sentryCliNotFound:
    'Cannot find Sentry CLI tool, please make sure @sentry/cli is properly installed',
  sentryReleaseCreated: 'Sentry release created for version: {{version}}',
  totalApps: 'Total {{count}} {{platform}} apps',
  totalPackages: 'Total {{count}} packages',
  typeStrings: 'Type strings:',
  unsupportedPlatform: 'Unsupported platform `{{platform}}`',
  uploadBundlePrompt: 'Upload this bundle now?(Y/N)',
  uploadingSourcemap: 'Uploading sourcemap',
  usageDiff: 'Usage: cresc {{command}} <origin> <next>',
  usageParseApk: 'Usage: cresc parseApk <apk file>',
  usageParseApp: 'Usage: cresc parseApp <app file>',
  usageParseIpa: 'Usage: cresc parseIpa <ipa file>',
  usageUnderDevelopment: 'Usage is under development now.',
  usageUploadApk: 'Usage: cresc uploadApk <apk file>',
  usageUploadApp: 'Usage: cresc uploadApp <app file>',
  usageUploadIpa: 'Usage: cresc uploadIpa <ipa file>',
  versionBind:
    'Bound version {{version}} to native version {{nativeVersion}} (id: {{id}})',
  welcomeMessage: 'Welcome to Cresc hot update service, {{name}}.',
};
