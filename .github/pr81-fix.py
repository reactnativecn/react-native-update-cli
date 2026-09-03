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
    "src/utils/index.ts",
    """export function isNonInteractive() {
  const envValue = process.env.NO_INTERACTIVE?.toLowerCase();
  return (
    global.NO_INTERACTIVE === true || envValue === 'true' || envValue === '1'
  );
}
""",
    """/** True when prompts cannot or must not be shown. */
export function isNonInteractive(
  env: NodeJS.ProcessEnv = process.env,
  stdinIsTTY: boolean | undefined = process.stdin.isTTY,
  globalFlag: boolean | undefined = global.NO_INTERACTIVE,
) {
  const envValue = env.NO_INTERACTIVE?.toLowerCase();
  return (
    globalFlag === true ||
    envValue === 'true' ||
    envValue === '1' ||
    stdinIsTTY !== true
  );
}
""",
)

replace_once(
    "src/app.ts",
    """export function assertPlatform(platform: string): Platform {
  if (platform !== 'ios' && platform !== 'android' && platform !== 'harmony') {
    throw new Error(t('unsupportedPlatform', { platform }));
  }
  return platform as Platform;
}

/** Read the selected app for a platform from the requested config file. */
""",
    """export function assertPlatform(platform: string): Platform {
  if (platform !== 'ios' && platform !== 'android' && platform !== 'harmony') {
    throw new Error(t('unsupportedPlatform', { platform }));
  }
  return platform as Platform;
}

/** Parse a complete positive integer ID without parseInt-style truncation. */
function parsePositiveIntegerId(value: string): number {
  const id = Number(value);
  if (!/^[1-9]\\d*$/.test(value) || !Number.isSafeInteger(id)) {
    throw new Error(t('invalidId', { id: value }));
  }
  return id;
}

/** Read the selected app for a platform from the requested config file. */
""",
)

replace_once(
    "src/app.ts",
    """async function assertAppPlatform(appId: string, platform: Platform) {
  const app = (await get(`/app/${appId}`)) as { platform?: Platform };
  if (app.platform && app.platform !== platform) {
    throw new Error(
      t('appPlatformMismatch', { appId, appPlatform: app.platform, platform }),
    );
  }
}
""",
    """async function assertAppPlatform(appId: string, platform: Platform) {
  const app = (await get(`/app/${appId}`)) as {
    platform?: Platform;
    appKey?: string;
  };
  if (app.platform && app.platform !== platform) {
    throw new Error(
      t('appPlatformMismatch', { appId, appPlatform: app.platform, platform }),
    );
  }
  return app;
}
""",
)

replace_once(
    "src/app.ts",
    """  if (options.appId) {
    const appId = String(options.appId);
    if (options.platform) {
      await assertAppPlatform(appId, options.platform);
    }
    return appId;
  }
""",
    """  if (options.appId) {
    const appId = String(parsePositiveIntegerId(String(options.appId)));
    if (options.platform) {
      await assertAppPlatform(appId, options.platform);
    }
    return appId;
  }
""",
)

replace_once(
    "src/app.ts",
    """export async function chooseApp(platform: Platform) {
  const list = await listApp(platform);
  // without a terminal `question` answers '' and no app has that id: the
  // loop below would never end
  if (isNonInteractive()) {
    throw new Error(t('appIdRequired'));
  }

  while (true) {
""",
    """export async function chooseApp(platform: Platform) {
  // Fail before a network request or table output when no prompt is possible.
  if (isNonInteractive()) {
    throw new Error(t('appIdRequired'));
  }
  const list = await listApp(platform);

  while (true) {
""",
)

replace_once(
    "src/app.ts",
    """  const platform = await getPlatform(options.platform);
  const id = args[0]
    ? Number.parseInt(args[0], 10)
    : (await chooseApp(platform)).id;
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(t('invalidId', { id: args[0] }));
  }

  const configPath = options.config || updateJson;
""",
    """  const platform = await getPlatform(options.platform);
  const id = args[0]
    ? parsePositiveIntegerId(args[0])
    : (await chooseApp(platform)).id;
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error(t('invalidId', { id: args[0] }));
  }
  const { appKey } = await assertAppPlatform(String(id), platform);

  const configPath = options.config || updateJson;
""",
)

replace_once(
    "src/app.ts",
    """  const { appKey } = await get(`/app/${id}`);
  updateInfo[platform] = {
""",
    """  updateInfo[platform] = {
""",
)

replace_once(
    "src/app.ts",
    """      const { platform } = options;
      const id = args[0] || (await chooseApp(platform)).id;
      if (!id) {
""",
    """      const { platform } = options;
      const id = args[0]
        ? parsePositiveIntegerId(args[0])
        : (await chooseApp(platform)).id;
      if (!id) {
""",
)

