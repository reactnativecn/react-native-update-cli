import { compare, compareVersions, satisfies } from 'compare-versions';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { npm, yarn } from 'global-dirs';
import type {
  Agent,
  RequestOptions as HttpRequestOptions,
  IncomingMessage,
} from 'http';
import type { RequestOptions as HttpsRequestOptions } from 'https';
import { homedir } from 'os';
import { dirname, join, parse, resolve as pathResolve } from 'path';
import registryAuthToken from 'registry-auth-token';
import getRegistryUrl from 'registry-auth-token/registry-url';
import { URL } from 'url';

interface RegistryVersions {
  /**
   * The latest version of the package found on the registry (if found).
   */
  latest?: string;
  /**
   * The next version of the package found on the registry (if found).
   */
  next?: string;
  /**
   * The latest version of the package found on the registry and satisfied by the wanted tag or version range.
   */
  wanted?: string;
}

interface InstalledVersions {
  /**
   * The current local installed version of the package (if installed).
   */
  local?: string;
  /**
   * The current npm global installed version of the package (if installed).
   */
  globalNpm?: string;
  /**
   * The current yarn global installed version of the package (if installed).
   */
  globalYarn?: string;
}

interface LatestVersionPackage extends InstalledVersions, RegistryVersions {
  /**
   * The name of the package.
   */
  name: string;
  /**
   * The tag or version range that was provided (if provided).
   * @default "latest"
   */
  wantedTagOrRange?: string;
  /**
   * Whether the local or global installed versions (if any) could be upgraded or not, based on the wanted version.
   */
  updatesAvailable:
    | {
        local: string | false;
        globalNpm: string | false;
        globalYarn: string | false;
      }
    | false;
  /**
   * Any error that might have occurred during the process.
   */
  error?: Error;
}

interface RequestOptions {
  readonly ca?: string | Buffer | Array<string | Buffer>;
  readonly rejectUnauthorized?: boolean;
  readonly agent?: Agent | boolean;
  readonly timeout?: number;
}

interface LatestVersionOptions {
  /**
   * Awaiting the api to return might take time, depending on the network, and might impact your package loading performance.
   * You can use the cache mechanism to improve load performance and reduce unnecessary network requests.
   * If `useCache` is not supplied, the api will always check for updates and wait for every requests to return before returning itself.
   * If `useCache` is used (for each provided package):
   * 1) a fresh cache (younger than `cacheMaxAge`, from the same registry) answers without any network request
   * 2) otherwise the registry is queried and the cache refreshed; when that query fails, a stale cache (if any) is used instead.
   * Combine with `unref` so a slow refresh never keeps the process alive.
   * @default false
   */
  readonly useCache?: boolean;

  /**
   * How long the cache for the provided packages should be used before being refreshed (in milliseconds).
   * If `useCache` is not supplied, this option has no effect.
   * If `0` is used, the cache is always refreshed (a stale cache still serves as a fallback when the refresh fails).
   * @default ONE_DAY
   */
  readonly cacheMaxAge?: number;

  /**
   * Do not let the registry request keep the process alive: its socket is `unref`'d, so the process may exit before the
   * request completes (the returned promise then simply never settles). Use for opportunistic background checks.
   * @default false
   */
  readonly unref?: boolean;

  /**
   * A JavaScript package registry url that implements the CommonJS Package Registry specification.
   * @default "Looks at any registry urls in the .npmrc file or fallback to the default npm registry instead"
   * @example <caption>.npmrc</caption>
   * registry = 'https://custom-registry.com/'
   * @pkgscope:registry = 'https://custom-registry.com/'
   */
  readonly registryUrl?: string;

  /**
   * Set of options to be passed down to Node.js http/https request.
   * @example <caption>Behind a proxy with self-signed certificate</caption>
   * { ca: [ fs.readFileSync('proxy-cert.pem') ] }
   * @example <caption>Bypassing certificate validation</caption>
   * { rejectUnauthorized: false }
   */
  readonly requestOptions?: RequestOptions;
}

