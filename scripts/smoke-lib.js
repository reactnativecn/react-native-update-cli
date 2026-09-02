#!/usr/bin/env node
// Loads every module of the built CLI and runs its offline commands on the
// current Node.js. CI runs this on the oldest supported Node (see engines), so
// a dependency or an API that needs a newer runtime fails here rather than on
// a user's machine; the test suite itself runs under bun and cannot tell.

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const lib = path.resolve(__dirname, '..', 'lib');
if (!fs.existsSync(lib)) {
  console.error('lib/ not found: run `bun run build` first');
  process.exit(1);
}

// these two run the CLI when required
const entryPoints = new Set(['bin.js', 'bin-cresc.js']);

function listJs(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listJs(full));
    } else if (entry.name.endsWith('.js')) {
      files.push(full);
    }
  }
  return files.sort();
}

let loaded = 0;
for (const file of listJs(lib)) {
  if (entryPoints.has(path.relative(lib, file))) continue;
  require(file);
  loaded += 1;
}
console.log(
  `smoke: loaded ${loaded} modules from lib/ on node ${process.version}`,
);

function runCli(args) {
  const result = spawnSync(
    process.execPath,
    [path.join(lib, 'bin.js'), ...args],
    {
      encoding: 'utf8',
      env: { ...process.env, NO_INTERACTIVE: 'true', RNU_AUTO_UPDATE: '0' },
    },
  );
  const command = `pushy ${args.join(' ')}`;
  if (result.status !== 0) {
    console.error(result.stdout);
    console.error(result.stderr);
    throw new Error(`${command} exited with ${result.status}`);
  }
  // a deprecation or experimental warning on every command is a bug (it was
  // the punycode DEP0040 warning from node-fetch until 2.24)
  if (/(Deprecation|Experimental)Warning/.test(result.stderr)) {
    throw new Error(`${command} printed a runtime warning:\n${result.stderr}`);
  }
  return result;
}

runCli(['help']);
runCli(['-v']);
console.log('smoke: `help` and `-v` ran without warnings');
