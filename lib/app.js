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
    checkPlatform: function() {
        return checkPlatform;
    },
    chooseApp: function() {
        return chooseApp;
    },
    commands: function() {
        return commands;
    },
    getSelectedApp: function() {
        return getSelectedApp;
    },
    listApp: function() {
        return listApp;
    }
});
const _utils = require("./utils");
const _fs = /*#__PURE__*/ _interop_require_default(require("fs"));
const _ttytable = /*#__PURE__*/ _interop_require_default(require("tty-table"));
const _api = require("./api");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
const validPlatforms = {
    ios: 1,
    android: 1,
    harmony: 1
};
function checkPlatform(platform) {
    if (!validPlatforms[platform]) {
        throw new Error(`无法识别的平台 '${platform}'`);
    }
    return platform;
}
function getSelectedApp(platform) {
    checkPlatform(platform);
    if (!_fs.default.existsSync('update.json')) {
        throw new Error(`App not selected. run 'pushy selectApp --platform ${platform}' first!`);
    }
    const updateInfo = JSON.parse(_fs.default.readFileSync('update.json', 'utf8'));
    if (!updateInfo[platform]) {
        throw new Error(`App not selected. run 'pushy selectApp --platform ${platform}' first!`);
    }
    return updateInfo[platform];
}
async function listApp(platform) {
    const { data } = await (0, _api.get)('/app/list');
    const list = platform ? data.filter((v)=>v.platform === platform) : data;
    const header = [
        {
            value: '应用 id'
        },
        {
            value: '应用名称'
        },
        {
            value: '平台'
        }
    ];
    const rows = [];
    for (const app of list){
        rows.push([
            app.id,
            app.name,
            app.platform
        ]);
    }
    console.log((0, _ttytable.default)(header, rows).render());
    if (platform) {
        console.log(`\共 ${list.length} ${platform} 个应用`);
    } else {
        console.log(`\共 ${list.length} 个应用`);
    }
    return list;
}
async function chooseApp(platform) {
    const list = await listApp(platform);
    while(true){
        const id = await (0, _utils.question)('输入应用 id:');
        const app = list.find((v)=>v.id === (id | 0));
        if (app) {
            return app;
        }
    }
}
const commands = {
    createApp: async function({ options }) {
        const name = options.name || await (0, _utils.question)('应用名称:');
        const { downloadUrl } = options;
        const platform = checkPlatform(options.platform || await (0, _utils.question)('平台(ios/android):'));
        const { id } = await (0, _api.post)('/app/create', {
            name,
            platform
        });
        console.log(`已成功创建应用（id: ${id}）`);
        await this.selectApp({
            args: [
                id
            ],
            options: {
                platform,
                downloadUrl
            }
        });
    },
    deleteApp: async function({ args, options }) {
        const { platform } = options;
        const id = args[0] || chooseApp(platform);
        if (!id) {
            console.log('已取消');
        }
        await (0, _api.doDelete)(`/app/${id}`);
        console.log('操作成功');
    },
    apps: async function({ options }) {
        const { platform } = options;
        listApp(platform);
    },
    selectApp: async function({ args, options }) {
        const platform = checkPlatform(options.platform || await (0, _utils.question)('平台(ios/android):'));
        const id = args[0] ? parseInt(args[0]) : (await chooseApp(platform)).id;
        let updateInfo = {};
        if (_fs.default.existsSync('update.json')) {
            try {
                updateInfo = JSON.parse(_fs.default.readFileSync('update.json', 'utf8'));
            } catch (e) {
                console.error('Failed to parse file `update.json`. Try to remove it manually.');
                throw e;
            }
        }
        const { appKey } = await (0, _api.get)(`/app/${id}`);
        updateInfo[platform] = {
            appId: id,
            appKey
        };
        _fs.default.writeFileSync('update.json', JSON.stringify(updateInfo, null, 4), 'utf8');
    }
};