interface LatestVersion {
  /**
   * Get latest versions of packages from of a package json like object.
   * @param {PackageJson} item - A package json like object (with dependencies, devDependencies and peerDependencies attributes).
   * @example { dependencies: { 'npm': 'latest' }, devDependencies: { 'npm': '1.3.2' }, peerDependencies: { '@scope/name': '^5.0.2' } }
   * @param {LatestVersionOptions} [options] - An object optionally specifying the use of the cache, the max age of the cache, the registry url and the http or https options.
   * If `useCache` is not supplied, the default of `false` is used.
   * If `cacheMaxAge` is not supplied, the default of `one day` is used.
   * If `registryUrl` is not supplied, the default from `.npmrc` is used or a fallback to the `npm registry url` instead.
   * @returns {Promise<LatestVersionPackage[]>}
   */
  (
    item: PackageJson,
    options?: LatestVersionOptions,
  ): Promise<LatestVersionPackage[]>;

  /**
   * Get latest version of a single package.
   * @param {Package} item - A single package object (represented by a string that should match the following format: `${'@' | ''}${string}@${string}`)
   * @example 'npm', 'npm@1.3.2', '@scope/name@^5.0.2'
   * @param {LatestVersionOptions} [options] - An object optionally specifying the use of the cache, the max age of the cache, the registry url and the http or https options.
   * If `useCache` is not supplied, the default of `false` is used.
   * If `cacheMaxAge` is not supplied, the default of `one day` is used.
   * If `registryUrl` is not supplied, the default from `.npmrc` is used or a fallback to the npm registry url instead.
   * @returns {Promise<LatestVersionPackage>}
   */
  (
    item: Package,
    options?: LatestVersionOptions,
  ): Promise<LatestVersionPackage>;

  /**
   * Get latest versions of a collection of packages.
   * @param {Package[]} items - A collection of package object (represented by a string that should match the following format: `${'@' | ''}${string}@${string}`)
   * @example ['npm', 'npm@1.3.2', '@scope/name@^5.0.2']
   * @param {LatestVersionOptions} [options] - An object optionally specifying the use of the cache, the max age of the cache, the registry url and the http or https options.
   * If `useCache` is not supplied, the default of `false` is used.
   * If `cacheMaxAge` is not supplied, the default of `one day` is used.
   * If `registryUrl` is not supplied, the default from `.npmrc` is used or a fallback to the npm registry url instead.
   * @returns {Promise<LatestVersionPackage[]>}
   */
  (
    items: Package[],
    options?: LatestVersionOptions,
  ): Promise<LatestVersionPackage[]>; // eslint-disable-line @typescript-eslint/unified-signatures
}
type PackageRange = `${'@' | ''}${string}@${string}`;
type Package = PackageRange | string; // eslint-disable-line @typescript-eslint/no-redundant-type-constituents
type PackageJsonDependencies = Record<string, string>;
type PackageJson = Record<string, any> &
  (
    | {
        dependencies: PackageJsonDependencies;
      }
    | {
        devDependencies: PackageJsonDependencies;
      }
    | {
        peerDependencies: PackageJsonDependencies;
      }
  );

/**
 * @internal
 */
interface PackageMetadata {
  name: string;
  lastUpdateDate: number;
  versions: string[];
  distTags: Record<string, string>;
  /** registry the metadata came from; a cache from another registry is not reused */
  registryUrl?: string;
}

export const ONE_DAY = 1000 * 60 * 60 * 24; // eslint-disable-line @typescript-eslint/naming-convention

const isPackageJson = (obj: any): obj is PackageJson => {
  return (
    (obj as PackageJson).dependencies !== undefined ||
    (obj as PackageJson).devDependencies !== undefined ||
    (obj as PackageJson).peerDependencies !== undefined
  );
};