replace_once(
    "src/package.ts",
    """export async function choosePackage(appId: string, packages?: Package[]) {
  const list = await listPackage(appId, packages);
  // without a terminal `question` answers '' and no package has that id: the
  // loop below would never end
  if (isNonInteractive()) {
    throw new Error(t('packageIdRequired'));
  }
  const packageMap = new Map(list?.map((v) => [v.id.toString(), v]));
""",
    """export async function choosePackage(appId: string, packages?: Package[]) {
  // Fail before fetching or rendering the package list when no prompt exists.
  if (isNonInteractive()) {
    throw new Error(t('packageIdRequired'));
  }
  const list = await listPackage(appId, packages);
  const packageMap = new Map(list?.map((v) => [v.id.toString(), v]));
""",
)

replace_once(
    "src/bundle-runner.ts",
    """  assertSafeToEmpty(outputFolder);
  fs.emptyDirSync(outputFolder);
""",
    """  outputFolder = assertSafeToEmpty(outputFolder);
  fs.emptyDirSync(outputFolder);
""",
)

replace_once(
    "src/bundle-runner.ts",
    """/**
 * The intermediate directory is emptied before every bundle. Refuse to do that
 * to the project itself (`--intermediaDir .`), to anything above it, to the
 * home directory or to the filesystem root: one typo must not wipe a working
 * tree.
 */
export function assertSafeToEmpty(dir: string, cwd = process.cwd()): void {
  const target = path.resolve(cwd, dir);
  const contains = (parent: string, child: string) => {
    const relative = path.relative(parent, child);
    return (
      relative === '' ||
      (!relative.startsWith('..') && !path.isAbsolute(relative))
    );
  };
  if (
    target === path.parse(target).root ||
    target === path.resolve(os.homedir()) ||
    contains(target, path.resolve(cwd))
  ) {
    throw new Error(t('unsafeIntermediateDir', { dir: target }));
  }
}
""",
    """/**
 * Validate the intermediate directory before it is emptied and return the
 * canonical path that was validated. The caller must use this returned path:
 * validating one spelling and deleting through another re-opens symlink
 * redirection.
 */
export function assertSafeToEmpty(dir: string, cwd = process.cwd()): string {
  const requested = path.resolve(cwd, dir);
  const lexicalCwd = path.resolve(cwd);
  const lexicalHome = path.resolve(os.homedir());
  const lexicalTmp = path.resolve(os.tmpdir());

  const contains = (parent: string, child: string) => {
    const relative = path.relative(parent, child);
    return (
      relative === '' ||
      (!relative.startsWith('..') && !path.isAbsolute(relative))
    );
  };
  const samePath = (left: string, right: string) => {
    const normalize = (value: string) => {
      const resolved = path.resolve(value);
      return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    };
    return normalize(left) === normalize(right);
  };
  const reject = (target: string): never => {
    throw new Error(t('unsafeIntermediateDir', { dir: target }));
  };
  const validate = (
    target: string,
    projectRoot: string,
    home: string,
    tmpRoot: string,
  ) => {
    // Reject each protected directory and all of its ancestors.
    for (const protectedPath of [
      path.parse(target).root,
      projectRoot,
      home,
      tmpRoot,
    ]) {
      if (contains(target, protectedPath)) reject(target);
    }
    // Never allow build cleanup inside source-control metadata.
    for (const metadata of ['.git', '.hg', '.svn']) {
      if (contains(path.join(projectRoot, metadata), target)) reject(target);
    }
  };

  validate(requested, lexicalCwd, lexicalHome, lexicalTmp);

  // A final-component symlink is the direct dangerous case: emptyDirSync would
  // enumerate and remove entries from its target rather than removing the link.
  if (
    fs.existsSync(requested) &&
    fs.lstatSync(requested).isSymbolicLink()
  ) {
    reject(requested);
  }

  // emptyDirSync creates a missing directory too; create it first so it can be
  // canonicalized and the exact validated path can be passed to deletion.
  fs.ensureDirSync(requested);
  const canonical = (value: string) => fs.realpathSync.native(value);
  const target = canonical(requested);
  const canonicalCwd = canonical(lexicalCwd);
  const canonicalHome = canonical(lexicalHome);
  const canonicalTmp = canonical(lexicalTmp);

  validate(target, canonicalCwd, canonicalHome, canonicalTmp);

  // Reject a symlink in any component below a known safe base. System aliases
  // such as macOS /var -> /private/var remain valid because the base itself is
  // canonicalized before the relative suffix is appended.
  for (const [lexicalBase, canonicalBase] of [
    [lexicalCwd, canonicalCwd],
    [lexicalHome, canonicalHome],
    [lexicalTmp, canonicalTmp],
  ] as const) {
    const relative = path.relative(lexicalBase, requested);
    if (
      relative === '' ||
      (!relative.startsWith('..') && !path.isAbsolute(relative))
    ) {
      if (!samePath(path.resolve(canonicalBase, relative), target)) {
        reject(target);
      }
      break;
    }
  }

  return target;
}
""",
)

