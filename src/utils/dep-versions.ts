// Installed versions of the dependencies/devDependencies of the project in
// cwd. Resolving them means reading one package.json per dependency, so the
// full map is built lazily (on first use) and memoized rather than at import
// time, and the version banner printed by every command asks for the single
// dependency it needs (`getDepVersion`) instead of the whole map.

import fs from 'fs';
import path from 'path';

type ProjectPackageJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

let cachedCwd: string | undefined;
let cached: Record<string, string> | undefined;

function readProjectPackageJson(cwd: string): ProjectPackageJson | null {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'),
    ) as ProjectPackageJson;
  } catch {
    // no package.json (or not JSON): the project simply declares nothing
    return null;
  }
}

/** direct dependency names (dependencies + devDependencies), deduplicated */
function directDependencyNames(pkg: ProjectPackageJson): string[] {
  return [
    ...new Set([
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
    ]),
  ];
}

/**
 * Version of the installed copy of `dep`: the nearest
 * `node_modules/<dep>/package.json` from `cwd` upwards, read directly. Not
 * `require.resolve`: a package whose `exports` map omits package.json makes
 * it throw, and bun caches its answer per specifier, ignoring `paths`.
 */
function readInstalledVersion(dep: string, cwd: string): string | undefined {
  let dir = path.resolve(cwd);
  for (;;) {
    try {
      const pkg = JSON.parse(
        fs.readFileSync(
          path.join(dir, 'node_modules', dep, 'package.json'),
          'utf8',
        ),
      ) as { version?: unknown };
      return typeof pkg.version === 'string' ? pkg.version : undefined;
    } catch {
      // not installed at this level
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}

function readDepVersions(cwd: string): Record<string, string> {
  const versions: Record<string, string> = {};
  const pkg = readProjectPackageJson(cwd);
  if (pkg) {
    for (const dep of directDependencyNames(pkg)) {
      const version = readInstalledVersion(dep, cwd);
      if (version) {
        versions[dep] = version;
      }
    }
  }

  // sorted keys: the object is sent to the server as-is and diffed
  return Object.keys(versions)
    .sort()
    .reduce(
      (obj, key) => {
        obj[key] = versions[key];
        return obj;
      },
      {} as Record<string, string>,
    );
}

/** Installed versions of the cwd project's dependencies, keys sorted. */
export function getDepVersions(): Record<string, string> {
  const cwd = path.resolve(process.cwd());
  if (!cached || cachedCwd !== cwd) {
    cached = readDepVersions(cwd);
    cachedCwd = cwd;
  }
  return cached;
}

/**
 * Installed version of one direct (dev)dependency of the cwd project, or
 * undefined when the project does not declare it or it is not installed.
 * Two file reads instead of one per dependency: the version banner printed
 * before every command must not scale with the size of the project.
 */
export function getDepVersion(
  name: string,
  cwd = process.cwd(),
): string | undefined {
  const resolvedCwd = path.resolve(cwd);
  if (cached && cachedCwd === resolvedCwd) {
    return cached[name];
  }
  const pkg = readProjectPackageJson(resolvedCwd);
  if (!pkg || !directDependencyNames(pkg).includes(name)) {
    return undefined;
  }
  return readInstalledVersion(name, resolvedCwd);
}

/**
 * Same data as `getDepVersions()` but as a lazily populated object, for the
 * remaining property-access call sites (`depVersions['react-native']`).
 * Nothing is resolved until the first property access.
 */
export const depVersions: Record<string, string> = new Proxy(
  {} as Record<string, string>,
  {
    get: (_target, key) =>
      typeof key === 'string' ? getDepVersions()[key] : undefined,
    has: (_target, key) => typeof key === 'string' && key in getDepVersions(),
    ownKeys: () => Object.keys(getDepVersions()),
    getOwnPropertyDescriptor: (_target, key) => {
      if (typeof key !== 'string' || !(key in getDepVersions())) {
        return undefined;
      }
      return {
        value: getDepVersions()[key],
        writable: false,
        enumerable: true,
        configurable: true,
      };
    },
  },
);
