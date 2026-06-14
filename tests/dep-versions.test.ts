import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('depVersions utility', () => {
  const originalCwd = process.cwd();
  let testDir: string;
  let testCount = 0;
  let cwdSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    testCount++;
    testDir = path.join(
      os.tmpdir(),
      `temp-test-dep-versions-${Date.now()}-${testCount}`,
    );
    fs.mkdirSync(testDir, { recursive: true });

    // Mock process.cwd() instead of using process.chdir() to avoid affecting parallel tests
    cwdSpy = spyOn(process, 'cwd').mockReturnValue(testDir);
  });

  afterEach(() => {
    cwdSpy.mockRestore();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  const loadDepVersions = async () => {
    // Bust the module cache by appending a query string
    // In Bun, using the raw absolute path with query string correctly bypasses the cache
    const modulePath = path.join(
      originalCwd,
      'src',
      'utils',
      'dep-versions.ts',
    );
    const moduleUrl = `${modulePath}?t=${Date.now()}_${testCount}`;
    const module = await import(moduleUrl);
    return module.depVersions;
  };

  test('should return an empty object if no package.json is found', async () => {
    // testDir has no package.json
    const deps = await loadDepVersions();
    expect(deps).toEqual({});
  });

  test('should return an empty object if package.json has no dependencies or devDependencies', async () => {
    fs.writeFileSync(
      path.join(testDir, 'package.json'),
      JSON.stringify({ name: 'test-app' }),
    );

    const deps = await loadDepVersions();
    expect(deps).toEqual({});
  });

  test('should resolve versions for dependencies and devDependencies and sort keys', async () => {
    fs.writeFileSync(
      path.join(testDir, 'package.json'),
      JSON.stringify({
        dependencies: {
          zeta: '^1.0.0',
          alpha: '^2.0.0',
        },
        devDependencies: {
          beta: '^3.0.0',
        },
      }),
    );

    const depsToCreate = [
      { name: 'zeta', version: '1.0.5' },
      { name: 'alpha', version: '2.1.0' },
      { name: 'beta', version: '3.0.1' },
    ];

    for (const dep of depsToCreate) {
      const depDir = path.join(testDir, 'node_modules', dep.name);
      fs.mkdirSync(depDir, { recursive: true });
      fs.writeFileSync(
        path.join(depDir, 'package.json'),
        JSON.stringify({ version: dep.version }),
      );
    }

    const deps = await loadDepVersions();

    // Check that versions are resolved
    expect(deps).toEqual({
      alpha: '2.1.0',
      beta: '3.0.1',
      zeta: '1.0.5',
    });

    // Check that keys are sorted alphabetically
    const keys = Object.keys(deps);
    expect(keys).toEqual(['alpha', 'beta', 'zeta']);
  });

  test('should skip dependencies that cannot be resolved without throwing an error', async () => {
    fs.writeFileSync(
      path.join(testDir, 'package.json'),
      JSON.stringify({
        dependencies: {
          exists: '^1.0.0',
          missing: '^2.0.0',
        },
      }),
    );

    // Only create 'exists'
    const existsDir = path.join(testDir, 'node_modules', 'exists');
    fs.mkdirSync(existsDir, { recursive: true });
    fs.writeFileSync(
      path.join(existsDir, 'package.json'),
      JSON.stringify({ version: '1.0.0' }),
    );

    const deps = await loadDepVersions();
    expect(deps).toEqual({
      exists: '1.0.0',
    });
  });

  test('should deduplicate dependencies appearing in both dependencies and devDependencies', async () => {
    fs.writeFileSync(
      path.join(testDir, 'package.json'),
      JSON.stringify({
        dependencies: {
          shared: '^1.0.0',
        },
        devDependencies: {
          shared: '^1.0.0',
        },
      }),
    );

    const sharedDir = path.join(testDir, 'node_modules', 'shared');
    fs.mkdirSync(sharedDir, { recursive: true });
    fs.writeFileSync(
      path.join(sharedDir, 'package.json'),
      JSON.stringify({ version: '1.0.2' }),
    );

    const deps = await loadDepVersions();
    expect(deps).toEqual({
      shared: '1.0.2',
    });
  });
});
