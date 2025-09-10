let currentPackage = null;
try {
  currentPackage = require(`${process.cwd()}/package.json`);
} catch (e) {
  // console.warn('No package.json file were found');
}

const _depVersions: Record<string, string> = {};

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
      const version = require(packageJsonPath).version;
      _depVersions[dep] = version;
    } catch (e) {}
  }
}

export const depVersions = Object.keys(_depVersions)
  .sort() // Sort the keys alphabetically
  .reduce((obj, key) => {
    obj[key] = _depVersions[key]; // Rebuild the object with sorted keys
    return obj;
  }, {} as Record<string, string>);

// console.log({ depVersions });