replace_once(
    "src/bundle-runner.ts",
    """/** Hermes on iOS: installed pod, Expo's engine property, or the lockfile. */
export function detectIosHermes(projectRoot: string): boolean {
  const ios = path.join(projectRoot, 'ios');
  if (fs.existsSync(path.join(ios, 'Pods', 'hermes-engine'))) {
    return true;
  }
  // Expo prebuild records the engine here, whether or not Pods are installed
  try {
    const engine = JSON.parse(
      fs.readFileSync(path.join(ios, 'Podfile.properties.json'), 'utf8'),
    )?.['expo.jsEngine'];
    if (engine === 'hermes') return true;
    if (engine === 'jsc') return false;
  } catch {
    // no Expo properties file
  }
  // no Pods checkout (CI without `pod install`): the lockfile still lists it
  try {
    const lock = fs.readFileSync(path.join(ios, 'Podfile.lock'), 'utf8');
    if (/^\\s*-\\s+hermes-engine\\b/m.test(lock)) return true;
  } catch {
    // no lockfile either
  }
  return false;
}
""",
    """type IosJavaScriptEngine = 'hermes' | 'jsc';

/**
 * Read explicit iOS engine configuration. An explicit JSC/disabled-Hermes
 * setting wins over installed pods because CocoaPods may still fetch the
 * hermes-engine dependency for a JSC build.
 */
function configuredIosEngine(ios: string): IosJavaScriptEngine | undefined {
  let expoEngine: IosJavaScriptEngine | undefined;
  try {
    const value = JSON.parse(
      fs.readFileSync(path.join(ios, 'Podfile.properties.json'), 'utf8'),
    )?.['expo.jsEngine'];
    if (value === 'hermes' || value === 'jsc') expoEngine = value;
  } catch {
    // no Expo properties file
  }

  let podfile = '';
  try {
    podfile = fs.readFileSync(path.join(ios, 'Podfile'), 'utf8');
  } catch {
    // no Podfile
  }
  const envValue = (name: string) =>
    new RegExp(
      `ENV\\\\s*\\\\[\\\\s*['"]${name}['"]\\\\s*\\\\]\\\\s*(?:\\\\|\\\\|=|=)\\\\s*['"]([^'"]+)['"]`,
      'i',
    ).exec(podfile)?.[1]?.toLowerCase();
  const useHermes = envValue('USE_HERMES');
  const useThirdPartyJsc = envValue('USE_THIRD_PARTY_JSC');
  const hermesOption =
    /(?:^|[,(]\\s*)(?::hermes_enabled\\s*=>|hermes_enabled\\s*:)\\s*(true|false)\\b/im
      .exec(podfile)?.[1]
      ?.toLowerCase();

  if (
    useThirdPartyJsc === '1' ||
    useThirdPartyJsc === 'true' ||
    useHermes === '0' ||
    useHermes === 'false' ||
    hermesOption === 'false' ||
    expoEngine === 'jsc'
  ) {
    return 'jsc';
  }
  if (
    useHermes === '1' ||
    useHermes === 'true' ||
    hermesOption === 'true' ||
    expoEngine === 'hermes'
  ) {
    return 'hermes';
  }
  return undefined;
}

/** Hermes on iOS: explicit configuration first, installed artifacts second. */
export function detectIosHermes(projectRoot: string): boolean {
  const ios = path.join(projectRoot, 'ios');
  const configured = configuredIosEngine(ios);
  if (configured) return configured === 'hermes';

  if (fs.existsSync(path.join(ios, 'Pods', 'hermes-engine'))) {
    return true;
  }
  // CI may not have run pod install, so use the lockfile only as weak evidence.
  try {
    const lock = fs.readFileSync(path.join(ios, 'Podfile.lock'), 'utf8');
    if (/^\\s*-\\s+hermes-engine\\b/m.test(lock)) return true;
  } catch {
    // no lockfile either
  }
  return false;
}
""",
)

replace_once(
    "src/api.ts",
    """function createRequestError(
  error: unknown,
  requestUrl: string,
  status?: number,
) {
  const message =
    typeof error === 'string'
      ? error
      : error instanceof Error
        ? error.message
        : String(error);
  const requestError = new Error(`${message}\\nURL: ${requestUrl}`) as Error & {
    status?: number;
  };
  requestError.status = status;
  return requestError;
}
""",
    """/** Remove credentials, query signatures and fragments before logging a URL. */
export function redactRequestUrl(requestUrl: string): string {
  try {
    const parsed = new URL(requestUrl);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}${
      parsed.search ? '?<redacted>' : ''
    }`;
  } catch {
    const secretStart = requestUrl.search(/[?#]/);
    return secretStart < 0
      ? requestUrl
      : `${requestUrl.slice(0, secretStart)}?<redacted>`;
  }
}

function createRequestError(
  error: unknown,
  requestUrl: string,
  status?: number,
) {
  const message =
    typeof error === 'string'
      ? error
      : error instanceof Error
        ? error.message
        : String(error);
  const cause =
    error instanceof Error ||
    (typeof error === 'object' && error !== null)
      ? error
      : undefined;
  const requestError = new Error(
    `${message}\\nURL: ${redactRequestUrl(requestUrl)}`,
    cause === undefined ? undefined : { cause },
  ) as Error & {
    status?: number;
  };
  requestError.status = status;
  return requestError;
}
""",
)

