import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  resolveAndroidSentryReleaseAndDist,
  resolveSentryReleaseAndDist,
} from '../src/utils/sentry-release';

function mkTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

describe('resolveAndroidSentryReleaseAndDist', () => {
  let tempRoot = '';

  beforeEach(() => {
    tempRoot = mkTempDir('rn-update-sentry-release-');
  });

  afterEach(() => {
    if (tempRoot && fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('resolves native release and dist from Android defaultConfig', async () => {
    writeFile(
      path.join(tempRoot, 'android/app/build.gradle'),
      `
android {
  defaultConfig {
    applicationId "com.example.app"
    versionName "1.2.3"
    versionCode 42
  }
}
`,
    );

    await expect(
      resolveAndroidSentryReleaseAndDist({ projectRoot: tempRoot }),
    ).resolves.toEqual({
      release: 'com.example.app@1.2.3+42',
      dist: '42',
    });
  });

  test('applies flavor and release build type overrides', async () => {
    writeFile(
      path.join(tempRoot, 'android/app/build.gradle'),
      `
android {
  defaultConfig {
    applicationId "com.example.app"
    versionName "1.2.3"
    versionCode 42
  }
  productFlavors {
    dev {
      applicationIdSuffix ".dev"
      versionNameSuffix "-dev"
      versionCode 43
    }
  }
  buildTypes {
    release {
      applicationIdSuffix ".release"
      versionNameSuffix "-release"
    }
  }
}
`,
    );

    await expect(
      resolveAndroidSentryReleaseAndDist({
        projectRoot: tempRoot,
        flavor: 'devRelease',
      }),
    ).resolves.toEqual({
      release: 'com.example.app.dev.release@1.2.3-dev-release+43',
      dist: '43',
    });
  });

  test('resolves rootProject.ext and gradle.properties references', async () => {
    writeFile(
      path.join(tempRoot, 'android/build.gradle'),
      `
buildscript {
  ext {
    appVersionName = "2.0.0"
  }
}
`,
    );
    writeFile(path.join(tempRoot, 'android/gradle.properties'), 'CODE=77\n');
    writeFile(
      path.join(tempRoot, 'android/app/build.gradle'),
      `
android {
  namespace "com.example.namespace"
  defaultConfig {
    versionName rootProject.ext.appVersionName
    versionCode CODE
  }
}
`,
    );

    await expect(
      resolveAndroidSentryReleaseAndDist({ projectRoot: tempRoot }),
    ).resolves.toEqual({
      release: 'com.example.namespace@2.0.0+77',
      dist: '77',
    });
  });

  test('uses dist override in both release build metadata and dist', async () => {
    writeFile(
      path.join(tempRoot, 'android/app/build.gradle'),
      `
android {
  defaultConfig {
    applicationId "com.example.app"
    versionName "1.2.3"
    versionCode 42
  }
}
`,
    );

    await expect(
      resolveAndroidSentryReleaseAndDist({
        projectRoot: tempRoot,
        dist: '100',
      }),
    ).resolves.toEqual({
      release: 'com.example.app@1.2.3+100',
      dist: '100',
    });
  });
});

describe('resolveSentryReleaseAndDist', () => {
  let tempRoot = '';
  let originalEnv: NodeJS.ProcessEnv;
  let warnSpy: ReturnType<typeof spyOn>;
  let logSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    tempRoot = mkTempDir('rn-update-sentry-resolution-');
    originalEnv = { ...process.env };
    warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    logSpy = spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = originalEnv;
    warnSpy.mockRestore();
    logSpy.mockRestore();
    if (tempRoot && fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('prefers explicit release and dist options', async () => {
    await expect(
      resolveSentryReleaseAndDist(
        'android',
        'pushy-v1',
        {
          sentryRelease: 'com.example@1.0.0+1',
          sentryDist: '1',
        },
        tempRoot,
      ),
    ).resolves.toEqual({
      release: 'com.example@1.0.0+1',
      dist: '1',
    });
  });

  test('falls back to Pushy version when native metadata cannot be resolved', async () => {
    await expect(
      resolveSentryReleaseAndDist('android', 'pushy-v1', {}, tempRoot),
    ).resolves.toEqual({
      release: 'pushy-v1',
      dist: undefined,
    });
    expect(warnSpy).toHaveBeenCalled();
  });

  test('uses Android metadata and environment dist override', async () => {
    process.env.SENTRY_DIST = '9';
    writeFile(
      path.join(tempRoot, 'android/app/build.gradle'),
      `
android {
  defaultConfig {
    applicationId "com.example.app"
    versionName "1.2.3"
    versionCode 42
  }
}
`,
    );

    await expect(
      resolveSentryReleaseAndDist('android', 'pushy-v1', {}, tempRoot),
    ).resolves.toEqual({
      release: 'com.example.app@1.2.3+9',
      dist: '9',
    });
  });
});
