# 第三方独立审计与反哺（2026-11-19）

> 一次以「外部审计者」身份做的只读审计：不采信作者自评（「9.71 分」「38 组全绿」都不算证据），
> 全部结论用实跑输出或源码取证。总评 **6.8 / 10**，结论是：
> **设计思想（基线门、验回、UNKNOWN 语义）是对的，问题集中在「自己的承诺和自己的测试没有被同一套机制校验」。**
> 本文件是台账：问题 → 证据 → 修法 → 守卫。

## 实测基线

| 项 | 实测 |
| --- | --- |
| 规模 | 8,320 行 / 75 次提交 / 39 个测试文件 |
| 最大文件 | `index.js` 1,509 行、`client.js` 1,045、`panel.mjs` 604、`bin/audit.mjs` 600 |
| 空 catch | `src/` 16 处 |
| 本机实跑 | 9.71 分 / 18 条发现 / P0=0 / P2=4 / INFO=14，指纹无碰撞 |
| `--boot`、`--preflight .` | 均通过——**而就在同一时刻，0.13.0 把用户整个右栏清空了** |

最后一行是本次审计的核心：三道自检全盲。

## 分维度评分

| 维度 | 分 |
| --- | --- |
| 正确性 / 缺陷密度 | 5.5 |
| 宿主契约与客户端健壮性 | 5.5 |
| 测试有效性 | 6.5 |
| 文档与代码一致性 | 6.0 |
| 安全与动作面 | 7.0 |
| 架构与可维护 | 7.0 |
| 评分模型区分度 | 6.5 |
| 产品与分发 | 7.5 |

## 问题与修法

### P1-1 承诺与能力声明脱钩

- **证据**：README「它不做什么：不改你的配置」；SECURITY.md「唯一会动文件的操作是 `--clean-apply`」；
  `package.json` 的 `dsh.capabilities` 只有 `tools:register` + `fs:read`。而 0.13.0 的
  `--rollback` / `--recover --yes` / `audit_rollback` 会写回 profile 配置文件，代码里还有 `spawnSync` 与 web 路由注册。
- **为什么没被现有测试拦住**：`docs-drift` 与 `security-doc` 只核对「列出来的东西存在」，不核对「没列出来的写面」。
- **修法**：能力声明补为 `tools:register / fs:read / fs:write / web:serve / process:spawn`；README 给出显式例外；
  SECURITY.md 新增「恢复面的动作面」表（含备份、白名单、sha256 三道护栏）。
- **守卫**：`test/capability-claims.mjs`（19 项）——代码有写操作就必须声明 `fs:write`，
  声明了就必须真有代码用它；`engines.dsh` 与 `dsh.compatibility.dsh` 必须同源。

### P1-2 探针的 YAML 启发式会误报，而 `--recover` 以它为触发条件

- **证据**（读源码）：`recovery.mjs` 统计整个文件 `'` 与 `"` 的奇偶；一条 `# don't` 注释即可判成
  「引号未闭合」→ blocker → `--recover --yes` 回滚用户配置。假红接上自动写回，比假红本身更危险。
- **修法**：改用真解析器（`loadYaml` 从 profile 现解析）；无解析器 → `unknown` + warning，**不触发回滚**；
  解析失败才是 blocker（tab 缩进会真的让 YAML 抛）；重复 id 从解析结构取。
- **守卫**：`test/recovery.mjs` 新增「注释里的撇号不再造成假 blocker」「无解析器判 unknown 且不封启动」
  「重复 id 只是 warning」三条（45 项断言）。

### P1-3 守护 P0 的测试在 CI 上静默通过

- **证据**：`client-apply.mjs` 找不到 `react` 时 `process.exit(0)` 并打印「跳过」，
  查找路径写死 `C:/Users/<作者>/.dsh/...` → CI 必走跳过分支。本仓在 CI 门禁上坚持 `skip ≠ pass`，自己的测试却例外。
- **修法**：缺 react 时用桩（`createElement/useState/useEffect...`），**不许跳过**；
  新增断言「断言数 ≥ 20」防靠跳过凑绿；`DSH_HEALTHKIT_STUB_REACT=1` 可强制走桩路径验证。
- **守卫**：`test/client-apply.mjs`（26 项，real / stub 两条路径都实测通过）。

### P1-4 兼容声明未经验证

- **证据**：声明 `>=0.2.2-0 <0.3.0`，而 0.13.0 在 `0.2.2-rc.5` 上恰恰是坏的；同机 35/37 个插件干脆没有声明。
  宿主文档也写明「安装器和加载器不强制检查 `engines.dsh`」。
- **修法**：补官方字段 `engines.dsh`；新增 `src/verrange.mjs`（最小 SemVer 范围判定，含预发布段比较，
  不支持的语法一律返回 `null` = 判不了）；`--boot` / `--preflight` 支持 `--host <ver>` 对账，
  不覆盖当前宿主时探针判「起不来」、自检判 FAIL。
- **已知边界**：桌面端没把宿主版本暴露给插件，所以不带 `--host` 时如实说「判不了」。

### P2-1 规则矩阵把 R2c 的 P0 记成 P2

- **修法**：条件型严重度按**最坏值**记并标注 `（条件：P0 / P2）`；条件型规则的标题加「（条件型，全文见源码）」
  提醒读者别把矩阵当规则全文。
- **守卫**：`test/matrix.mjs` 钉住 R2c=P0 且标注条件（24 项）。

### P2-3 能力披露有已知误报

- **证据**：本仓自披露含 `credentials`，实际是 `fetch(..., { credentials: 'same-origin' })`（推断；已修）。
- **修法**：抹掉 fetch 的 credentials 选项再判；每条能力附 `capabilityEvidence[{token, certainty, sample}]`，
  区分 `confirmed`（真的调了 API）与 `heuristic`（只命中词形）。
- **守卫**：`test/disclose.mjs` 30 项，含「credentials 选项不算读凭据」「本仓 credentials 必须标 heuristic」。

### P2-4 空 catch 把失败伪装成正常

- **修法**：新增 `src/degrade.mjs`（记 code/次数/人话，`drain()` 取一次即清空）；账本坏行、快照坏文件、
  快照目录读不出都留痕，并以一行出现在首屏与 `--trend` 里：「采集降级 N 处——这些地方**判不了**，不代表没问题」。
  正常路径零噪声（空数组时不显示）。
- **守卫**：`test/degrade.mjs` 16 项（合并/清空/渲染/坏行留痕/正常路径零噪声）。

### P2-4b `index.js` 1,509 行

- **修法**：工具面整体迁出为 `src/toolface.mjs`；`index.js` 只剩宿主外壳（217 行）；
  工具数由 `TOOL_COUNT` 单一真源导出，`init` 文案与 `apply-inject` 断言不再手写清单。
- **已知边界**：仍是「工具面一个文件」，不是「一个工具一个文件」。逐工具拆分需要先抽共享壳
  （`text` / Schema / `dshHome`），属于下一批的结构性改动，本批不做以避免在评审未覆盖时动 19 个 execute。

## 未修但已知

- **评分区分度**（P2-2）：本机 9.71，只有 4 个 P2，历史上相邻记录 79% 同值。首屏已改为「结论 + ≤3 条最值得动」，
  但分数仍是主标题。改成「相对上次的变化」优先需要重排首屏信息层级，另开一批。
- **`R15` 只报不处置**（P3）：服务插件 56 > bundles 43 目前只给数字，没给处置路径。