replace_once(
    "src/api.ts",
    """function isProxyRelatedError(error: unknown): boolean {
  const msg =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : '';
  const lower = msg.toLowerCase();
  return PROXY_ERROR_PATTERNS.some((p) => lower.includes(p.toLowerCase()));
}
""",
    """function isProxyRelatedError(error: unknown): boolean {
  const seen = new Set<unknown>();
  const parts: string[] = [];
  let current = error;
  while (current !== undefined && current !== null && !seen.has(current)) {
    seen.add(current);
    if (current instanceof Error) {
      const code = (current as NodeJS.ErrnoException).code;
      parts.push(`${current.name} ${code ?? ''} ${current.message}`);
    } else {
      parts.push(String(current));
    }
    current =
      typeof current === 'object'
        ? (current as { cause?: unknown }).cause
        : undefined;
  }
  const lower = parts.join('\\n').toLowerCase();
  return PROXY_ERROR_PATTERNS.some((p) => lower.includes(p.toLowerCase()));
}
""",
)

replace_once(
    "src/api.ts",
    """    if (isProxyRelatedError(error)) {
      throw new Error(
        `${baseError.message}\\n\\n${t('proxyNetworkError')}\\n${t('proxyNetworkErrorTips')}`,
      );
    }
""",
    """    if (isProxyRelatedError(error)) {
      throw new Error(
        `${baseError.message}\\n\\n${t('proxyNetworkError')}\\n${t('proxyNetworkErrorTips')}`,
        { cause: baseError },
      );
    }
""",
)

replace_once(
    "src/api.ts",
    """class UploadTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Upload timed out after ${Math.round(timeoutMs / 1000)}s`);
    this.name = 'UploadTimeoutError';
  }
}
""",
    """class UploadTimeoutError extends Error {
  readonly code = 'ETIMEDOUT';

  constructor(timeoutMs: number) {
    super(`Upload timed out after ${Math.round(timeoutMs / 1000)}s`);
    this.name = 'UploadTimeoutError';
  }
}
""",
)

replace_once(
    "src/api.ts",
    """  const rethrowUploadError = (error: unknown): never => {
    if (isProxyRelatedError(error)) {
      const rawMessage = error instanceof Error ? error.message : String(error);
      throw new Error(
        `${rawMessage}\\n\\n${t('proxyNetworkError')}\\n${t('proxyNetworkErrorTips')}`,
      );
    }
    throw createRequestError(error, realUrl);
  };
""",
    """  const rethrowUploadError = (error: unknown): never => {
    const baseError = createRequestError(error, realUrl);
    if (isProxyRelatedError(error)) {
      throw new Error(
        `${baseError.message}\\n\\n${t('proxyNetworkError')}\\n${t('proxyNetworkErrorTips')}`,
        { cause: baseError },
      );
    }
    throw baseError;
  };
""",
)

replace_once(
    "src/provider.ts",
    """          verifyHermesBase: options.verifyHermesBase ?? true,
          sentryRelease: options.sentryRelease,
""",
    """          verifyHermesBase: options.verifyHermesBase ?? true,
          resetCache: options.resetCache ?? true,
          sentryRelease: options.sentryRelease,
""",
)

replace_once(
    "src/provider.ts",
    """  async listPackages(appId?: string): Promise<CommandResult> {
    return this.runDataCommand(async () => {
      if (!appId) {
        throw new Error(t('appIdRequired'));
      }
      const { listPackage } = await import('./package');
      return listPackage(appId);
    }, 'Unknown error listing packages');
  }
""",
    """  async listPackages(appId: string): Promise<CommandResult> {
    return this.runDataCommand(async () => {
      if (!appId) {
        throw new Error(t('appIdRequired'));
      }
      const { listPackage } = await import('./package');
      return listPackage(appId);
    }, 'Unknown error listing packages');
  }
""",
)

replace_once(
    "src/types.ts",
    """  listPackages: (appId?: string) => Promise<CommandResult>;
""",
    """  listPackages: (appId: string) => Promise<CommandResult>;
""",
)

replace_all(
    "README.md",
    """  listPackages(appId?: string): Promise<CommandResult>;
""",
    """  listPackages(appId: string): Promise<CommandResult>;
""",
    1,
)

replace_all(
    "README.zh-CN.md",
    """  listPackages(appId?: string): Promise<CommandResult>;
""",
    """  listPackages(appId: string): Promise<CommandResult>;
""",
    1,
)

replace_once(
    "src/utils/dep-versions.ts",
    """let cached: Record<string, string> | undefined;
""",
    """let cachedCwd: string | undefined;
let cached: Record<string, string> | undefined;
""",
)

replace_once(
    "src/utils/dep-versions.ts",
    """function readDepVersions(): Record<string, string> {
  const versions: Record<string, string> = {};
  const cwd = process.cwd();
  const pkg = readProjectPackageJson(cwd);
""",
    """function readDepVersions(cwd: string): Record<string, string> {
  const versions: Record<string, string> = {};
  const pkg = readProjectPackageJson(cwd);
""",
)

