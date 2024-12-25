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
const _fsextra = /*#__PURE__*/ _interop_require_wildcard(require("fs-extra"));
const _yazl = require("yazl");
const _yauzl = require("yauzl");
const _app = require("./app");
const _nodechild_process = require("node:child_process");
const _os = /*#__PURE__*/ _interop_require_default(require("os"));
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
function _getRequireWildcardCache(nodeInterop) {
    if (typeof WeakMap !== "function") return null;
    var cacheBabelInterop = new WeakMap();
    var cacheNodeInterop = new WeakMap();
    return (_getRequireWildcardCache = function(nodeInterop) {
        return nodeInterop ? cacheNodeInterop : cacheBabelInterop;
    })(nodeInterop);
}
function _interop_require_wildcard(obj, nodeInterop) {
    if (!nodeInterop && obj && obj.__esModule) {
        return obj;
    }
    if (obj === null || typeof obj !== "object" && typeof obj !== "function") {
        return {
            default: obj
        };
    }
    var cache = _getRequireWildcardCache(nodeInterop);
    if (cache && cache.has(obj)) {
        return cache.get(obj);
    }
    var newObj = {
        __proto__: null
    };
    var hasPropertyDescriptor = Object.defineProperty && Object.getOwnPropertyDescriptor;
    for(var key in obj){
        if (key !== "default" && Object.prototype.hasOwnProperty.call(obj, key)) {
            var desc = hasPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : null;
            if (desc && (desc.get || desc.set)) {
                Object.defineProperty(newObj, key, desc);
            } else {
                newObj[key] = obj[key];
            }
        }
    }
    newObj.default = obj;
    if (cache) {
        cache.set(obj, newObj);
    }
    return newObj;
}
const g2js = require('gradle-to-js/lib/parser');
const properties = require('properties');
const path = require('path');
let bsdiff, hdiff, diff;
try {
    bsdiff = require('node-bsdiff').diff;
} catch (e) {}
try {
    hdiff = require('node-hdiffpatch').diff;
} catch (e) {}
async function runReactNativeBundleCommand(bundleName, development, entryFile, outputFolder, platform, sourcemapOutput, config) {
    let gradleConfig = {};
    if (platform === 'android') {
        gradleConfig = await checkGradleConfig();
        if (gradleConfig.crunchPngs !== false) {
            console.warn('android 的 crunchPngs 选项似乎尚未禁用（如已禁用则请忽略此提示），这可能导致热更包体积异常增大，具体请参考 https://pushy.reactnative.cn/docs/getting-started.html#%E7%A6%81%E7%94%A8-android-%E7%9A%84-crunch-%E4%BC%98%E5%8C%96 \n');
        }
    }
    let reactNativeBundleArgs = [];
    let envArgs = process.env.PUSHY_ENV_ARGS;
    if (envArgs) {
        Array.prototype.push.apply(reactNativeBundleArgs, envArgs.trim().split(/\s+/));
    }
    _fsextra.emptyDirSync(outputFolder);
    let cliPath;
    try {
        // rn >= 0.75
        cliPath = require.resolve('@react-native-community/cli/build/bin.js', {
            paths: [
                process.cwd()
            ]
        });
    } catch (e) {
        // rn < 0.75
        cliPath = require.resolve('react-native/local-cli/cli.js', {
            paths: [
                process.cwd()
            ]
        });
    }
    let usingExpo = false;
    try {
        require.resolve('expo-router', {
            paths: [
                process.cwd()
            ]
        });
        console.log(`expo-router detected, will use @expo/cli to bundle.\n`);
        // if using expo-router, use expo-cli
        cliPath = require.resolve('@expo/cli', {
            paths: [
                process.cwd()
            ]
        });
        usingExpo = true;
    } catch (e) {}
    const bundleCommand = usingExpo ? 'export:embed' : platform === 'harmony' ? 'bundle-harmony' : 'bundle';
    if (platform == 'harmony') {
        Array.prototype.push.apply(reactNativeBundleArgs, [
            cliPath,
            bundleCommand,
            '--dev',
            development,
            '--entry-file',
            entryFile
        ]);
        if (sourcemapOutput) {
            reactNativeBundleArgs.push('--sourcemap-output', sourcemapOutput);
        }
        if (config) {
            reactNativeBundleArgs.push('--config', config);
        }
    } else {
        Array.prototype.push.apply(reactNativeBundleArgs, [
            cliPath,
            bundleCommand,
            '--assets-dest',
            outputFolder,
            '--bundle-output',
            path.join(outputFolder, bundleName),
            '--dev',
            development,
            '--entry-file',
            entryFile,
            '--platform',
            platform,
            '--reset-cache'
        ]);
        if (sourcemapOutput) {
            reactNativeBundleArgs.push('--sourcemap-output', sourcemapOutput);
        }
        if (config) {
            reactNativeBundleArgs.push('--config', config);
        }
    }
    const reactNativeBundleProcess = (0, _nodechild_process.spawn)('node', reactNativeBundleArgs);
    console.log(`Running bundle command: node ${reactNativeBundleArgs.join(' ')}`);
    return new Promise((resolve, reject)=>{
        reactNativeBundleProcess.stdout.on('data', (data)=>{
            console.log(data.toString().trim());
        });
        reactNativeBundleProcess.stderr.on('data', (data)=>{
            console.error(data.toString().trim());
        });
        reactNativeBundleProcess.on('close', async (exitCode)=>{
            if (exitCode) {
                reject(new Error(`"react-native bundle" command exited with code ${exitCode}.`));
            } else {
                let hermesEnabled = false;
                if (platform === 'android') {
                    const gradlePropeties = await new Promise((resolve)=>{
                        properties.parse('./android/gradle.properties', {
                            path: true
                        }, function(error, props) {
                            if (error) {
                                console.error(error);
                                resolve(null);
                            }
                            resolve(props);
                        });
                    });
                    hermesEnabled = gradlePropeties.hermesEnabled;
                    if (typeof hermesEnabled !== 'boolean') hermesEnabled = gradleConfig.enableHermes;
                } else if (platform === 'ios' && _fsextra.existsSync('ios/Pods/hermes-engine')) {
                    hermesEnabled = true;
                } else if (platform === 'harmony') {
                    await copyHarmonyBundle(outputFolder);
                }
                if (hermesEnabled) {
                    await compileHermesByteCode(bundleName, outputFolder, sourcemapOutput);
                }
                resolve(null);
            }
        });
    });
}
async function copyHarmonyBundle(outputFolder) {
    const harmonyRawPath = 'harmony/entry/src/main/resources/rawfile';
    try {
        await _fsextra.ensureDir(outputFolder);
        await _fsextra.copy(harmonyRawPath, outputFolder);
        console.log(`Successfully copied from ${harmonyRawPath} to ${outputFolder}`);
    } catch (error) {
        console.error('Error in copyHarmonyBundle:', error);
    }
}
function getHermesOSBin() {
    if (_os.default.platform() === 'win32') return 'win64-bin';
    if (_os.default.platform() === 'darwin') return 'osx-bin';
    if (_os.default.platform() === 'linux') return 'linux64-bin';
}
async function checkGradleConfig() {
    let enableHermes = false;
    let crunchPngs;
    try {
        const gradleConfig = await g2js.parseFile('android/app/build.gradle');
        crunchPngs = gradleConfig.android.buildTypes.release.crunchPngs;
        const projectConfig = gradleConfig['project.ext.react'];
        if (projectConfig) {
            for (const packagerConfig of projectConfig){
                if (packagerConfig.includes('enableHermes') && packagerConfig.includes('true')) {
                    enableHermes = true;
                    break;
                }
            }
        }
    } catch (e) {}
    return {
        enableHermes,
        crunchPngs
    };
}
async function compileHermesByteCode(bundleName, outputFolder, sourcemapOutput) {
    console.log(`Hermes enabled, now compiling to hermes bytecode:\n`);
    // >= rn 0.69
    const rnDir = path.dirname(require.resolve('react-native', {
        paths: [
            process.cwd()
        ]
    }));
    let hermesPath = path.join(rnDir, `/sdks/hermesc/${getHermesOSBin()}`);
    // < rn 0.69
    if (!_fsextra.existsSync(hermesPath)) {
        hermesPath = `node_modules/hermes-engine/${getHermesOSBin()}`;
    }
    const hermesCommand = `${hermesPath}/hermesc`;
    const args = [
        '-emit-binary',
        '-out',
        path.join(outputFolder, bundleName),
        path.join(outputFolder, bundleName),
        '-O'
    ];
    if (sourcemapOutput) {
        _fsextra.copyFileSync(sourcemapOutput, path.join(outputFolder, bundleName + '.txt.map'));
        args.push('-output-source-map');
    }
    console.log('Running hermesc: ' + hermesCommand + ' ' + args.join(' ') + '\n');
    (0, _nodechild_process.spawnSync)(hermesCommand, args, {
        stdio: 'ignore'
    });
    if (sourcemapOutput) {
        const composerPath = 'node_modules/react-native/scripts/compose-source-maps.js';
        if (!_fsextra.existsSync(composerPath)) {
            return;
        }
        console.log(`Composing source map`);
        (0, _nodechild_process.spawnSync)('node', [
            composerPath,
            path.join(outputFolder, bundleName + '.txt.map'),
            path.join(outputFolder, bundleName + '.map'),
            '-o',
            sourcemapOutput
        ], {
            stdio: 'ignore'
        });
    }
    _fsextra.removeSync(path.join(outputFolder, bundleName + '.txt.map'));
}
async function pack(dir, output) {
    console.log('Packing');
    _fsextra.ensureDirSync(path.dirname(output));
    await new Promise((resolve, reject)=>{
        const zipfile = new _yazl.ZipFile();
        function addDirectory(root, rel) {
            if (rel) {
                zipfile.addEmptyDirectory(rel);
            }
            const childs = _fsextra.readdirSync(root);
            for (const name of childs){
                if (name === '.' || name === '..' || name === 'index.bundlejs.map') {
                    continue;
                }
                const fullPath = path.join(root, name);
                const stat = _fsextra.statSync(fullPath);
                if (stat.isFile()) {
                    console.log('adding: ' + rel + name);
                    zipfile.addFile(fullPath, rel + name);
                } else if (stat.isDirectory()) {
                    console.log('adding: ' + rel + name + '/');
                    addDirectory(fullPath, rel + name + '/');
                }
            }
        }
        addDirectory(dir, '');
        zipfile.outputStream.on('error', (err)=>reject(err));
        zipfile.outputStream.pipe(_fsextra.createWriteStream(output)).on('close', function() {
            resolve();
        });
        zipfile.end();
    });
    console.log('ppk热更包已生成并保存到: ' + output);
}
function readEntire(entry, zipFile) {
    const buffers = [];
    return new Promise((resolve, reject)=>{
        zipFile.openReadStream(entry, (err, stream)=>{
            stream.pipe({
                write (chunk) {
                    buffers.push(chunk);
                },
                end () {
                    resolve(Buffer.concat(buffers));
                },
                prependListener () {},
                on () {},
                once () {},
                emit () {}
            });
        });
    });
}
function basename(fn) {
    const m = /^(.+\/)[^\/]+\/?$/.exec(fn);
    return m && m[1];
}
async function diffFromPPK(origin, next, output) {
    _fsextra.ensureDirSync(path.dirname(output));
    const originEntries = {};
    const originMap = {};
    let originSource;
    await enumZipEntries(origin, (entry, zipFile)=>{
        originEntries[entry.fileName] = entry;
        if (!/\/$/.test(entry.fileName)) {
            // isFile
            originMap[entry.crc32] = entry.fileName;
            if (entry.fileName === 'index.bundlejs' || entry.fileName === 'bundle.harmony.js') {
                // This is source.
                return readEntire(entry, zipFile).then((v)=>originSource = v);
            }
        }
    });
    if (!originSource) {
        throw new Error(`Bundle file not found! Please use default bundle file name and path.`);
    }
    const copies = {};
    const zipfile = new _yazl.ZipFile();
    const writePromise = new Promise((resolve, reject)=>{
        zipfile.outputStream.on('error', (err)=>{
            throw err;
        });
        zipfile.outputStream.pipe(_fsextra.createWriteStream(output)).on('close', function() {
            resolve();
        });
    });
    const addedEntry = {};
    function addEntry(fn) {
        //console.log(fn);
        if (!fn || addedEntry[fn]) {
            return;
        }
        const base = basename(fn);
        if (base) {
            addEntry(base);
        }
        zipfile.addEmptyDirectory(fn);
    }
    const newEntries = {};
    await enumZipEntries(next, (entry, nextZipfile)=>{
        newEntries[entry.fileName] = entry;
        if (/\/$/.test(entry.fileName)) {
            // Directory
            if (!originEntries[entry.fileName]) {
                addEntry(entry.fileName);
            }
        } else if (entry.fileName === 'index.bundlejs') {
            //console.log('Found bundle');
            return readEntire(entry, nextZipfile).then((newSource)=>{
                //console.log('Begin diff');
                zipfile.addBuffer(diff(originSource, newSource), 'index.bundlejs.patch');
            //console.log('End diff');
            });
        } else if (entry.fileName === 'bundle.harmony.js') {
            //console.log('Found bundle');
            return readEntire(entry, nextZipfile).then((newSource)=>{
                //console.log('Begin diff');
                zipfile.addBuffer(diff(originSource, newSource), 'bundle.harmony.js.patch');
            //console.log('End diff');
            });
        } else {
            // If same file.
            const originEntry = originEntries[entry.fileName];
            if (originEntry && originEntry.crc32 === entry.crc32) {
                // ignore
                return;
            }
            // If moved from other place
            if (originMap[entry.crc32]) {
                const base = basename(entry.fileName);
                if (!originEntries[base]) {
                    addEntry(base);
                }
                copies[entry.fileName] = originMap[entry.crc32];
                return;
            }
            // New file.
            addEntry(basename(entry.fileName));
            return new Promise((resolve, reject)=>{
                nextZipfile.openReadStream(entry, function(err, readStream) {
                    if (err) {
                        return reject(err);
                    }
                    zipfile.addReadStream(readStream, entry.fileName);
                    readStream.on('end', ()=>{
                        //console.log('add finished');
                        resolve();
                    });
                });
            });
        }
    });
    const deletes = {};
    for(let k in originEntries){
        if (!newEntries[k]) {
            console.log('Delete ' + k);
            deletes[k] = 1;
        }
    }
    //console.log({copies, deletes});
    zipfile.addBuffer(Buffer.from(JSON.stringify({
        copies,
        deletes
    })), '__diff.json');
    zipfile.end();
    await writePromise;
}
////////////////diffFromPackage
async function diffFromPackage(origin, next, output, originBundleName, transformPackagePath = (v)=>v) {
    _fsextra.ensureDirSync(path.dirname(output));
    const originEntries = {};
    const originMap = {};
    let originSource;
    await enumZipEntries(origin, (entry, zipFile)=>{
        if (!/\/$/.test(entry.fileName)) {
            const fn = transformPackagePath(entry.fileName);
            if (!fn) {
                return;
            }
            //console.log(fn);
            // isFile
            originEntries[fn] = entry.crc32;
            originMap[entry.crc32] = fn;
            if (fn === originBundleName) {
                // This is source.
                return readEntire(entry, zipFile).then((v)=>originSource = v);
            }
        }
    });
    if (!originSource) {
        throw new Error(`Bundle file not found! Please use default bundle file name and path.`);
    }
    const copies = {};
    const zipfile = new _yazl.ZipFile();
    const writePromise = new Promise((resolve, reject)=>{
        zipfile.outputStream.on('error', (err)=>{
            throw err;
        });
        zipfile.outputStream.pipe(_fsextra.createWriteStream(output)).on('close', function() {
            resolve();
        });
    });
    await enumZipEntries(next, (entry, nextZipfile)=>{
        if (/\/$/.test(entry.fileName)) {
            // Directory
            zipfile.addEmptyDirectory(entry.fileName);
        } else if (entry.fileName === 'index.bundlejs') {
            //console.log('Found bundle');
            return readEntire(entry, nextZipfile).then((newSource)=>{
                //console.log('Begin diff');
                zipfile.addBuffer(diff(originSource, newSource), 'index.bundlejs.patch');
            //console.log('End diff');
            });
        } else if (entry.fileName === 'bundle.harmony.js') {
            //console.log('Found bundle');
            return readEntire(entry, nextZipfile).then((newSource)=>{
                //console.log('Begin diff');
                zipfile.addBuffer(diff(originSource, newSource), 'bundle.harmony.js.patch');
            //console.log('End diff');
            });
        } else {
            // If same file.
            if (originEntries[entry.fileName] === entry.crc32) {
                copies[entry.fileName] = '';
                return;
            }
            // If moved from other place
            if (originMap[entry.crc32]) {
                copies[entry.fileName] = originMap[entry.crc32];
                return;
            }
            return new Promise((resolve, reject)=>{
                nextZipfile.openReadStream(entry, function(err, readStream) {
                    if (err) {
                        return reject(err);
                    }
                    zipfile.addReadStream(readStream, entry.fileName);
                    readStream.on('end', ()=>{
                        //console.log('add finished');
                        resolve();
                    });
                });
            });
        }
    });
    zipfile.addBuffer(Buffer.from(JSON.stringify({
        copies
    })), '__diff.json');
    zipfile.end();
    await writePromise;
}
////////////////enumZipEntries
async function enumZipEntries(zipFn, callback, nestedPath = '') {
    return new Promise((resolve, reject)=>{
        (0, _yauzl.open)(zipFn, {
            lazyEntries: true
        }, async (err, zipfile)=>{
            if (err) {
                return reject(err);
            }
            zipfile.on('end', resolve);
            zipfile.on('error', reject);
            zipfile.on('entry', async (entry)=>{
                const fullPath = nestedPath + entry.fileName;
                try {
                    // 检查文件是否为hap
                    if (!entry.fileName.endsWith('/') && entry.fileName.toLowerCase().endsWith('.hap')) {
                        // 读取嵌套的hap文件内容
                        const tempDir = path.join(_os.default.tmpdir(), 'nested_zip_' + Date.now());
                        await _fsextra.ensureDir(tempDir);
                        const tempZipPath = path.join(tempDir, 'temp.zip');
                        // 将嵌套的hap保存到临时文件
                        await new Promise((res, rej)=>{
                            zipfile.openReadStream(entry, async (err, readStream)=>{
                                if (err) return rej(err);
                                const writeStream = _fsextra.createWriteStream(tempZipPath);
                                readStream.pipe(writeStream);
                                writeStream.on('finish', res);
                                writeStream.on('error', rej);
                            });
                        });
                        // 递归遍历嵌套的hap
                        await enumZipEntries(tempZipPath, callback, fullPath + '/');
                        // 清理临时文件
                        await _fsextra.remove(tempDir);
                    }
                    // 处理当前文件
                    const result = callback(entry, zipfile, fullPath);
                    if (result && typeof result.then === 'function') {
                        await result;
                    }
                } catch (error) {
                    console.error('处理文件时出错:', error);
                }
                zipfile.readEntry();
            });
            zipfile.readEntry();
        });
    });
}
function diffArgsCheck(args, options, diffFn) {
    const [origin, next] = args;
    if (!origin || !next) {
        console.error(`Usage: pushy ${diffFn} <origin> <next>`);
        process.exit(1);
    }
    if (diffFn.startsWith('hdiff')) {
        if (!hdiff) {
            console.error(`This function needs "node-hdiffpatch". 
        Please run "npm i node-hdiffpatch" to install`);
            process.exit(1);
        }
        diff = hdiff;
    } else {
        if (!bsdiff) {
            console.error(`This function needs "node-bsdiff". 
        Please run "npm i node-bsdiff" to install`);
            process.exit(1);
        }
        diff = bsdiff;
    }
    const { output } = options;
    return {
        origin,
        next,
        realOutput: output.replace(/\$\{time\}/g, '' + Date.now())
    };
}
const commands = {
    bundle: async function({ options }) {
        const platform = (0, _app.checkPlatform)(options.platform || await (0, _utils.question)('平台(ios/android):'));
        let { bundleName, entryFile, intermediaDir, output, dev, sourcemap } = (0, _utils.translateOptions)({
            ...options,
            platform
        });
        const sourcemapOutput = path.join(intermediaDir, bundleName + '.map');
        const realOutput = output.replace(/\$\{time\}/g, '' + Date.now());
        if (!platform) {
            throw new Error('Platform must be specified.');
        }
        const { version, major, minor } = (0, _utils.getRNVersion)();
        console.log('Bundling with react-native: ', version);
        await runReactNativeBundleCommand(bundleName, dev, entryFile, intermediaDir, platform, sourcemap ? sourcemapOutput : '');
        await pack(path.resolve(intermediaDir), realOutput);
        const v = await (0, _utils.question)('是否现在上传此热更包?(Y/N)');
        if (v.toLowerCase() === 'y') {
            await this.publish({
                args: [
                    realOutput
                ],
                options: {
                    platform
                }
            });
        }
    },
    async diff ({ args, options }) {
        const { origin, next, realOutput } = diffArgsCheck(args, options, 'diff');
        await diffFromPPK(origin, next, realOutput, 'index.bundlejs');
        console.log(`${realOutput} generated.`);
    },
    async hdiff ({ args, options }) {
        const { origin, next, realOutput } = diffArgsCheck(args, options, 'hdiff');
        await diffFromPPK(origin, next, realOutput, 'index.bundlejs');
        console.log(`${realOutput} generated.`);
    },
    async diffFromApk ({ args, options }) {
        const { origin, next, realOutput } = diffArgsCheck(args, options, 'diffFromApk');
        await diffFromPackage(origin, next, realOutput, 'assets/index.android.bundle');
        console.log(`${realOutput} generated.`);
    },
    async hdiffFromApk ({ args, options }) {
        const { origin, next, realOutput } = diffArgsCheck(args, options, 'hdiffFromApk');
        await diffFromPackage(origin, next, realOutput, 'assets/index.android.bundle');
        console.log(`${realOutput} generated.`);
    },
    ////////Adapter Harmony code
    async hdiffFromPPK ({ args, options }) {
        const { origin, next, realOutput } = diffArgsCheck(args, options, 'hdiffFromPPK');
        await diffFromPPK(origin, next, realOutput);
        console.log(`${realOutput} generated.`);
    },
    async hdiffFromApp ({ args, options }) {
        const { origin, next, realOutput } = diffArgsCheck(args, options, 'hdiffFromApp');
        await diffFromPackage(origin, next, realOutput, 'resources/rawfile/bundle.harmony.js');
        console.log(`${realOutput} generated.`);
    },
    ///////////
    async diffFromIpa ({ args, options }) {
        const { origin, next, realOutput } = diffArgsCheck(args, options, 'diffFromIpa');
        await diffFromPackage(origin, next, realOutput, 'main.jsbundle', (v)=>{
            const m = /^Payload\/[^/]+\/(.+)$/.exec(v);
            return m && m[1];
        });
        console.log(`${realOutput} generated.`);
    },
    async hdiffFromIpa ({ args, options }) {
        const { origin, next, realOutput } = diffArgsCheck(args, options, 'hdiffFromIpa');
        await diffFromPackage(origin, next, realOutput, 'main.jsbundle', (v)=>{
            const m = /^Payload\/[^/]+\/(.+)$/.exec(v);
            return m && m[1];
        });
        console.log(`${realOutput} generated.`);
    }
};
