const fs = require('fs');
const path = require('path');

export function checkXcodeScript() {
  try {
    const iosPath = path.join(process.cwd(), 'ios');
    const projects = fs.readdirSync(iosPath)
      .filter(file => file.endsWith('.xcodeproj'));
    if (projects.length === 0) {
      throw new Error('找不到 .xcodeproj 文件');
    }
    const projectPath = path.join(iosPath, projects[0], 'project.pbxproj');
    const content = fs.readFileSync(projectPath, 'utf8');
    const hasSentryScript = content.includes('sentry-xcode.sh');

    console.log(`是否包含 sentry-xcode.sh: ${hasSentryScript}`);
    return hasSentryScript;
  } catch (error) {
    console.error('读取文件失败:', error);
    return false;
  }
}


export function checkAndroidStudioScript() {
  try {
    const androidAppPath = path.join(process.cwd(), 'android', 'app');
    const buildGradlePath = path.join(androidAppPath, 'build.gradle');
    
    const content = fs.readFileSync(buildGradlePath, 'utf8');
    const hasSentryGradle = content.includes('@sentry/react-native/package.json');

    console.log(`是否包含 sentry.gradle: ${hasSentryGradle}`);
    return hasSentryGradle;
  } catch (error) {
    console.error('读取文件失败:', error);
    return false;
  }
}