replace_once(
    "src/utils/dep-versions.ts",
    """/** Installed versions of the cwd project's dependencies, keys sorted. */
export function getDepVersions(): Record<string, string> {
  if (!cached) {
    cached = readDepVersions();
  }
  return cached;
}
""",
    """/** Installed versions of the cwd project's dependencies, keys sorted. */
export function getDepVersions(): Record<string, string> {
  const cwd = path.resolve(process.cwd());
  if (!cached || cachedCwd !== cwd) {
    cached = readDepVersions(cwd);
    cachedCwd = cwd;
  }
  return cached;
}
""",
)

replace_once(
    "src/utils/dep-versions.ts",
    """export function getDepVersion(
  name: string,
  cwd = process.cwd(),
): string | undefined {
  if (cached && cwd === process.cwd()) {
    return cached[name];
  }
  const pkg = readProjectPackageJson(cwd);
""",
    """export function getDepVersion(
  name: string,
  cwd = process.cwd(),
): string | undefined {
  const resolvedCwd = path.resolve(cwd);
  if (cached && cachedCwd === resolvedCwd) {
    return cached[name];
  }
  const pkg = readProjectPackageJson(resolvedCwd);
""",
)

replace_once(
    "src/utils/dep-versions.ts",
    """  return readInstalledVersion(name, cwd);
}
""",
    """  return readInstalledVersion(name, resolvedCwd);
}
""",
)

replace_once(
    "src/locales/en.ts",
    """  unsafeIntermediateDir:
    'Refusing to empty {{- dir}} as the intermediate directory: it is the project directory (or above it). Point --intermediaDir at a dedicated build directory.',
""",
    """  unsafeIntermediateDir:
    'Refusing to empty {{- dir}} as the intermediate directory: it resolves to a protected or symbolic-link location. Point --intermediaDir at a dedicated build directory.',
""",
)

replace_once(
    "src/locales/zh.ts",
    """  unsafeIntermediateDir:
    '拒绝清空中间目录 {{- dir}}：它是项目目录本身（或其上级）。请用 --intermediaDir 指定一个专用的构建目录。',
""",
    """  unsafeIntermediateDir:
    '拒绝清空中间目录 {{- dir}}：该路径指向受保护目录或包含符号链接。请用 --intermediaDir 指定一个专用的构建目录。',
""",
)

replace_once(
    "tests/app.test.ts",
    """      // `question` answers '' without a terminal, which matches no app id
      await expect(chooseApp('ios')).rejects.toThrow();
    } finally {
""",
    """      await expect(chooseApp('ios')).rejects.toThrow();
      expect(getSpy).not.toHaveBeenCalled();
    } finally {
""",
)

replace_once(
    "tests/app.test.ts",
    """  test('selectApp rejects an app id that is not a positive integer', async () => {
    const getSpy = spyOn(api, 'get').mockRejectedValue(
      new Error('must not reach the server'),
    );
    try {
      await expect(
        getAppCommands().selectApp({
          args: ['abc'],
          options: { platform: 'ios' },
        }),
      ).rejects.toThrow(/abc/);
      expect(getSpy).not.toHaveBeenCalled();
    } finally {
      getSpy.mockRestore();
    }
  });
""",
    """  test('selectApp rejects malformed or non-positive app ids', async () => {
    const getSpy = spyOn(api, 'get').mockRejectedValue(
      new Error('must not reach the server'),
    );
    try {
      for (const id of ['abc', '12abc', '1.5', '12e3', '0', '-1']) {
        await expect(
          getAppCommands().selectApp({
            args: [id],
            options: { platform: 'ios' },
          }),
        ).rejects.toThrow();
      }
      expect(getSpy).not.toHaveBeenCalled();
    } finally {
      getSpy.mockRestore();
    }
  });

  test('selectApp rejects an app belonging to another platform', async () => {
    const getSpy = spyOn(api, 'get').mockResolvedValue({
      appKey: 'android-key',
      platform: 'android',
    });
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
""",
)

replace_once(
    "tests/package.test.ts",
    """      // `question` answers '' without a terminal, which matches no package id
      await expect(
        choosePackage('100', [{ id: 1, name: '1.0.0' }]),
      ).rejects.toThrow();
    } finally {
""",
    """      await expect(
        choosePackage('100', [{ id: 1, name: '1.0.0' }]),
      ).rejects.toThrow();
      expect(logSpy).not.toHaveBeenCalled();
    } finally {
""",
)

