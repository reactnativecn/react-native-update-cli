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
    closeSession: function() {
        return closeSession;
    },
    doDelete: function() {
        return doDelete;
    },
    get: function() {
        return get;
    },
    getSession: function() {
        return getSession;
    },
    loadSession: function() {
        return loadSession;
    },
    post: function() {
        return post;
    },
    put: function() {
        return put;
    },
    replaceSession: function() {
        return replaceSession;
    },
    saveSession: function() {
        return saveSession;
    },
    uploadFile: function() {
        return uploadFile;
    }
});
const _nodefetch = /*#__PURE__*/ _interop_require_default(require("node-fetch"));
const _nodefs = /*#__PURE__*/ _interop_require_default(require("node:fs"));
const _nodeutil = /*#__PURE__*/ _interop_require_default(require("node:util"));
const _nodepath = /*#__PURE__*/ _interop_require_default(require("node:path"));
const _progress = /*#__PURE__*/ _interop_require_default(require("progress"));
const _packagejson = /*#__PURE__*/ _interop_require_default(require("../package.json"));
const _tcpping = /*#__PURE__*/ _interop_require_default(require("tcp-ping"));
const _filesizeparser = /*#__PURE__*/ _interop_require_default(require("filesize-parser"));
const _utils = require("./utils");
const _formdata = /*#__PURE__*/ _interop_require_default(require("form-data"));
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
const tcpPing = _nodeutil.default.promisify(_tcpping.default.ping);
let session;
let savedSession;
const defaultEndpoint = 'https://update.reactnative.cn/api';
let host = process.env.PUSHY_REGISTRY || defaultEndpoint;
const userAgent = `react-native-update-cli/${_packagejson.default.version}`;
const getSession = function() {
    return session;
};
const replaceSession = function(newSession) {
    session = newSession;
};
const loadSession = async function() {
    if (_nodefs.default.existsSync('.update')) {
        try {
            replaceSession(JSON.parse(_nodefs.default.readFileSync('.update', 'utf8')));
            savedSession = session;
        } catch (e) {
            console.error('Failed to parse file `.update`. Try to remove it manually.');
            throw e;
        }
    }
};
const saveSession = function() {
    // Only save on change.
    if (session !== savedSession) {
        const current = session;
        const data = JSON.stringify(current, null, 4);
        _nodefs.default.writeFileSync('.update', data, 'utf8');
        savedSession = current;
    }
};
const closeSession = function() {
    if (_nodefs.default.existsSync('.update')) {
        _nodefs.default.unlinkSync('.update');
        savedSession = undefined;
    }
    session = undefined;
    host = process.env.PUSHY_REGISTRY || defaultEndpoint;
};
async function query(url, options) {
    const resp = await (0, _nodefetch.default)(url, options);
    const text = await resp.text();
    let json;
    try {
        json = JSON.parse(text);
    } catch (e) {
        if (resp.statusText.includes('Unauthorized')) {
            throw new Error('登录信息已过期，请使用 pushy login 命令重新登录');
        } else {
            throw new Error(`Server error: ${resp.statusText}`);
        }
    }
    if (resp.status !== 200) {
        throw new Error(`${resp.status}: ${resp.statusText}`);
    }
    return json;
}
function queryWithoutBody(method) {
    return function(api) {
        return query(host + api, {
            method,
            headers: {
                'User-Agent': userAgent,
                'X-AccessToken': session ? session.token : ''
            }
        });
    };
}
function queryWithBody(method) {
    return function(api, body) {
        return query(host + api, {
            method,
            headers: {
                'User-Agent': userAgent,
                'Content-Type': 'application/json',
                'X-AccessToken': session ? session.token : ''
            },
            body: JSON.stringify(body)
        });
    };
}
const get = queryWithoutBody('GET');
const post = queryWithBody('POST');
const put = queryWithBody('PUT');
const doDelete = queryWithBody('DELETE');
async function uploadFile(fn, key) {
    const { url, backupUrl, formData, maxSize } = await post('/upload', {
        ext: _nodepath.default.extname(fn)
    });
    let realUrl = url;
    if (backupUrl) {
        if (global.USE_ACC_OSS) {
            realUrl = backupUrl;
        } else {
            const pingResult = await tcpPing({
                address: url.replace('https://', ''),
                attempts: 4,
                timeout: 1000
            });
            // console.log({pingResult});
            if (isNaN(pingResult.avg) || pingResult.avg > 150) {
                realUrl = backupUrl;
            }
        }
    // console.log({realUrl});
    }
    const fileSize = _nodefs.default.statSync(fn).size;
    if (maxSize && fileSize > (0, _filesizeparser.default)(maxSize)) {
        throw new Error(`此文件大小 ${(fileSize / 1048576).toFixed(1)}m , 超出当前额度 ${maxSize} 。您可以考虑升级付费业务以提升此额度。详情请访问: ${_utils.pricingPageUrl}`);
    }
    const bar = new _progress.default('  上传中 [:bar] :percent :etas', {
        complete: '=',
        incomplete: ' ',
        total: fileSize
    });
    const form = new _formdata.default();
    Object.entries(formData).forEach(([k, v])=>{
        form.append(k, v);
    });
    const fileStream = _nodefs.default.createReadStream(fn);
    fileStream.on('data', function(data) {
        bar.tick(data.length);
    });
    if (key) {
        form.append('key', key);
    }
    form.append('file', fileStream);
    const res = await (0, _nodefetch.default)(realUrl, {
        method: 'POST',
        body: form
    });
    if (res.status > 299) {
        throw new Error(`${res.status}: ${res.statusText}`);
    }
    // const body = await response.json();
    return {
        hash: key || formData.key
    };
}
