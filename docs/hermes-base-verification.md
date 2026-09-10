# Hermes base（`-base-bytecode`）等价校验：现状与待办

`pushy bundle` 在 `--hermesBase auto`（默认）下用上一版 HBC 作 base 编译，让字符串 id 跨版本稳定、热更 patch 变小。`--verifyHermesBase`（默认开）并行再做一次普通编译，把两份产物反汇编后比对；任何不一致或失败都回退到普通编译。

本文记录这套校验**防什么、怎么比、还缺什么**，供后续维护。代码在 `src/utils/hermes-base.ts`（`compareHermesBytecode`）、`src/utils/hermes-literals.ts`（二进制字面量缓冲区解码）与 `src/bundle-runner.ts`（`compileHermesByteCode`）。

## 1. 防什么

热更链路上的每一层校验（base 的 sha256、设备端 patch 重建后的 `bundleHash` 比对、HBC 头解析）验的都是**字节完整性**，没有一层验**程序语义**。一个合法但语义错误的 HBC 会一路绿灯，直到那个函数在用户设备上被执行。

`-base-bytecode` 的 bug 面集中在**引用映射**：字符串表合并错位（`GetById` 取到别的属性名）、字面量缓冲区偏移算错（数组内容变成别的常量）、function id 指错。这些错误的共同特征是**指令序列不变，只是操作数指向变了**——所以校验必须保留语义层（解析后的字符串、寄存器、指令序列），只折叠编码层（id 编号、操作数宽度、跳转距离、缓冲区偏移）。任何"只比指令骨架"或"只查文件格式"的简化都对这类 bug 失明。

## 2. 怎么比（当前实现）

两侧各起一个 `hermesc -b -dump-bytecode -pretty-disassemble`，流式读取（不落盘，`PUSHY_HERMES_BASE_DEBUG=1` 时例外）：

| 区段 | 处理 |
|---|---|
| `Bytecode File Information` 等头部 | 忽略 |
| `Global String Table` | 只用于解析 id，不比较（delta 会保留 base 的死字符串） |
| `Array Buffer` / `Object Key Buffer` / `Object Value Buffer` | 文本段本身**不比较**（见下）；只在无法读二进制缓冲区时作为回退按整段内容比较 |
| `Function<…>` 各函数 | 头文本必须相同；正文逐行经 `normalizeDisassemblyLine` 归一化后比较；**按函数分段**，错位不级联 |
| `Debug *` / `Textified callees table` | 排掉（只服务调试器/性能工具） |

**字面量按指令比较（`src/utils/hermes-literals.ts`）**：`NewArrayWithBuffer rX, sizeHint, count, offset` / `NewObjectWithBuffer rX, sizeHint, count, keyOffset, valueOffset` 的 offset 是序列化字面量缓冲区里的**字节偏移**。校验先从两份 HBC 文件读出头部和三段缓冲区（`hbcTransform.ts` 的布局表，v87–96），在每条指令处按 SLP 格式解码 `count` 个条目（tag 字节：bit 6..4 类型、bit 7 长度续字节、bit 3..0 长度低 4 位；值按类型定宽：double 8 字节、字符串 id 4/2/1 字节、int32 4 字节），字符串 id 经各自字符串表解析成文本后写进归一化后的指令行，两侧逐条比较。

为什么不能按 dump 的整段文本比：Hermes 的缓冲区构建器会**重叠/去重**序列化后的字面量——一个字面量的最后一个值字节可以同时是下一个字面量的 tag 字节（模糊测试实测：`61 52 | cd 09 b3 05 11`，前一段以 `[String 82]` 结尾，后一条指令的 offset 正指向 `52`）。顺序解析整段缓冲区（hermesc 的 dump 就是这么打印的）从这里开始失步，之后的条目全是噪声；delta 构建的 id 宽度不同，重叠位置也不同，于是两段"噪声"在某处不一致就被判为差异。2026-09-10 的 20 轮冒烟模糊测试里 3 次误杀全部源于此，改按指令比较后全部等价。无法读二进制缓冲区（HBC v98：`literalValueBuffer` + `objShapeTable`，尚未实现；或文件结构不识别）时两侧一起回退到整段文本比较，结果里 `literals: 'buffer'` 标明这一点。

`normalizeDisassemblyLine` 折叠的编码层差异：`New*WithBuffer` 的 offset（回退模式下只留 size）、`J*` 跳转目标、`DefineOwnById*` 的原始 string id → 字面量、`Long/LongIndex/Short` 宽度后缀与列对齐空白、`StringSwitchImm`/`UIntSwitchImm` 跳转表偏移、`offset N` 行、`Offset in debug table` 行。

结果三态：`equivalent` / `different`（带第一处差异：函数、行号、两侧内容，或缓冲区条目）/ `dump-failed`（dump 进程退出码非 0、无法启动、提前结束；带 stderr 末行）。后两种都放弃 base，但日志分开。

已知会在 `-pretty-disassemble` 下打印**原始数字 id** 而非字面量的指令目前只有 `DefineOwnById*`；这类指令是误杀的主要来源，出现新的形态就补一条规则 + 一个用例（`tests/hermes-base.test.ts` 的 `PLAIN_DUMP`/`DELTA_DUMP` 对，或 `tests/hermes-switch-normalization.test.ts`）。

## 3. 已完成与待办

### 3.1 服务端上报校验结果 —— 已完成

