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
    choosePackage: function() {
        return choosePackage;
    },
    commands: function() {
        return commands;
    },
    listPackage: function() {
        return listPackage;
    }
});
const _api = require("./api");
const _utils = require("./utils");
const _app = require("./app");
const _ttytable = /*#__PURE__*/ _interop_require_default(require("tty-table"));
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
async function listPackage(appId) {
    const { data } = await (0, _api.get)(`/app/${appId}/package/list?limit=1000`);
    const header = [
        {
            value: '原生包 Id'
        },
        {
            value: '原生版本'
        }
    ];
    const rows = [];
    for (const pkg of data){
        const { version } = pkg;
        let versionInfo = '';
        if (version) {
            versionInfo = `, 已绑定：${version.name} (${version.id})`;
        } else {
        // versionInfo = ' (newest)';
        }
        let output = pkg.name;
        if (pkg.status === 'paused') {
            output += '(已暂停)';
        }
        if (pkg.status === 'expired') {
            output += '(已过期)';
        }
        output += versionInfo;
        rows.push([
            pkg.id,
            output
        ]);
    }
    console.log((0, _ttytable.default)(header, rows).render());
    console.log(`\n共 ${data.length} 个包`);
    return data;
}
async function choosePackage(appId) {
    const list = await listPackage(appId);
    while(true){
        const id = await (0, _utils.question)('输入原生包 id:');
        const app = list.find((v)=>v.id === (id | 0));
        if (app) {
            return app;
        }
    }
}
const commands = {
    uploadIpa: async function({ args }) {
        const fn = args[0];
        if (!fn || !fn.endsWith('.ipa')) {
            throw new Error('使用方法: pushy uploadIpa ipa后缀文件');
        }
        const { versionName, buildTime, appId: appIdInPkg, appKey: appKeyInPkg } = await (0, _utils.getIpaInfo)(fn);
        const { appId, appKey } = await (0, _app.getSelectedApp)('ios');
        if (appIdInPkg && appIdInPkg != appId) {
            throw new Error(`appId不匹配！当前ipa: ${appIdInPkg}, 当前update.json: ${appId}`);
        }
        if (appKeyInPkg && appKeyInPkg !== appKey) {
            throw new Error(`appKey不匹配！当前ipa: ${appKeyInPkg}, 当前update.json: ${appKey}`);
        }
        const { hash } = await (0, _api.uploadFile)(fn);
        const { id } = await (0, _api.post)(`/app/${appId}/package/create`, {
            name: versionName,
            hash,
            buildTime
        });
        (0, _utils.saveToLocal)(fn, `${appId}/package/${id}.ipa`);
        console.log(`已成功上传ipa原生包（id: ${id}, version: ${versionName}, buildTime: ${buildTime}）`);
    },
    uploadApk: async function({ args }) {
        const fn = args[0];
        if (!fn || !fn.endsWith('.apk')) {
            throw new Error('使用方法: pushy uploadApk apk后缀文件');
        }
        const { versionName, buildTime, appId: appIdInPkg, appKey: appKeyInPkg } = await (0, _utils.getApkInfo)(fn);
        const { appId, appKey } = await (0, _app.getSelectedApp)('android');
        if (appIdInPkg && appIdInPkg != appId) {
            throw new Error(`appId不匹配！当前apk: ${appIdInPkg}, 当前update.json: ${appId}`);
        }
        if (appKeyInPkg && appKeyInPkg !== appKey) {
            throw new Error(`appKey不匹配！当前apk: ${appKeyInPkg}, 当前update.json: ${appKey}`);
        }
        const { hash } = await (0, _api.uploadFile)(fn);
        const { id } = await (0, _api.post)(`/app/${appId}/package/create`, {
            name: versionName,
            hash,
            buildTime
        });
        (0, _utils.saveToLocal)(fn, `${appId}/package/${id}.apk`);
        console.log(`已成功上传apk原生包（id: ${id}, version: ${versionName}, buildTime: ${buildTime}）`);
    },
    parseIpa: async function({ args }) {
        const fn = args[0];
        if (!fn || !fn.endsWith('.ipa')) {
            throw new Error('使用方法: pushy parseIpa ipa后缀文件');
        }
        console.log(await (0, _utils.getIpaInfo)(fn));
    },
    parseApk: async function({ args }) {
        const fn = args[0];
        if (!fn || !fn.endsWith('.apk')) {
            throw new Error('使用方法: pushy parseApk apk后缀文件');
        }
        console.log(await (0, _utils.getApkInfo)(fn));
    },
    packages: async function({ options }) {
        const platform = (0, _app.checkPlatform)(options.platform || await (0, _utils.question)('平台(ios/android):'));
        const { appId } = await (0, _app.getSelectedApp)(platform);
        await listPackage(appId);
    }
};