const resolveRegistryUrl = (
  pkgName: string,
  options?: LatestVersionOptions,
): string => {
  const i = pkgName.indexOf('/');
  const pkgScope = i !== -1 ? pkgName.slice(0, i) : '';
  return options?.registryUrl ?? getRegistryUrl(pkgScope);
};

const downloadMetadata = (
  pkgName: string,
  options?: LatestVersionOptions,
): Promise<PackageMetadata> => {
  return new Promise((resolve, reject) => {
    const registryUrl = resolveRegistryUrl(pkgName, options);
    const pkgUrl = new URL(
      encodeURIComponent(pkgName).replace(/^%40/, '@'),
      registryUrl,
    );

    let requestOptions: HttpRequestOptions | HttpsRequestOptions = {
      headers: {
        accept:
          'application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8, */*',
      },
      host: pkgUrl.hostname,
      path: pkgUrl.pathname,
      port: pkgUrl.port,
    };
    const authInfo = registryAuthToken(pkgUrl.toString(), { recursive: true });
    if (authInfo && requestOptions.headers) {
      (requestOptions.headers as any).authorization =
        `${authInfo.type} ${authInfo.token}`;
    }
    if (options?.requestOptions) {
      requestOptions = { ...requestOptions, ...options.requestOptions };
    }

    const { get } = require(pkgUrl.protocol === 'https:' ? 'https' : 'http');
    const request = get(requestOptions, (res: IncomingMessage) => {
      if (res.statusCode === 200) {
        let rawData = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => (rawData += chunk));
        res.once('error', (err) => {
          res.removeAllListeners();
          reject(`Request error (${err.message}): ${pkgUrl}`);
        });
        res.once('end', () => {
          res.removeAllListeners();
          try {
            const pkgMetadata = JSON.parse(rawData);
            resolve({
              name: pkgName,
              lastUpdateDate: Date.now(),
              versions: Object.keys(pkgMetadata.versions as string[]),
              distTags: pkgMetadata['dist-tags'],
              registryUrl,
            });
            return;
          } catch (err) {
            reject(err);
            return;
          }
        });
      } else {
        res.removeAllListeners();
        res.resume(); // consume response data to free up memory
        reject(`Request error (${res.statusCode}): ${pkgUrl}`);
        return;
      }
    });
    const abort = (error: Error | string): void => {
      request.destroy();
      reject(error);
    };
    request.once('timeout', () => {
      abort(`Request timed out: ${pkgUrl}`);
    });
    request.once('error', (err: Error) => {
      abort(err);
    });
    request.on('close', () => {
      request.removeAllListeners();
    });
    if (options?.unref) {
      // A background check must never delay the process exit: drop the
      // socket's ref (also for a pooled keep-alive socket, which the agent
      // ref's again right before handing it out).
      request.once('socket', (socket: { unref?: () => void }) => {
        socket.unref?.();
      });
    }
  });
};

const getCacheDir = (name = '@badisi/latest-version'): string => {
  const homeDir = homedir();
  if (process.env.XDG_CACHE_HOME) {
    // an explicit override wins on every platform (also lets tests isolate)
    return join(process.env.XDG_CACHE_HOME, name);
  }
  switch (process.platform) {
    case 'darwin':
      return join(homeDir, 'Library', 'Caches', name);
    case 'win32':
      return join(
        process.env.LOCALAPPDATA ?? join(homeDir, 'AppData', 'Local'),
        name,
        'Cache',
      );
    default:
      return join(process.env.XDG_CACHE_HOME ?? join(homeDir, '.cache'), name);
  }
};

const saveMetadataToCache = (pkg: PackageMetadata): void => {
  try {
    const filePath = join(getCacheDir(), `${pkg.name}.json`);
    if (!existsSync(dirname(filePath))) {
      mkdirSync(dirname(filePath), { recursive: true });
    }
    writeFileSync(filePath, JSON.stringify(pkg));
  } catch {
    // a read-only or missing cache dir must not turn into an error
  }
};

