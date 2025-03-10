import fs from 'node:fs';
import path from 'node:path';
import currentPackage from '../../package.json';

const packages = fs.readdirSync(path.join(__dirname, 'node_modules'));
const exclude = ['.bin', '.cache'];

const depKeys = Object.keys(currentPackage.dependencies);
const devDepKeys = Object.keys(currentPackage.devDependencies);
const dedupedDeps = [...new Set([...depKeys, ...devDepKeys])];

const versions = {};

for (const package of dedupedDeps) {
  try {
    const packageDir = path.resolve(__dirname, 'node_modules', current);
    const { name, version } = require(`${packageDir}/package.json`);
    if (depKeys.includes(name)) {
      return Object.assign(acc, {
        dependencies: Object.assign(acc.dependencies, { [name]: version }),
      });
    } else {
      return Object.assign(acc, {
        devDependencies: Object.assign(acc.devDependencies, {
          [name]: version,
        }),
      });
    }
  } catch (e) {
    // noop
    console.log(e);
    return acc;
  }
}