replace_once(
    "tests/bundle-runner.test.ts",
    """describe('assertSafeToEmpty', () => {
  const cwd = path.join(os.tmpdir(), 'rnu-project');

  test('allows a build directory inside or outside the project', () => {
    expect(() => assertSafeToEmpty('.pushy/intermedia/ios', cwd)).not.toThrow();
    expect(() =>
      assertSafeToEmpty(path.join(os.tmpdir(), 'elsewhere', 'build'), cwd),
    ).not.toThrow();
  });

  test('refuses the project directory, its ancestors, home and the root', () => {
    expect(() => assertSafeToEmpty('.', cwd)).toThrow();
    expect(() => assertSafeToEmpty('..', cwd)).toThrow();
    expect(() => assertSafeToEmpty(cwd, cwd)).toThrow();
    expect(() => assertSafeToEmpty(os.homedir(), cwd)).toThrow();
    expect(() => assertSafeToEmpty(path.parse(cwd).root, cwd)).toThrow();
  });
});
""",
    """describe('assertSafeToEmpty', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  function directory(prefix: string): string {
    const root = mkTempDir(prefix);
    roots.push(root);
    return root;
  }

  test('returns the canonical path for dedicated build directories', () => {
    const cwd = directory('rnu-safe-project-');
    const inside = path.join(cwd, '.pushy', 'intermedia', 'ios');
    expect(assertSafeToEmpty(inside, cwd)).toBe(
      fs.realpathSync.native(inside),
    );

    const outsideRoot = directory('rnu-safe-outside-');
    const outside = path.join(outsideRoot, 'build');
    expect(assertSafeToEmpty(outside, cwd)).toBe(
      fs.realpathSync.native(outside),
    );
  });

  test('refuses protected roots and source-control metadata', () => {
    const cwd = directory('rnu-safe-project-');
    fs.mkdirSync(path.join(cwd, '.git'), { recursive: true });

    expect(() => assertSafeToEmpty('.', cwd)).toThrow();
    expect(() => assertSafeToEmpty('..', cwd)).toThrow();
    expect(() => assertSafeToEmpty(cwd, cwd)).toThrow();
    expect(() => assertSafeToEmpty(os.homedir(), cwd)).toThrow();
    expect(() => assertSafeToEmpty(os.tmpdir(), cwd)).toThrow();
    expect(() => assertSafeToEmpty(path.parse(cwd).root, cwd)).toThrow();
    expect(() => assertSafeToEmpty(path.join(cwd, '.git'), cwd)).toThrow();
  });

  test('refuses final and parent-directory symlink redirection', () => {
    const cwd = directory('rnu-safe-project-');
    const outside = directory('rnu-safe-target-');
    _writeFile(path.join(outside, 'must-survive.txt'), 'important');

    const directLink = path.join(cwd, 'direct-link');
    fs.symlinkSync(
      outside,
      directLink,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    expect(() => assertSafeToEmpty(directLink, cwd)).toThrow();

    const parentLink = path.join(cwd, 'parent-link');
    fs.symlinkSync(
      outside,
      parentLink,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    expect(() => assertSafeToEmpty(path.join(parentLink, 'build'), cwd)).toThrow();
    expect(fs.readFileSync(path.join(outside, 'must-survive.txt'), 'utf8')).toBe(
      'important',
    );
  });
});
""",
)

replace_once(
    "tests/bundle-runner.test.ts",
    """  test('ios: installed pod, Expo engine property or Podfile.lock', async () => {
    const root = project();
    expect(detectIosHermes(root)).toBe(false);

    const lock = path.join(root, 'ios', 'Podfile.lock');
    _writeFile(lock, 'PODS:\\n  - React-Core (0.73.2)\\n');
    expect(detectIosHermes(root)).toBe(false);
    _writeFile(
      lock,
      'PODS:\\n  - hermes-engine (0.73.2):\\n    - hermes-engine/Pre-built (= 0.73.2)\\n  - React-Core (0.73.2)\\n',
    );
    // no `pod install` on this machine, but the lockfile lists the pod
    expect(detectIosHermes(root)).toBe(true);

    const expoProperties = path.join(root, 'ios', 'Podfile.properties.json');
    writeJson(expoProperties, { 'expo.jsEngine': 'jsc' });
    expect(detectIosHermes(root)).toBe(false);
    writeJson(expoProperties, { 'expo.jsEngine': 'hermes' });
    fs.rmSync(lock);
    expect(detectIosHermes(root)).toBe(true);

    fs.rmSync(expoProperties);
    fs.mkdirSync(path.join(root, 'ios', 'Pods', 'hermes-engine'), {
      recursive: true,
    });
    expect(detectIosHermes(root)).toBe(true);
    expect(await detectHermesEnabled('ios', undefined, {}, root)).toBe(true);
  });
""",
    """  test('ios: installed pod, Expo engine property or Podfile.lock', async () => {
    const root = project();
    expect(detectIosHermes(root)).toBe(false);

    const lock = path.join(root, 'ios', 'Podfile.lock');
    _writeFile(lock, 'PODS:\\n  - React-Core (0.73.2)\\n');
    expect(detectIosHermes(root)).toBe(false);
    _writeFile(
      lock,
      'PODS:\\n  - hermes-engine (0.73.2):\\n    - hermes-engine/Pre-built (= 0.73.2)\\n  - React-Core (0.73.2)\\n',
    );
    // no `pod install` on this machine, but the lockfile lists the pod
    expect(detectIosHermes(root)).toBe(true);

    const expoProperties = path.join(root, 'ios', 'Podfile.properties.json');
    writeJson(expoProperties, { 'expo.jsEngine': 'hermes' });
    fs.rmSync(lock);
    expect(detectIosHermes(root)).toBe(true);

    fs.rmSync(expoProperties);
    fs.mkdirSync(path.join(root, 'ios', 'Pods', 'hermes-engine'), {
      recursive: true,
    });
    expect(detectIosHermes(root)).toBe(true);
    expect(await detectHermesEnabled('ios', undefined, {}, root)).toBe(true);
  });

  test('ios: explicit JSC configuration overrides Hermes dependency artifacts', () => {
    const root = project();
    const ios = path.join(root, 'ios');
    fs.mkdirSync(path.join(ios, 'Pods', 'hermes-engine'), { recursive: true });
    _writeFile(
      path.join(ios, 'Podfile.lock'),
      'PODS:\\n  - hermes-engine (0.83.0)\\n',
    );

    writeJson(path.join(ios, 'Podfile.properties.json'), {
      'expo.jsEngine': 'jsc',
    });
    expect(detectIosHermes(root)).toBe(false);

    fs.rmSync(path.join(ios, 'Podfile.properties.json'));
    _writeFile(path.join(ios, 'Podfile'), "ENV['USE_HERMES'] = '0'\\n");
    expect(detectIosHermes(root)).toBe(false);

    _writeFile(
      path.join(ios, 'Podfile'),
      "ENV['USE_THIRD_PARTY_JSC'] = '1'\\nENV['USE_HERMES'] = '1'\\n",
    );
    expect(detectIosHermes(root)).toBe(false);
  });

  test('ios: explicit Podfile Hermes configuration works without installed pods', () => {
    const root = project();
    _writeFile(
      path.join(root, 'ios', 'Podfile'),
      'use_react_native!(\\n  :hermes_enabled => true\\n)\\n',
    );
    expect(detectIosHermes(root)).toBe(true);
  });
""",
)

