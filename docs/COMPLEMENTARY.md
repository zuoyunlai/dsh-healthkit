# 与 dsh-plugin-doctor 的互补（2026-11-16）

> 对应审计报告第四批第 1 项。结论：**两者查的不是同一件事，可以并存互补；
> 生态三值契约已经收敛，本插件按同一契约提供 `check` 形态。**

## 分工

| | dsh-plugin-doctor | dsh-healthkit（本插件） |
|---|---|---|
| 查什么 | **单个插件仓**是否合规 | **整机装配**是否健康 |
| 输入 | 一个插件仓目录 | `~/.dsh` 整个安装 |
| 手段 | 静态扫描 + 沙箱冒烟 + 宿主契约求值 | 配置面 / 装载面 / 权限面 / 成本 / 磁盘 / 上下文 |
| 判据 | SPEC v1（R0–R8 / K1–K14 / D0–D3 / CC1–CC5） | R1–R23 + 评分 rubric + 能力域矩阵 |
| 典型问题 | 「这个包的 peer 走廊过窄」「patch 行定位不到」 | 「装了 5 套记忆插件每轮都注入」「抓取能力被两个实现同时接管」 |
| 回答 | 这个插件**合不合规** | 这台机器**健不健康** |

**为什么不是重复**：doctor 的最小检查单位是「一个包」，看不到包与包之间的关系；
本插件的最小检查单位是「一次装配」，看不到单个包内部的契约细节。
典型互补场景：

- doctor 说「你的某个插件缺 `dsh.bundle.patch`」→ 本插件的 **R23** 会在整机视角报
  「宿主会静默跳过 N 个」——同一个根因，一个给开发者、一个给使用者。
- 本插件的 **R20/R16**（能力冗余）→ doctor 完全看不到，因为那需要跨插件比较。

## 三值契约（生态收敛中）

`dsh-plugin-doctor` 的 `--format check` 输出三值契约
（见其 SPEC §1.1 提到的 RFC #1846）：`PASS` / `WARN` / `FAIL` + 退出码 `0` / `1` / `2`，
并且保留 `skip != pass` 的语义差异（在 `doctor` 字段里用 `skipped` / `degraded` 表达）。

本插件按**同一形态**提供：

- CLI：`dsh-healthkit --check` → 三值契约信封，退出码 0/1/2；
- 工具：`audit_check` → 同样的信封（`ok` / `contract` / `exit` / 三态计数 / 问题清单）；
- 信封字段与 doctor 对齐：`{ ok, contract, checks[], doctor:{...}, target:{...} }`。

映射规则：

| 体检发现 | 契约状态 |
|---|---|
| P0 / P1 | **FAIL** |
| P2 | **WARN** |
| INFO | PASS |
| 已退役（误报记档） | PASS（已被显式豁免，不该继续阻塞 CI） |
| ADVISORY（建议项） | PASS（不计分，本就不该阻塞） |
| 能力域 conflicting / redundant / degraded | WARN |
| 能力域 missing / unknown | PASS（缺能力 ≠ 不健康） |

**为什么 P1 是 FAIL 而不是 WARN**：P1 意味着「已证实的问题正在扣分」。
WARN 留给 P2（该看但不一定急）。把 P1 降成 WARN 会让 CI 门形同虚设。

## 机器可读全量报告

三值契约给的是「能不能过门」；要读全部细节（证据、实测值、修复顺序）用：

- CLI：`dsh-healthkit --format json --out <路径>` → 写 `<路径>.json`
- 工具：`audit_report format=json` → 写同名 `.json`
- schema：`dsh-healthkit/report/v1`

字段：`score`（总分/原始分/分档/封顶原因/7 个维度分）、`findings[]`（全量，含 evidence/measured/fixHint/retired）、
`plan`（修复顺序 + 全修完的终点）、`capabilities`（20 域矩阵）、`self`（体检器自身状态，不参与评分）。

## 边界

本插件**不调用** doctor，也不复制它的判据：
- doctor 是 CLI 工具，没有可供别的插件调用的服务接口，调用它等于起子进程跑一次全量扫描（慢、脆）；
- 它的判据（SPEC v1）有自己的版本与治理流程，复制过来会立刻漂移。

互补靠**契约同形**而不是靠代码耦合：两边各发自己的三值信封，谁也不依赖谁。

**同形在哪、不同在哪**（2026-11-17 竞品分析修订后重写，原来的说法只有前半句）：

- 同形：条目层 `{name, status, detail}` 三值 `PASS/WARN/FAIL`；信封层我们补了 doctor 的顶层字段名
  （`schema` / `generatedAt` / `profile` / `exitCode`），并保留自己的 `contract` 与 `doctor.exit`，
  所以**一个只为 doctor 写的消费者现在也能读到退出码**。
- 不同：**doctor 是绝对门**（有任何问题就非零退出），**我们默认是基线门**——只判「相对上一次快照的
  新增与回归」，存量不阻塞；新增 WARN 少于 3 条时不下判（fudge），新增 FAIL 永不放过。
  想让行为一致，用 `--absolute` 回退到绝对门。
- 还有一条语义差别：**判不了不当通过**。`UNKNOWN` 置信度的问题在我们这里报 `WARN` 而不是 `PASS`
  （RFC #1846 的 `skip ≠ pass`）；绝对门下这会让本机 PASS 从 22 条降到 16 条，这是有意的。
- 能力域（`CAP-*`）条目**不参与门禁**（`gating: false`）：域冗余是「装得丰富」的结构事实，不是回归。
