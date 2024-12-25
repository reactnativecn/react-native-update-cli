#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
const _api = require("./api");
const _updatenotifier = /*#__PURE__*/ _interop_require_default(require("update-notifier"));
const _index = require("./utils/index.js");
const _packagejson = /*#__PURE__*/ _interop_require_default(require("../package.json"));
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
(0, _updatenotifier.default)({
    pkg: _packagejson.default
}).notify({
    isGlobal: true,
    message: '建议运行 `{updateCommand}` 来更新命令行工具以获得功能、性能和安全性的持续改进'
});
function printUsage() {
    // const commandName = args[0];
    // TODO: print usage of commandName, or print global usage.
    console.log('Usage is under development now.');
    console.log('Visit `https://github.com/reactnativecn/react-native-pushy` for early document.');
    process.exit(1);
}
const commands = {
    ...require('./user').commands,
    ...require('./bundle').commands,
    ...require('./app').commands,
    ...require('./package').commands,
    ...require('./versions').commands,
    ...require('./hash').commands,
    help: printUsage
};
async function run() {
    await (0, _index.printVersionCommand)();
    if (process.argv.indexOf('-v') >= 0 || process.argv[2] === 'version') {
        process.exit();
    }
    const argv = require('cli-arguments').parse(require('../cli.json'));
    global.NO_INTERACTIVE = argv.options['no-interactive'];
    global.USE_ACC_OSS = argv.options['acc'];
    (0, _api.loadSession)().then(()=>commands[argv.command](argv)).catch((err)=>{
        if (err.status === 401) {
            console.log('尚未登录。\n请在项目目录中运行`pushy login`命令来登录');
            return;
        }
        console.error(err.stack);
        process.exit(-1);
    });
}
run();
