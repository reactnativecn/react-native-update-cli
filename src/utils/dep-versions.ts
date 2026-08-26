// Installed versions of every dependency/devDependency of the project in cwd.
// Resolving them means reading one package.json per dependency, so this is
// done lazily (on first use) and memoized rather than at import time, which
// used to cost every command ~3-30 ms before it even parsed its arguments.

let cached: Record<string, string> | undefined;

function readDepVersions(): Record<string, string> {
  let currentPackage: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  } | null = null;
  try {
    currentPackage = require(`${process.cwd()}/package.json`);
  } catch (_e) {
    // console.warn('No package.json file were found');
  }

  const versions: Record<string, string> = {};
  if (currentPackage) {
    const depKeys = currentPackage.dependencies
      ? Object.keys(currentPackage.dependencies)
      : [];
    const devDepKeys = currentPackage.devDependencies
      ? Object.keys(currentPackage.devDependencies)
      : [];
    const dedupedDeps = [...new Set([...depKeys, ...devDepKeys])];

    for (const dep of dedupedDeps) {
      try {
        const packageJsonPath = require.resolve(`${dep}/package.json`, {
          paths: [process.cwd()],
        });
        versions[dep] = require(packageJsonPath).version;
      } catch (_e) {}
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
