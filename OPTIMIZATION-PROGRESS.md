# 优化进度（2026-08-26，未完成，勿发版）

本轮对 CLI 做了一批性能 / 健壮性修复，代码已全部落盘但**尚未通过全量测试**，
`bun test` 388 pass / 3 fail。继续时先看「剩余工作」。

## 已完成

### hermes-base.ts
- `BundleHashMismatchError` / `PermanentBaseError`：目录方式读到的 entry 与服务端 bundleHash 不符时立即终止（不再回退全量下载、不再重试）；range-entry 位置过期仍允许走目录方式
- 服务端 lookup 失败重试一次（500ms）；下载仅对传输错误重试
- 缓存命中且 `record.bytecodeVersion == null`（legacy / native package）时读 128 字节校验 HBC 版本
- `downloadToFile` / `saveResponse`：30s 首包超时 + 60s 空闲超时
- `cacheLookup` 流式 sha256；`enforceCacheLimits` 清理 >1h 的 `<hash>.<pid>.tmp`，`cleanCache` 一并删除
- 新测试：mismatch 不再全量下载、缓存命中按头校验、tmp 残留清理

### bundle-runner.ts / bundle.ts / cli.json / types.ts / locales / README
- `hermes-base-error.log` 改写到中间目录旁（`hermesBaseErrorLogPath`），不再被打进 ppk
- base 选择改在 spawn Metro 之后启动（同步头部不再延迟 Metro）
- JS bundle rename 进 `.hermes-base/` 工作目录，两个 hermesc 共用输入（零拷贝）；sourcemap 同路径时 rename
- compose-source-maps 改异步，并在校验期间对 base 产物投机执行；base 被拒时用 plain map 重做；composer 缺失不再跳过清理
- 三处 plain 编译合并为 `compilePlain`（runProcess），去掉 hermesc 的 spawnSync
- base 尝试加 `-w`，stderr 头尾各 512KB 截断
- plain 编译失败（非校验失败）新增提示 `hermesBasePlainCompileFailed`，保留 base
- selection 携带 `hermesCommand`；`awaitPendingBase` Metro 结束后最多等 60s（`PUSHY_HERMES_BASE_WAIT_MS`）
- 新选项 `--resetCache`（默认 true），false 不传 `--reset-cache` 给 Metro

### diff.ts / hbcTransform.ts
- "文件移动"匹配改为 crc32 + 解压长度（`zipEntryContentKey`），manifest 格式不变；`tests/diff-integrity.test.ts` 用真实 CRC 碰撞验证
- `writeDiffZip`：失败时销毁输出流、删除半成品 patch
- 流式 diff 的 HBC 变换改为文件级按段读写（`transformHbcFile` / `tryTransformPairFiles`），不再持有整个 bundle；内存路径 `transformHbcWithLayoutInPlace`

### zip-range.ts / zip-entries.ts
- 块缓存只在严格重叠时合并，`readEntry` 单块直接返回（内存 3x → 1x）
- hint 读取不再按 64KB 下限扩大、裁到已缓存块起点
- 后续 Range 请求带 `If-Range`，Content-Range total 变化报错
- 中央目录一律一次 prefetch（去掉 MAX_PREFETCH_BYTES）
- 所有 fetch 加 `AbortSignal.timeout`（`RangeOptions` 可调）
- 嵌套 .hap 临时目录 try/finally 清理；新增 `tests/zip-entries.test.ts`

### 启动 / 上传 / 打包（agent 完成，未完全验证）
- `bin.ts`：npm 最新版检查改为后台并行 + 1 天缓存（`latest-version` 加 `unref`、stale fallback、`XDG_CACHE_HOME`），命令结束后打印提示；`-v` 仍同步
- `http-helper.getBaseUrl` 改为惰性 memoized 函数（离线命令不再 HEAD 探测）；`dep-versions` 改 `getDepVersions()` 惰性 + Proxy 兼容旧用法
- `tty-table` / `app-info-parser` / `form-data` / `progress` 改为 handler 内 lazy require
- zip 压缩级别 9 → 6（`PAYLOAD_COMPRESSION_LEVEL`），manifest 保留 9
- `api.uploadFile`：`sendUpload` 加按大小缩放的超时 + 瞬态错误重试一次（流按次重建）
- `versions.publish`：upload / describePpkBundle / getCommitInfo 并行；`choosePackage` 复用已取的列表；`package.ts` `cachePut` 传已知 hash
- 删除 `test_output.log` 并加入 .gitignore

## 剩余工作

1. **3 个失败测试**
   - `tests/package-optimization.test.ts` ×2：`package.ts:244` `require('tty-table')` 在 bun 下返回 Module 命名空间，`Table is not a function`。修法：`const mod = require('tty-table'); const Table = mod.default ?? mod;`（`versions.ts`、`app.ts` 同样处理），或改回顶部 import。
   - `tests/cli-e2e.test.ts` "runs apps command"：期望 `GET /registry/react-native-update-cli`，实际收到 `GET /registry/npm`。后台版本检查（`utils/index.ts getLatestVersions` → lazy `require('./latest-version')`）在 bun 运行 `src/bin.ts` 时请求路径不对，疑似 bun 下 `getRegistryUrl` / URL 拼接差异（agent 提到 node 下正常）。需排查 `src/utils/latest-version/index.ts` `resolveRegistryUrl`。
2. `bun run lint`（tsc + biome）已通过 `biome check --write .` 格式化，需再确认干净。
3. `bun run build` + `time node lib/bin.js help` 实测启动耗时（目标 ~60ms，原 ~480ms 在线 / 2.2s 断网）。
4. 未做（有意跳过）：native-package 慢在 yazl 重新 deflate（需自写 raw-copy zip writer）；`semver` → `compare-versions` 依赖替换。
5. 全绿后发版：`gh release create vX.Y.Z --target master`（patch bump，publish.yml 取 tag 版本号）。