replace_once(
    "tests/api.test.ts",
    """  loadSession,
  replaceSession,
  saveSession,
  setApiToken,
""",
    """  isTransientUploadError,
  loadSession,
  redactRequestUrl,
  replaceSession,
  saveSession,
  setApiToken,
""",
)

replace_once(
    "tests/api.test.ts",
    """  test('query throws correctly formatted error on network failure', async () => {
    runtimeFetchSpy = spyOn(runtime, 'runtimeFetch').mockImplementation(
      async () => {
        throw new Error('Network disconnected');
      },
    );

    let error: any;
    try {
      await get('/test-endpoint');
    } catch (e) {
      error = e;
    }

    expect(error).toBeDefined();
    expect(error.message).toContain('Network disconnected');
    expect(error.message).toContain('URL:');
  });
""",
    """  test('query throws correctly formatted error on network failure', async () => {
    runtimeFetchSpy = spyOn(runtime, 'runtimeFetch').mockImplementation(
      async () => {
        throw new Error('Network disconnected');
      },
    );

    let error: any;
    try {
      await get('/test-endpoint');
    } catch (e) {
      error = e;
    }

    expect(error).toBeDefined();
    expect(error.message).toContain('Network disconnected');
    expect(error.message).toContain('URL:');
    expect(error.cause).toBeInstanceOf(Error);
  });

  test('query preserves nested proxy failure causes', async () => {
    const socketError = Object.assign(new Error('connection refused'), {
      code: 'ECONNREFUSED',
    });
    const fetchError = new Error('fetch failed', { cause: socketError });
    runtimeFetchSpy = spyOn(runtime, 'runtimeFetch').mockRejectedValue(
      fetchError,
    );

    let error: any;
    try {
      await get('/test-endpoint');
    } catch (e) {
      error = e;
    }

    expect(error).toBeDefined();
    expect(error.cause).toBeInstanceOf(Error);
    expect(error.cause.cause).toBe(fetchError);
    expect(fetchError.cause).toBe(socketError);
  });
""",
)

api_test = Path("tests/api.test.ts")
helper = """
describe('api.ts error helpers', () => {
  test('redacts signed query strings and URL credentials', () => {
    const redacted = redactRequestUrl(
      'https://alice:secret@example.com/upload?X-Amz-Signature=top-secret#fragment',
    );
    expect(redacted).toBe('https://example.com/upload?<redacted>');
    expect(redacted).not.toContain('secret');
    expect(redacted).not.toContain('alice');
  });

  test('treats an upload deadline as transient', () => {
    expect(
      isTransientUploadError({
        name: 'UploadTimeoutError',
        code: 'ETIMEDOUT',
        message: 'Upload timed out',
      }),
    ).toBe(true);
  });
});
"""
text = api_test.read_text(encoding="utf-8").rstrip() + "\n\n" + helper
api_test.write_text(text, encoding="utf-8")

replace_once(
    "tests/provider.test.ts",
    """import * as api from '../src/api';
import { packageCommands } from '../src/package';
""",
    """import * as api from '../src/api';
import { bundleCommands } from '../src/bundle';
import { packageCommands } from '../src/package';
""",
)

