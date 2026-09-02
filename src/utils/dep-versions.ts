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

let cached: Record<string, string> | undefined;

function readProjectPackageJson(): ProjectPackageJson | null {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'),
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

/** version of the installed copy of `dep`, resolved from cwd */
function readInstalledVersion(dep: string): string | undefined {
  try {
    const packageJsonPath = require.resolve(`${dep}/package.json`, {
      paths: [process.cwd()],
    });
    return require(packageJsonPath).version;
  } catch {
    return undefined;
  }
}

function readDepVersions(): Record<string, string> {
  const versions: Record<string, string> = {};
  const pkg = readProjectPackageJson();
  if (pkg) {
    for (const dep of directDependencyNames(pkg)) {
      const version = readInstalledVersion(dep);
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
  if (!cached) {
    cached = readDepVersions();
  }
  return cached;
}

/**
 * Installed version of one direct (dev)dependency of the cwd project, or
 * undefined when the project does not declare it or it is not installed.
 * Two file reads instead of one per dependency: the version banner printed
 * before every command must not scale with the size of the project.
 */
export function getDepVersion(name: string): string | undefined {
  if (cached) {
    return cached[name];
  }
  const pkg = readProjectPackageJson();
  if (!pkg || !directDependencyNames(pkg).includes(name)) {
    return undefined;
  }
  return readInstalledVersion(name);
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