CLI（`26764b1`）在 `version/create` 附带 `hermesBaseOutcome: 'used' | 'rejected' | 'dump-failed' | 'none'` 与可选 `hermesBaseDetail`（首处差异或失败原因，≤ 500 个码点）。规则同其它链路字段：只发已知值、绝不发 JSON null、未知就省略字段（单独 `pushy publish` 一个 ppk 时没有校验结果，字段不出现）。outcome 从 `HermesCompileResult.outcome` 带出，与 `base` 分开：base 被拒时 `base` 仍为 null，但 outcome 说明是被拒而不是没找到。base 编译本身失败记为 `none` 并附 `base compile failed: …`。

服务端（pushy-go 分支 `hermes-base-outcome`，提交 `9208c24`）新增可空列 `versions.hermesBaseOutcome` / `hermesBaseDetail`，解析器接受缺字段与 JSON null，只拒绝类型错误与未知枚举值；版本列表接口一并透出。全体应用的拒绝率：

```sql
SELECT hermesBaseOutcome, COUNT(*) FROM versions
 WHERE hermesBaseOutcome IS NOT NULL GROUP BY hermesBaseOutcome;
```

旧版服务端忽略未知字段，CLI 先于服务端发布也安全。

### 3.2 指令级缓冲区偏移 —— 已完成（v87–96）

见 §2"字面量按指令比较"。剩余：HBC v98 的 `literalValueBuffer` + `objShapeTable` 布局未解码，该版本走整段文本回退，仍有 §2 所述的重叠误杀风险；补齐时按 `NewObjectWithBuffer` 在 v98 的操作数形态（shape table 索引 + 值缓冲区偏移）解码 shape 表的 key 段。

### 3.3 差分模糊测试 —— 已完成

`scripts/fuzz-hermes-base.ts`（`HERMESC=<path> bun run fuzz:hermes-base --rounds N --seed S [--out DIR] [--verbose]`）：按种子生成随机 JS（大量标识符/字符串字面量、嵌套数组对象字面量、整数与字符串 switch、闭包、try/catch、正则、模板字符串、Babel 形态的类、解构、寄存器压力大的函数），base 取池中另一份或当前程序的变异副本，真实 hermesc 编三次（base、plain、delta），跑 `compareHermesBytecode`；`different` 的 detail 去数字/寄存器/函数名后去重输出，失败轮次的源码与 HBC 留在 `--out`。每 10 轮另植入一处字面量改动并断言校验能抓到（防止归一化折叠过头）。首次运行（2026-09-10，20 轮）找到的三处误杀就是 §2 的缓冲区重叠问题，已由 3.2 修复；修复后种子 2（300 轮）、种子 3（200 轮）、种子 7（40 轮）共 519 轮有效编译：0 次差异、0 次 dump 失败、53 处植入差异全部抓到（生成器早期版本另有 21 轮 hermesc 拒绝编译，属生成器问题，已修）。生成器产出 hermesc 不接受的程序时按"生成器 bug"计数并保留现场，不算校验结果。

### 3.4 函数身份 —— 未做

按 `Function<name>(N params, M registers, K symbols)` 头 + 出现顺序对齐。模糊测试 500 余轮未观察到 delta 模式重排函数顺序；若将来观察到，改用 `-output-source-map` 给出的源位置作键。

### 3.5 其它

- **`hermesBasePlainCompileFailed` 的语义** —— 已统一（`914514f`）：用于校验的普通编译失败时放弃 base、重编 plain 作为产物，上报 `dump-failed` + `plain compile failed: …`；真正的编译器故障会在重编时以构建错误暴露。
- **内存峰值**：两个 hermesc + 两个 dump 并发。若 CI 机器吃紧，可把两个 dump 改成串行（多几秒）。
- **`hbcdump`/`hbc-diff`**：Hermes 仓库自带的工具，RN 的 hermesc 不随附；如果将来 hermes-compiler 包里带上，可替代文本 dump 解析。

## 4. 明确接受的剩余风险

即使全部待办完成，这仍是"没找到差异"而非"证明等价"。覆盖不到：identifier hash 存储错误（hash 由内容确定性生成，概率极低）、调试信息层错误（不影响执行）、两侧被同一个 hermesc bug 同时影响。这些是选择 `--verifyHermesBase`（默认）与 `--hermesBase none` 之间时应知道的边界。

## 5. 排查一次拒绝

1. 看日志里的 detail：函数 + 行号 + 两侧内容，或缓冲区条目，或 dump 失败原因。
2. 两行只差宽度后缀/数字 id/偏移 → 误杀，补归一化规则和用例；先用 `bun run fuzz:hermes-base` 复现一遍，看是否还有同类。
3. 指令数量/顺序/opcode 不同，或某条 `New*WithBuffer` 解析后的字面量不同（detail 形如 `NewArrayWithBuffer r2 size=44 n=44 entry 7: [String "a"] vs [String "b"]`）→ 真差异，回退正确，向 Hermes 上游报告。detail 带 `<undecodable@N>` 说明偏移超出缓冲区或 tag 非法，同样是真问题。
   若日志/元数据里 `literals` 为 `buffer`（HBC v98 或文件结构不识别），缓冲区是按整段文本比的，`Array Buffer entry N` 形式的差异可能是 §2 的重叠误杀，需人工用二进制解码核对。
4. `dump-failed` → 与字节码无关，看 stderr（内存、被 kill、hermesc 版本）。
5. 需要完整现场：`PUSHY_HERMES_BASE_DEBUG=1 pushy bundle …`，两份反汇编在中间目录旁 `hermes-base-dump-{base,plain}.txt`。
