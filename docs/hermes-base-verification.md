# Hermes base（`-base-bytecode`）等价校验：现状与待办

`pushy bundle` 在 `--hermesBase auto`（默认）下用上一版 HBC 作 base 编译，让字符串 id 跨版本稳定、热更 patch 变小。`--verifyHermesBase`（默认开）并行再做一次普通编译，把两份产物反汇编后比对；任何不一致或失败都回退到普通编译。

本文记录这套校验**防什么、怎么比、还缺什么**，供后续维护。代码在 `src/utils/hermes-base.ts`（`compareHermesBytecode`）与 `src/bundle-runner.ts`（`compileHermesByteCode`）。

## 1. 防什么

热更链路上的每一层校验（base 的 sha256、设备端 patch 重建后的 `bundleHash` 比对、HBC 头解析）验的都是**字节完整性**，没有一层验**程序语义**。一个合法但语义错误的 HBC 会一路绿灯，直到那个函数在用户设备上被执行。

`-base-bytecode` 的 bug 面集中在**引用映射**：字符串表合并错位（`GetById` 取到别的属性名）、字面量缓冲区偏移算错（数组内容变成别的常量）、function id 指错。这些错误的共同特征是**指令序列不变，只是操作数指向变了**——所以校验必须保留语义层（解析后的字符串、寄存器、指令序列），只折叠编码层（id 编号、操作数宽度、跳转距离、缓冲区偏移）。任何"只比指令骨架"或"只查文件格式"的简化都对这类 bug 失明。

## 2. 怎么比（当前实现）

两侧各起一个 `hermesc -b -dump-bytecode -pretty-disassemble`，流式读取（不落盘，`PUSHY_HERMES_BASE_DEBUG=1` 时例外）：

| 区段 | 处理 |
|---|---|
| `Bytecode File Information` 等头部 | 忽略 |
| `Global String Table` | 只用于解析 id，不比较（delta 会保留 base 的死字符串） |
| `Array Buffer` / `Object Key Buffer` / `Object Value Buffer` | **按内容比较**；`[String N]` 经各自字符串表解析成文本 |
| `Function<…>` 各函数 | 头文本必须相同；正文逐行经 `normalizeDisassemblyLine` 归一化后比较；**按函数分段**，错位不级联 |
| `Debug *` / `Textified callees table` | 排掉（只服务调试器/性能工具） |

`normalizeDisassemblyLine` 折叠的编码层差异：`New*WithBuffer` 只留 size、`J*` 跳转目标、`DefineOwnById*` 的原始 string id → 字面量、`Long/LongIndex/Short` 宽度后缀与列对齐空白、`StringSwitchImm`/`UIntSwitchImm` 跳转表偏移、`offset N` 行、`Offset in debug table` 行。

结果三态：`equivalent` / `different`（带第一处差异：函数、行号、两侧内容，或缓冲区条目）/ `dump-failed`（dump 进程退出码非 0、无法启动、提前结束；带 stderr 末行）。后两种都放弃 base，但日志分开。

已知会在 `-pretty-disassemble` 下打印**原始数字 id** 而非字面量的指令目前只有 `DefineOwnById*`；这类指令是误杀的主要来源，出现新的形态就补一条规则 + 一个用例（`tests/hermes-base.test.ts` 的 `PLAIN_DUMP`/`DELTA_DUMP` 对，或 `tests/hermes-switch-normalization.test.ts`）。

## 3. 待办（按价值排序）

### 3.1 服务端上报校验结果 —— 需要先约契约

`HermesCompileResult.verified` 已经反映结果，但没有进入 `version/create` 的元数据；base 被拒时 `result.base = null`，服务端**分不清"没找到 base"和"找到了但被拒"**，因此看不到全体用户的拒绝率，也就无法主动发现归一化缺口。

建议字段：`hermesBaseOutcome: 'used' | 'rejected' | 'dump-failed' | 'none'`，可选 `hermesBaseDetail`（截断的首处差异）。

