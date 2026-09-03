#!/usr/bin/env python3
from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one match, found {count}")
    file.write_text(text.replace(old, new, 1), encoding="utf-8")


def replace_all(path: str, old: str, new: str, expected: int) -> None:
    file = Path(path)
    text = file.read_text(encoding="utf-8")
    count = text.count(old)
    if count != expected:
        raise RuntimeError(f"{path}: expected {expected} matches, found {count}")
    file.write_text(text.replace(old, new), encoding="utf-8")


replace_once(
    "src/bundle-runner.ts",
    """type IosJavaScriptEngine = 'hermes' | 'jsc';

/**
 * Read explicit iOS engine configuration. An explicit JSC/disabled-Hermes
""",
    """type IosJavaScriptEngine = 'hermes' | 'jsc';

/** Remove Ruby comments without treating a # inside a quoted string as one. */
function stripRubyComments(source: string): string {
  return source
    .split(/\\r?\\n/)
    .map((line) => {
      let quote: "'" | '"' | undefined;
      let escaped = false;
      for (let index = 0; index < line.length; index++) {
        const char = line[index];
        if (escaped) {
          escaped = false;
          continue;
        }
        if (quote) {
          if (char === '\\\\') {
            escaped = true;
          } else if (char === quote) {
            quote = undefined;
          }
          continue;
        }
        if (char === "'" || char === '"') {
          quote = char;
        } else if (char === '#') {
          return line.slice(0, index);
        }
      }
      return line;
    })
    .join('\\n');
}

/**
 * Read explicit iOS engine configuration. An explicit JSC/disabled-Hermes
""",
)

replace_once(
    "src/bundle-runner.ts",
    """  } catch {
    // no Podfile
  }
  const envValue = (name: string) =>
""",
    """  } catch {
    // no Podfile
  }
  const activePodfile = stripRubyComments(podfile);
  const envValue = (name: string) =>
""",
)

replace_all(
    "src/bundle-runner.ts",
    ".exec(podfile)?.[1]",
    ".exec(activePodfile)?.[1]",
    2,
)

replace_once(
    "src/app.ts",
    """  const app = (await get(`/app/${appId}`)) as {
    platform?: Platform;
    appKey: string;
  };
  if (app.platform && app.platform !== platform) {
    throw new Error(
      t('appPlatformMismatch', { appId, appPlatform: app.platform, platform }),
    );
  }
  return app;
""",
    """  const app = (await get(`/app/${appId}`)) as {
    platform?: Platform;
    appKey?: unknown;
  };
  if (app.platform && app.platform !== platform) {
    throw new Error(
      t('appPlatformMismatch', { appId, appPlatform: app.platform, platform }),
    );
  }
  if (typeof app.appKey !== 'string' || !app.appKey) {
    throw new Error(t('appKeyMissing', { appId }));
  }
  return { ...app, appKey: app.appKey };
""",
)

replace_once(
    "src/locales/en.ts",
    """  unsafeIntermediateDir:
    'Refusing to empty {{- dir}} as the intermediate directory: it resolves to a protected or symbolic-link location. Point --intermediaDir at a dedicated build directory.',
  errorStackHint: '(set RNU_DEBUG=1 to print the stack trace)',
""",
    """  unsafeIntermediateDir:
    'Refusing to empty {{- dir}} as the intermediate directory: it resolves to a protected or symbolic-link location. Point --intermediaDir at a dedicated build directory.',
  appKeyMissing: 'App {{appId}} did not return a valid app key.',
  errorStackHint: '(set RNU_DEBUG=1 to print the stack trace)',
""",
)

replace_once(
    "src/locales/zh.ts",
    """  unsafeIntermediateDir:
    '拒绝清空中间目录 {{- dir}}：该路径指向受保护目录或包含符号链接。请用 --intermediaDir 指定一个专用的构建目录。',
  errorStackHint: '（设置 RNU_DEBUG=1 可打印完整堆栈）',
""",
    """  unsafeIntermediateDir:
    '拒绝清空中间目录 {{- dir}}：该路径指向受保护目录或包含符号链接。请用 --intermediaDir 指定一个专用的构建目录。',
  appKeyMissing: '应用 {{appId}} 未返回有效的 appKey。',
  errorStackHint: '（设置 RNU_DEBUG=1 可打印完整堆栈）',
""",
)

replace_once(
    "scripts/smoke-lib.js",
    """function runCli(args) {
  const result = spawnSync(
""",
    """const CLI_TIMEOUT_MS = 10_000;

function runCli(args) {
  const result = spawnSync(
""",
)

replace_once(
    "scripts/smoke-lib.js",
    """      encoding: 'utf8',
      env: { ...process.env, NO_INTERACTIVE: 'true', RNU_AUTO_UPDATE: '0' },
    },
  );
  const command = `pushy ${args.join(' ')}`;
  if (result.status !== 0) {
""",
    """      encoding: 'utf8',
      env: { ...process.env, NO_INTERACTIVE: 'true', RNU_AUTO_UPDATE: '0' },
      timeout: CLI_TIMEOUT_MS,
    },
  );
  const command = `pushy ${args.join(' ')}`;
  if (result.error) {
    if (result.error.code === 'ETIMEDOUT') {
      throw new Error(
        `${command} timed out after ${CLI_TIMEOUT_MS / 1000} seconds`,
      );
    }
    throw result.error;
  }
  if (result.status !== 0) {
""",
)

replace_once(
    "tests/bundle-runner.test.ts",
    """  test('ios: explicit Podfile Hermes configuration works without installed pods', () => {
""",
    """  test('ios: ignores commented-out Podfile engine settings', () => {
    const root = project();
    const ios = path.join(root, 'ios');
    fs.mkdirSync(path.join(ios, 'Pods', 'hermes-engine'), { recursive: true });
    _writeFile(
      path.join(ios, 'Podfile'),
      [
        "# ENV['USE_HERMES'] = '0'",
        "# ENV['USE_THIRD_PARTY_JSC'] = '1'",
        '# use_react_native!(:hermes_enabled => false)',
        'source "https://example.com/#pods"',
      ].join('\\n'),
    );
    expect(detectIosHermes(root)).toBe(true);

    _writeFile(
      path.join(ios, 'Podfile'),
      [
        "ENV['USE_HERMES'] = '1'",
        "# ENV['USE_THIRD_PARTY_JSC'] = '1'",
      ].join('\\n'),
    );
    expect(detectIosHermes(root)).toBe(true);
  });

  test('ios: explicit Podfile Hermes configuration works without installed pods', () => {
""",
)

replace_once(
    "tests/app.test.ts",
    """  test('selectApp rejects an app belonging to another platform', async () => {
""",
    """  test('selectApp rejects a response without an app key', async () => {
    const getSpy = spyOn(api, 'get').mockResolvedValue({ platform: 'ios' });
    const writeFileSpy = spyOn(fs.promises, 'writeFile').mockResolvedValue();
    try {
      await expect(
        getAppCommands().selectApp({
          args: ['12'],
          options: { platform: 'ios' },
        }),
      ).rejects.toThrow();
      expect(writeFileSpy).not.toHaveBeenCalled();
    } finally {
      getSpy.mockRestore();
      writeFileSpy.mockRestore();
    }
  });

  test('selectApp rejects an app belonging to another platform', async () => {
""",
)