/**
 * The cached metadata of a package (from the same registry), and whether it is
 * still younger than `cacheMaxAge`. A stale entry is returned as well so it can
 * serve as a fallback when the registry is unreachable.
 */
const getMetadataFromCache = (
  pkgName: string,
  options?: LatestVersionOptions,
): { metadata: PackageMetadata; fresh: boolean } | undefined => {
  const maxAge = options?.cacheMaxAge ?? ONE_DAY;
  try {
    const pkgCacheFilePath = join(getCacheDir(), `${pkgName}.json`);
    if (!existsSync(pkgCacheFilePath)) {
      return undefined;
    }
    const metadata = JSON.parse(
      readFileSync(pkgCacheFilePath).toString(),
    ) as PackageMetadata;
    if (
      !metadata ||
      typeof metadata.lastUpdateDate !== 'number' ||
      !metadata.distTags ||
      metadata.registryUrl !== resolveRegistryUrl(pkgName, options)
    ) {
      return undefined;
    }
    const age = Date.now() - metadata.lastUpdateDate;
    return { metadata, fresh: maxAge !== 0 && age >= 0 && age < maxAge };
  } catch {
    return undefined; // unreadable / corrupt cache is the same as no cache
  }
};

const getRegistryVersions = async (
  pkgName: string,
  tagOrRange?: string,
  options?: LatestVersionOptions,
): Promise<RegistryVersions> => {
  let pkgMetadata: PackageMetadata | undefined;
  if (pkgName.length && options?.useCache) {
    const cached = getMetadataFromCache(pkgName, options);
    if (cached?.fresh) {
      pkgMetadata = cached.metadata;
    } else {
      try {
        pkgMetadata = await downloadMetadata(pkgName, options);
        saveMetadataToCache(pkgMetadata);
      } catch (err) {
        if (!cached) {
          throw err;
        }
        pkgMetadata = cached.metadata; // stale beats nothing
      }
    }
  } else if (pkgName.length) {
    pkgMetadata = await downloadMetadata(pkgName, options);
  }

  const versions: RegistryVersions = {
    latest: pkgMetadata?.distTags.latest,
    next: pkgMetadata?.distTags.next,
  };
  if (tagOrRange && pkgMetadata?.distTags[tagOrRange]) {
    versions.wanted = pkgMetadata.distTags[tagOrRange];
  } else if (tagOrRange && pkgMetadata?.versions.length) {
    versions.wanted = maxSatisfying(pkgMetadata.versions, tagOrRange);
  }
  return versions;
};

/** the highest of `versions` within `range` (npm range syntax), if any */
const maxSatisfying = (
  versions: string[],
  range: string,
): string | undefined => {
  const matching = versions.filter((version) => {
    try {
      return satisfies(version, range);
    } catch {
      return false;
    }
  });
  if (!matching.length) return undefined;
  return matching.sort(compareVersions)[matching.length - 1];
};

/** `a > b` for two versions; invalid input counts as "not newer" */
const gt = (a: string, b: string): boolean => {
  try {
    return compare(a, b, '>');
  } catch {
    return false;
  }
};