**没有直接加的原因**：`versions.ts` 中 `describePpkBundle` 的注释记录了服务端对可选字段解析严格（2.22.0/2.22.1 曾因 JSON null 炸过发版）。未知字段是否被拒未验证，必须先在服务端确认/放行，再在 CLI 加。接入点：`versions.ts` `describePpkBundle` 与 `bundle.ts` 组装 `hermesBaseMeta` 处。

### 3.2 指令级缓冲区偏移

`NewArrayWithBuffer rX, size, count, offset` 的 `offset` 是序列化缓冲区里的**字节偏移**，而 dump 的缓冲区段按条目打印，看不出每条的字节宽度（`[String N]` 不区分 Byte/Short/Long 编码），所以文本层无法把 offset 映射到条目。当前做法：整段缓冲区内容 + 每条指令的 `size` 比较。

剩余风险："缓冲区内容全对、但某条指令的 offset 指偏了"。概率低（offset 与缓冲区由同一套序列化代码产出），但不是零。补齐方式：用 `hbcTransform.ts` 的布局描述读出二进制缓冲区段，按 SLP 格式（tag 字节：高 3 位类型、长度位；值按类型定宽）解码得到 offset → 条目映射，再在指令层比较解析后的内容。需要跟随 HBC 版本维护（v87–96 为 arrayBuffer/objKeyBuffer/objValueBuffer，v98 起是 literalValueBuffer + objShapeTable）。

### 3.3 差分模糊测试

规则表是"发现一个补一个"堆出来的，历史上已修过三次误杀。现有生成式用例只覆盖一种程序形态。建议加 `scripts/fuzz-hermes-base.ts`：随机生成 JS（大量标识符/字符串字面量、嵌套数组对象字面量、switch、闭包、try/catch、正则、模板字符串、类），随机挑另一份作 base，编译两次跑 `compareHermesBytecode`，收集所有 `different` 的 detail 去重输出。运行需要真实 hermesc（`HERMESC=<path>`）。目标是把归一化缺口在合入前找出来，而不是在用户 CI 里。

### 3.4 函数身份

现在按 `Function<name>(N params, M registers, K symbols)` 头 + 出现顺序对齐。若将来发现 delta 模式会重排函数顺序（目前未观察到），改用 `-output-source-map` 给出的源位置作键：同一份 JS 输入，两侧源位置必然一致。

### 3.5 其它

- **内存峰值**：两个 hermesc + 两个 dump 并发。若 CI 机器吃紧，可把两个 dump 改成串行（多几秒）。
- **`hermesBasePlainCompileFailed` 的语义**：用于校验的普通编译失败时，当前**保留 base 产物且不校验**（`bundle-runner.ts`）。这是"校验基础设施失败但仍发 delta"的唯一路径，与 `dump-failed` 放弃 base 的策略不一致，值得统一为放弃 base。
- **`hbcdump`/`hbc-diff`**：Hermes 仓库自带的工具，RN 的 hermesc 不随附；如果将来 hermes-compiler 包里带上，可替代文本 dump 解析。

## 4. 明确接受的剩余风险

即使全部待办完成，这仍是"没找到差异"而非"证明等价"。覆盖不到：identifier hash 存储错误（hash 由内容确定性生成，概率极低）、调试信息层错误（不影响执行）、两侧被同一个 hermesc bug 同时影响。这些是选择 `--verifyHermesBase`（默认）与 `--hermesBase none` 之间时应知道的边界。

## 5. 排查一次拒绝

1. 看日志里的 detail：函数 + 行号 + 两侧内容，或缓冲区条目，或 dump 失败原因。
2. 两行只差宽度后缀/数字 id/偏移 → 误杀，补归一化规则和用例。
3. 指令数量/顺序/opcode 不同，或缓冲区解析后的内容不同 → 真差异，回退正确，向 Hermes 上游报告。
4. `dump-failed` → 与字节码无关，看 stderr（内存、被 kill、hermesc 版本）。
5. 需要完整现场：`PUSHY_HERMES_BASE_DEBUG=1 pushy bundle …`，两份反汇编在中间目录旁 `hermes-base-dump-{base,plain}.txt`。
