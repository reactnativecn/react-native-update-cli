"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "commands", {
    enumerable: true,
    get: function() {
        return commands;
    }
});
const _utils = require("./utils");
const _api = require("./api");
const _crypto = /*#__PURE__*/ _interop_require_default(require("crypto"));
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
function md5(str) {
    return _crypto.default.createHash('md5').update(str).digest('hex');
}
const commands = {
    login: async function({ args }) {
        const email = args[0] || await (0, _utils.question)('email:');
        const pwd = args[1] || await (0, _utils.question)('password:', true);
        const { token, info } = await (0, _api.post)('/user/login', {
            email,
            pwd: md5(pwd)
        });
        (0, _api.replaceSession)({
            token
        });
        await (0, _api.saveSession)();
        console.log(`欢迎使用 pushy 热更新服务， ${info.name}.`);
    },
    logout: async function() {
        await (0, _api.closeSession)();
        console.log('已退出登录');
    },
    me: async function() {
        const me = await (0, _api.get)('/user/me');
        for(const k in me){
            if (k !== 'ok') {
                console.log(`${k}: ${me[k]}`);
            }
        }
    }
};