const getInstalledVersion = (
  pkgName: string,
  location: keyof InstalledVersions = 'local',
): string | undefined => {
  try {
    if (location === 'globalNpm') {
      return require(join(npm.packages, pkgName, 'package.json'))
        ?.version as string;
    }
    if (location === 'globalYarn') {
      // Make sure package is globally installed by Yarn
      const yarnGlobalPkg = require(
        pathResolve(yarn.packages, '..', 'package.json'),
      );
      if (!yarnGlobalPkg?.dependencies?.[pkgName]) {
        return undefined;
      }
      return require(join(yarn.packages, pkgName, 'package.json'))
        ?.version as string;
    }
    /**
     * Compute the local paths manually as require.resolve() and require.resolve.paths()
     * cannot be trusted anymore.
     * @see https://github.com/nodejs/node/issues/33460
     * @see https://github.com/nodejs/loaders/issues/26
     */
    const { root } = parse(process.cwd());
    let path = process.cwd();
    const localPaths = [join(path, 'node_modules')];
    while (path !== root) {
      path = dirname(path);
      localPaths.push(join(path, 'node_modules'));
    }
    for (const localPath of localPaths) {
      const pkgPath = join(localPath, pkgName, 'package.json');
      if (existsSync(pkgPath)) {
        return require(pkgPath)?.version as string;
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
};

const getInfo = async (
  pkg: Package,
  options?: LatestVersionOptions,
): Promise<LatestVersionPackage> => {
  const i = pkg.lastIndexOf('@');
  let pkgInfo: LatestVersionPackage = {
    name: i > 1 ? pkg.slice(0, i) : pkg,
    wantedTagOrRange: i > 1 ? pkg.slice(i + 1) : 'latest',
    updatesAvailable: false,
  };

  try {
    pkgInfo = {
      ...pkgInfo,
      local: getInstalledVersion(pkgInfo.name, 'local'),
      globalNpm: getInstalledVersion(pkgInfo.name, 'globalNpm'),
      globalYarn: getInstalledVersion(pkgInfo.name, 'globalYarn'),
      ...(await getRegistryVersions(
        pkgInfo.name,
        pkgInfo.wantedTagOrRange,
        options,
      )),
    };
    const local =
      pkgInfo.local && pkgInfo.wanted
        ? gt(pkgInfo.wanted, pkgInfo.local)
          ? pkgInfo.wanted
          : false
        : false;
    const globalNpm =
      pkgInfo.globalNpm && pkgInfo.wanted
        ? gt(pkgInfo.wanted, pkgInfo.globalNpm)
          ? pkgInfo.wanted
          : false
        : false;
    const globalYarn =
      pkgInfo.globalYarn && pkgInfo.wanted
        ? gt(pkgInfo.wanted, pkgInfo.globalYarn)
          ? pkgInfo.wanted
          : false
        : false;
    pkgInfo.updatesAvailable =
      local || globalNpm || globalYarn
        ? { local, globalNpm, globalYarn }
        : false;
  } catch (err: any) {
    pkgInfo.error = err?.message ?? err;
  }

  return pkgInfo;
};

const latestVersion: LatestVersion = async (
  arg: Package | Package[] | PackageJson,
  options?: LatestVersionOptions,
): Promise<any> => {
  const pkgs: Package[] = [];
  if (typeof arg === 'string') {
    pkgs.push(arg);
  } else if (Array.isArray(arg)) {
    pkgs.push(...arg);
  } else if (isPackageJson(arg)) {
    const addDeps = (deps?: PackageJsonDependencies): void => {
      if (deps) {
        pkgs.push(
          ...Object.keys(deps).map((key: string) => `${key}@${deps[key]}`),
        );
      }
    };
    addDeps(arg.dependencies as PackageJsonDependencies | undefined);
    addDeps(arg.devDependencies as PackageJsonDependencies | undefined);
    addDeps(arg.peerDependencies as PackageJsonDependencies | undefined);
  }

  const jobs = await Promise.allSettled(
    pkgs.map((pkg) => getInfo(pkg, options)),
  );
  const results = jobs.map(
    (jobResult: PromiseSettledResult<LatestVersionPackage>) =>
      (jobResult as PromiseFulfilledResult<LatestVersionPackage>).value,
  );
  return typeof arg === 'string' ? results[0] : results;
};

export type {
  LatestVersion,
  LatestVersionOptions,
  LatestVersionPackage,
  Package,
  PackageJson,
  PackageJsonDependencies,
  PackageRange,
  RegistryVersions,
  RequestOptions,
};
export default latestVersion;
