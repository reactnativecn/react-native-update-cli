"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    getApkInfo: function() {
        return getApkInfo;
    },
    getIpaInfo: function() {
        return getIpaInfo;
    },
    getRNVersion: function() {
        return getRNVersion;
    },
    pricingPageUrl: function() {
        return pricingPageUrl;
    },
    printVersionCommand: function() {
        return printVersionCommand;
    },
    question: function() {
        return question;
    },
    saveToLocal: function() {
        return saveToLocal;
    },
    translateOptions: function() {
        return translateOptions;
    }
});
const _fsextra = /*#__PURE__*/ _interop_require_default(require("fs-extra"));
const _nodeos = /*#__PURE__*/ _interop_require_default(require("node:os"));
const _nodepath = /*#__PURE__*/ _interop_require_default(require("node:path"));
const _packagejson = /*#__PURE__*/ _interop_require_default(require("../../package.json"));
const _appinfoparser = /*#__PURE__*/ _interop_require_default(require("./app-info-parser"));
const _satisfies = /*#__PURE__*/ _interop_require_default(require("semver/functions/satisfies"));
const _chalk = /*#__PURE__*/ _interop_require_default(require("chalk"));
const _latestversion = /*#__PURE__*/ _interop_require_default(require("@badisi/latest-version"));
const _read = require("read");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
async function question(query, password) {
    if (NO_INTERACTIVE) {
        return '';
    }
    return (0, _read.read)({
        prompt: query,
        silent: password,
        replace: password ? '*' : undefined
    });
}
function translateOptions(options) {
    const ret = {};
    for(let key in options){
        const v = options[key];
        if (typeof v === 'string') {
            ret[key] = v.replace(/\$\{(\w+)\}/g, function(v, n) {
                return options[n] || process.env[n] || v;
            });
        } else {
            ret[key] = v;
        }
    }
    return ret;
}
function getRNVersion() {
    const version = JSON.parse(_fsextra.default.readFileSync(require.resolve('react-native/package.json', {
        paths: [
            process.cwd()
        ]
    }))).version;
    // We only care about major and minor version.
    const match = /^(\d+)\.(\d+)\./.exec(version);
    return {
        version,
        major: match[1] | 0,
        minor: match[2] | 0
    };
}
async function getApkInfo(fn) {
    const appInfoParser = new _appinfoparser.default(fn);
    const bundleFile = await appInfoParser.parser.getEntry(/assets\/index.android.bundle/);
    if (!bundleFile) {
        throw new Error('找不到bundle文件。请确保此apk为release版本，且bundle文件名为默认的index.android.bundle');
    }
    const updateJsonFile = await appInfoParser.parser.getEntry(/res\/raw\/update.json/);
    let appCredential = {};
    if (updateJsonFile) {
        appCredential = JSON.parse(updateJsonFile.toString()).android;
    }
    const { versionName, application } = await appInfoParser.parse();
    let buildTime = 0;
    if (Array.isArray(application.metaData)) {
        for (const meta of application.metaData){
            if (meta.name === 'pushy_build_time') {
                buildTime = meta.value[0];
            }
        }
    }
    if (buildTime == 0) {
        throw new Error('无法获取此包的编译时间戳。请更新 react-native-update 到最新版本后重新打包上传。');
    }
    return {
        versionName,
        buildTime,
        ...appCredential
    };
}
async function getIpaInfo(fn) {
    const appInfoParser = new _appinfoparser.default(fn);
    const bundleFile = await appInfoParser.parser.getEntry(/payload\/.+?\.app\/main.jsbundle/);
    if (!bundleFile) {
        throw new Error('找不到bundle文件。请确保此ipa为release版本，且bundle文件名为默认的main.jsbundle');
    }
    const updateJsonFile = await appInfoParser.parser.getEntry(/payload\/.+?\.app\/assets\/update.json/);
    let appCredential = {};
    if (updateJsonFile) {
        appCredential = JSON.parse(updateJsonFile.toString()).ios;
    }
    const { CFBundleShortVersionString: versionName } = await appInfoParser.parse();
    let buildTimeTxtBuffer = await appInfoParser.parser.getEntry(/payload\/.+?\.app\/pushy_build_time.txt/);
    if (!buildTimeTxtBuffer) {
        // Not in root bundle when use `use_frameworks`
        buildTimeTxtBuffer = await appInfoParser.parser.getEntry(/payload\/.+?\.app\/frameworks\/react_native_update.framework\/pushy_build_time.txt/);
    }
    if (!buildTimeTxtBuffer) {
        throw new Error('无法获取此包的编译时间戳。请更新 react-native-update 到最新版本后重新打包上传。');
    }
    const buildTime = buildTimeTxtBuffer.toString().replace('\n', '');
    return {
        versionName,
        buildTime,
        ...appCredential
    };
}
const localDir = _nodepath.default.resolve(_nodeos.default.homedir(), '.pushy');
_fsextra.default.ensureDirSync(localDir);
function saveToLocal(originPath, destName) {
// TODO
// const destPath = path.join(localDir, destName);
// fs.ensureDirSync(path.dirname(destPath));
// fs.copyFileSync(originPath, destPath);
}
async function getLatestVersion(pkgName) {
    return Promise.race([
        (0, _latestversion.default)(pkgName).then((p)=>p.latest).catch(()=>''),
        new Promise((resolve)=>setTimeout(()=>resolve(''), 2000))
    ]);
}
async function printVersionCommand() {
    let latestPushyCliVersion = await getLatestVersion('react-native-update-cli');
    latestPushyCliVersion = latestPushyCliVersion ? ` （最新：${_chalk.default.green(latestPushyCliVersion)}）` : '';
    console.log(`react-native-update-cli: ${_packagejson.default.version}${latestPushyCliVersion}`);
    let pushyVersion = '';
    try {
        const PACKAGE_JSON_PATH = require.resolve('react-native-update/package.json', {
            paths: [
                process.cwd()
            ]
        });
        pushyVersion = require(PACKAGE_JSON_PATH).version;
        let latestPushyVersion = await getLatestVersion('react-native-update');
        latestPushyVersion = latestPushyVersion ? ` （最新：${_chalk.default.green(latestPushyVersion)}）` : '';
        console.log(`react-native-update: ${pushyVersion}${latestPushyVersion}`);
    } catch (e) {
        console.log('react-native-update: 无法获取版本号，请在项目目录中运行命令');
    }
    if (pushyVersion) {
        if ((0, _satisfies.default)(pushyVersion, '<8.5.2')) {
            console.warn(`当前版本已不再支持，请至少升级到 v8 的最新小版本后重新打包（代码无需改动）: npm i react-native-update@8 .
        如有使用安装 apk 的功能，请注意添加所需权限 https://pushy.reactnative.cn/docs/api#async-function-downloadandinstallapkurl`);
        } else if ((0, _satisfies.default)(pushyVersion, '9.0.0 - 9.2.1')) {
            console.warn(`当前版本已不再支持，请至少升级到 v9 的最新小版本后重新打包（代码无需改动，可直接热更）: npm i react-native-update@9 .
        如有使用安装 apk 的功能，请注意添加所需权限 https://pushy.reactnative.cn/docs/api#async-function-downloadandinstallapkurl`);
        } else if ((0, _satisfies.default)(pushyVersion, '10.0.0 - 10.17.0')) {
            console.warn(`当前版本已不再支持，请升级到 v10 的最新小版本（代码无需改动，可直接热更）: npm i react-native-update@10`);
        }
    }
}
const pricingPageUrl = 'https://pushy.reactnative.cn/pricing.html';
