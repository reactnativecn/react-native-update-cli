import currentPackage from '../../package.json';

const depKeys = Object.keys(currentPackage.dependencies);
const devDepKeys = Object.keys(currentPackage.devDependencies);
const dedupedDeps = [...new Set([...depKeys, ...devDepKeys])];

export const depVersions: Record<string, string> = {};

for (const dep of dedupedDeps) {
  try {
    const packageJsonPath = require.resolve(`${dep}/package.json`, {
      paths: [process.cwd()],
    });
    const version = require(packageJsonPath).version;
    depVersions[dep] = version;
  } catch (e) {}
}