replace_once(
    "tests/provider.test.ts",
    """  let consoleSpy: ReturnType<typeof spyOn>;
  let publishSpy: ReturnType<typeof spyOn>;
""",
    """  let consoleSpy: ReturnType<typeof spyOn>;
  let bundleSpy: ReturnType<typeof spyOn>;
  let publishSpy: ReturnType<typeof spyOn>;
""",
)

replace_once(
    "tests/provider.test.ts",
    """    consoleSpy.mockRestore();
    publishSpy?.mockRestore();
""",
    """    consoleSpy.mockRestore();
    bundleSpy?.mockRestore();
    publishSpy?.mockRestore();
""",
)

replace_once(
    "tests/provider.test.ts",
    """  test('publish forwards file path and options to the publish command', async () => {
""",
    """  test('bundle forwards resetCache and an explicit sourcemap opt-out', async () => {
    bundleSpy = spyOn(bundleCommands, 'bundle').mockResolvedValue(undefined);

    const result = await provider.bundle({
      platform: 'android',
      resetCache: false,
      sourcemap: false,
    });

    expect(result.success).toBe(true);
    expect(bundleSpy).toHaveBeenCalledWith({
      args: [],
      options: expect.objectContaining({
        platform: 'android',
        'no-interactive': true,
        resetCache: false,
        sourcemap: false,
      }),
    });
  });

  test('publish forwards file path and options to the publish command', async () => {
""",
)

replace_once(
    "tests/dep-versions.test.ts",
    """    // memoized: a later cwd change does not re-resolve
    const callsAfterFirst = cwdSpy.mock.calls.length;
    expect(module.getDepVersions()).toBe(module.getDepVersions());
    expect(cwdSpy.mock.calls.length).toBe(callsAfterFirst);
  });

  test('should return an empty object if no package.json is found', async () => {
""",
    """    // memoized while the project directory is unchanged
    expect(module.getDepVersions()).toBe(module.getDepVersions());
  });

  test('re-resolves the cache after the project cwd changes', async () => {
    const secondDir = path.join(
      os.tmpdir(),
      `temp-test-dep-versions-second-${Date.now()}-${testCount}`,
    );
    fs.mkdirSync(secondDir, { recursive: true });
    try {
      for (const [root, name, version] of [
        [testDir, 'first', '1.0.0'],
        [secondDir, 'second', '2.0.0'],
      ] as const) {
        fs.writeFileSync(
          path.join(root, 'package.json'),
          JSON.stringify({ dependencies: { [name]: '*' } }),
        );
        const depDir = path.join(root, 'node_modules', name);
        fs.mkdirSync(depDir, { recursive: true });
        fs.writeFileSync(
          path.join(depDir, 'package.json'),
          JSON.stringify({ version }),
        );
      }

      const modulePath = path.join(
        originalCwd,
        'src',
        'utils',
        'dep-versions.ts',
      );
      const module = await import(
        `${modulePath}?cwd=${Date.now()}_${testCount}`
      );
      expect(module.getDepVersions()).toEqual({ first: '1.0.0' });

      cwdSpy.mockReturnValue(secondDir);
      expect(module.getDepVersions()).toEqual({ second: '2.0.0' });
      expect(module.getDepVersion('second')).toBe('2.0.0');
    } finally {
      fs.rmSync(secondDir, { recursive: true, force: true });
    }
  });

  test('should return an empty object if no package.json is found', async () => {
""",
)

replace_once(
    ".github/workflows/test.yml",
    """concurrency:
  group: ${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true

jobs:
""",
    """concurrency:
  group: ${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
""",
)

replace_all(
    ".github/workflows/test.yml",
    """      - uses: actions/checkout@v7

      - uses: oven-sh/setup-bun@v2
""",
    """      - uses: actions/checkout@v7
        with:
          persist-credentials: false

      - uses: oven-sh/setup-bun@v2
""",
    3,
)

replace_once(
    ".github/workflows/test.yml",
    """      - uses: actions/checkout@v7
        with:
          fetch-depth: 0

      - uses: oven-sh/setup-bun@v2
""",
    """      - uses: actions/checkout@v7
        with:
          fetch-depth: 0
          persist-credentials: false

      - uses: oven-sh/setup-bun@v2
""",
)

Path("tests/non-interactive.test.ts").write_text(
    """import { describe, expect, test } from 'bun:test';
import { isNonInteractive } from '../src/utils';

describe('isNonInteractive', () => {
  test('treats non-TTY stdin as non-interactive without an explicit flag', () => {
    expect(isNonInteractive({}, false, false)).toBe(true);
  });

  test('allows prompts only with a TTY and no non-interactive flag', () => {
    expect(isNonInteractive({}, true, false)).toBe(false);
  });

  test('honors the environment and global flags', () => {
    expect(isNonInteractive({ NO_INTERACTIVE: '1' }, true, false)).toBe(true);
    expect(isNonInteractive({}, true, true)).toBe(true);
  });
});
""",
    encoding="utf-8",
)
