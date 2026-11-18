# CHANGELOG

## 0.13.0 — 2026-11-18

竞品检索反哺批：**恢复面（探针 / 快照 / 回滚）· 能力披露 · 作者侧自检 · 规则矩阵**，以及定位从「只读体检」改成「升级后先看还活不活」。依据 `docs/COMPETITIVE-RETRIEVAL-2026-11-17.md`（一次带数据的竞品检索：我们自己的 npm 下载量
是**首发当天的一次性扇出**，不是用户；同域头部 `dsh-plugin-health` 5,623/周卖的是「升级后插件坏了」）。
19 个工具，测试 37 组。

- **A1 改定位**：README / package.json description / locale meta 从「只读体检」改成
  「升完级、改完配置，先问一句插件还在跑吗」——把已经存在的能力（`R23` 静默跳过、`R1`/`R2`/`R14b`、
  跨重启验回）提到首句，而不是新造功能。
- **A2 恢复面（新）**：`src/recovery.mjs` + 5 个 CLI 开关（`--boot` / `--checkpoint` / `--checkpoints` /
  `--rollback` / `--recover`）+ 3 个工具（`audit_boot` / `audit_checkpoint` / `audit_rollback`）。
  预启动静态探针判 bundle 缺失、`dsh.bundle` 未声明、patch 解析失败、补丁 id 重复；
  回滚写回前**自动给当前状态再打一份快照**，只写白名单文件，sha256 不符就跳过。
  第一版把宿主自带的 `@deepseek-ai/*` 全报成「依赖没装」（桌面 43 条假红），当场修掉。
- **A3 分发**：核实 5 条收录 PR 全部 `mergeable=true`（主榜 #16020 双绿 + CLEAN）、
  仓库 description 与 topics 跟新定位对齐（补 `health-check` / `diagnostics`）。
- **A4 能力披露（新）**：`src/disclose.mjs`，用插件目录那套 **10 token 闭集**
  （`fs-read`/`fs-write`/`env`/`network`/`shell`/`credentials`/`llm`/`dynamic-code`/`host-runtime`/`subagent`）
  产出 `capabilities` / `capabilityRedLines`，可直接被目录消费。同源相对 `fetch('/api/…')`
  不算联网，注释里的示例不算能力——否则本仓自己的自披露会打自己的脸。
- **B5 安全边界**：新增 `SECURITY.md`（读什么/写什么/清理护栏/面板回环/明确做不到的事），
  `test/security-doc.mjs` 把文案与代码动作面做机器对账。
- **B6 主动敲门**：新增便宜入口 `/api/badge`（只读账本最后一行，**不跑体检**）+ 侧栏标签 P0 chip。
  装完不打开面板也能看见「上次体检有几条 P0」。
- **B7 诚实标注**：README 继续用真实输出片段，不拿 npm 下载数当卖点。
- **C1 作者侧（新）**：`--preflight <插件仓>`，拦住发出去就改不了的事（无 `dsh.bundle`、`main` 指向
  不存在的文件、没写 `files`、清单含 `.npmrc`、补丁没有 `id`），风格问题只降级为警告。
- **C2 规则矩阵（生成物）**：`--matrix --out docs/MATRIX.md` 从 `src/rules.mjs` 抽 36 条规则 ×
  体检/探针/清理/门禁；`test/matrix.mjs` 重生成比对，表不可能比代码旧。**不做**「全目录 × 宿主版本」
  的兼容矩阵（要求逐个装插件启动宿主，做不到就不编）。

## 0.12.1 — 2026-11-17

本版四个批次：**代码审查反哺**（安全 P1×1 / 正确性 P1×1 / 性能 P1×1 / P2×4 / P3×3）· **文档漂移修复** · **面板语言修复 + 插件列表 locale 元数据** · **竞品分析反哺**（基线门 / 契约 skip≠pass / 物理量 / 验回仪式）。
16 个工具，测试 31 组。

### 代码审查反哺批


> 依据 `docs/FIXLOG-REVIEW-2026-11-17.md`（逐文件代码审查，总分 6.7/10）。

#### 修（安全）：`restore()` 路径穿越与清单未校验

`batch='../..'` 可读到回收区外的 manifest；清单里的 `from` 可指向任意路径 ⇒ 恢复即任意文件移动。
现在：批次名只允许单段、解析后必须是 trashDir 直接子目录；`items` 必须为数组；每条 `to` 必须在本批次目录内、
`from` 必须在 DSH_HOME 内且不命中护栏（与 `apply()` 侧同等强度）。新增 `test/clean-restore.mjs` 14 项断言。

#### 修（正确性）：只读工具会写 `verify/last.json`

`audit_digest` 通过 `checkPending` 无条件落盘，既与「只读」自述矛盾，又会覆盖开机验回记录。
拆成 `evaluatePending()`（纯算）/ `checkPending()`（落盘，`persist:false` 可关），周报改用前者。

#### 修（性能）：事实缓存指纹含整个 `logs/` 目录

宿主每写一个新日志文件目录 mtime 就变 ⇒ 缓存几乎次次失效（等于没有缓存）。改为只 stamp
`collect()` 实际读取的 `logs/unlag-reload.log`。

#### 修：另外五处

- `spawnSync` 去掉 `shell:true`，加 `windowsHide`；
- 面板 HTML 响应补 `nosniff` 与 CSP，`esc()` 补单引号转义；
- **退役的 P0/P1 不再一律 PASS**（降为 WARN，可见但不阻塞）——防「误记档把严重问题绿掉」；
- 周报的 `productMetrics` 只算一次（原先两次各读一遍账本）；
- `client.js` 的 `fetch` 加 `AbortController`；`history.load()` 按 size+mtime 记忆化；
  `loopbackOnly` 改显式白名单并注释空地址放行理由。

#### 明确没做

`index.js` 拆模块（纯结构重构，风险>收益）与格式化函数收口（会造成跨端耦合）。
「面板并发各算一次」不成立：Node 单线程 + 同步计算。

#### 测试

新增 `test/clean-restore.mjs`（14 断言），digest 增只读断言（19）、cache 增指纹口径断言（9）；**31 组全绿**。

### 文档漂移修复批


#### 修：README 与 COMPLEMENTARY 落后于代码

- README「现状」段还写着 **14 工具 / 18 组测试**，实际已是 **16 工具 / 30 组**；
  连带 `apply()` 注入路径那行也从「14 工具」改成 16。
- `docs/COMPLEMENTARY.md` 的「契约同形…同一套 CI 可以同时消费两者」只说了同形的一半：
  竞品分析后我们补了 doctor 的顶层信封字段（`schema`/`generatedAt`/`profile`/`exitCode`），
  但**行为是「和而不同」**——doctor 绝对门，我们默认基线门（存量不阻塞、新增 WARN < 3 不下判），
  `UNKNOWN` 报 WARN 而不是 PASS，能力域行不参与门禁。原文已按这四点重写。
- 守卫：新增 `test/docs-drift.mjs`（10 项断言）——README 工具表行数/标题中文数字/测试组数
  必须等于实际值，禁止残留 `14 工具`、`18 组测试` 这类旧数字，COMPLEMENTARY 必须写清
  `基线门` / `--absolute` / `UNKNOWN` 三处差异。



#### 加：插件列表的本地化元数据（locale/*.json）

- 新增 `locale/en.json` 与 `locale/zh.json` 的 `meta.title` / `meta.description`——
  宿主文档口径：Plugin Manager 与设置页会在**不激活插件**的前提下读这两段，
  缺了就只能回落到 `package.json` 的 name/description，英文宿主下会看到中文标题。
- `package.json` 补 `exports["./locale/*.json"]` 与 `files` 里的 `locale/*.json`
  （不导出读不到，不进 files 发布后就丢）。`npm pack --dry-run` 实测两份都在包里。
- 英文标题按文档要求用 sentence case（`DSH health check`，`DSH` 作为专有名词例外）。
- 守卫：新增 `test/locale-meta.mjs`（14 项断言：双基准字典、字段非空、无营销词、
  sentence case、exports/files 声明面、别为加 locale 丢了图标）。

#### 修：侧栏面板永远显示中文（切英文宿主也不变）

- **根因**：`pickLocale()` 调 `loc.current()`，而运行时 `locale` 服务**没有这个方法**
  （契约只有 `getLocale / getSnapshot / subscribe / setLocale / addLanguage / register / bind`）。
  `typeof loc.current === 'function'` 恒为假 ⇒ 恒回退中文；而且 `lang` 在 `apply()` 时就定死，切语言不重渲染。
- **修法**：改读 `getLocale().active`（无则 `getSnapshot()`）；新增 `useLang(ctx)` 用
  `locale.subscribe` 订阅变更，`Body` / `TabTitle` 每次渲染取实时语言；第三语言（ja/es/fr/de/ru/pt）
  按 DSH 的回退链落到英文，不再错落成中文。
- **实测**（一次性探针，把面板标题渲染成文本）：`zh-CN → 体检`、`en → Checkup`、`ja → Checkup`、
  `de → Checkup`、缺失 → `体检`；每次渲染都订阅 1 次。
- **守卫**：`test/panel-contract.mjs` 加 4 条静态断言（不许调 `current()`、必须用
  `getLocale/getSnapshot`、必须订阅、`Body/TabTitle` 不许在 apply 里定死 lang）；断言只看代码、不看注释。

> 未动的边界：服务端渲染的网页面板与 CLI 文案仍是中文——它们不在浏览器 locale 体系里，
> 要做得多语言是另一件事（见上一条「工具描述/报告正文不随语言切换」的说明）。

### 竞品分析反哺批


> 依据 `docs/FIXLOG-COMPETITIVE-2026-11-17.md`。核心事实：竞品分析指出
> 「`audit_check` 在一台自己判为 9.81 分的健康机器上仍然 exit=1」——一道永远红的门
> 只有两种命运：被人 `|| true` 掉，或被人把发现一条条静音掉。

#### 修：CI 门从「绝对状态」改成「新问题门」（P1，借 SonarQube）

- `audit_check` / `--check` 默认成为**基线门**：只判相对上一次快照的新增与回归，存量不阻塞；
  新增 FAIL 永远 exit 2；新增 WARN 少于 3 条时不下判（fudge）；无基线时退回绝对门并写明原因。
- 能力域行（`CAP-*`）标 `gating: false` 移出门禁——域冗余是「装得丰富」的结构事实，不是回归。
- 新增 `--absolute`（老行为）与每条 check 的 `fresh` 标记；实测健康机器 `exit 1 → 0`。

#### 修：契约两处语义失真（P4，借 RFC #1846）

- **UNKNOWN 不再落 PASS**：INFO+UNKNOWN → WARN（skip≠pass）。绝对门下 PASS 22→16、WARN 10→16。
- 信封补 doctor 的顶层字段：`schema` / `generatedAt` / `profile` / `exitCode` / `summary{...}`，
  保留 `contract` 与 `doctor.exit`（老读者不变）。
- `remediation` 为 opt-in 有序修法数组（`--check --remediation`），不请求时字段完全不出现。

#### 改：建议带上物理量（P2，借 Lighthouse）

- `plan.rows[].saves`：R17→`省 N MB`、R15→`少 N 个服务插件`、R16→`每轮省 token（待测 · 涉及 N 套）`，
  其余为 `null`。**拿不到物理量就写待测，不许编数字。**

#### 改：验回仪式（P5，借 Snyk Fix Rate）

- `audit_digest` 在采纳率为 0/算不出来时直接给出仪式提示（真修一条 → 重启 → 看采纳率）；
  README 新增四步「验回仪式」。

#### 不做：注入采样（P3）

- 宿主 `tokenMeter` 的 `measure/contextPressure` 都要 `Session` 实例，工具上下文拿不到句柄；
  静态估算会把「估」当「测」，故不做。补偿：R16 的 fixHint 改成给出具体去处
  （宿主 `tokenMeter.contextPressure` 或第三方 `dsh-context-budget`）。

#### 测试

- 新增 `test/gate.mjs`（26 项断言）；`test/score.mjs` 增 4 条 saves 断言；`test/digest.mjs` 增 CLI 接线断言。

## 0.12.0 — 2026-11-17

本版三批：**面板/趋势修复** · **架构审计反哺**（P0×2 / P1×7 / P2×5）· **产品审计反哺**（P0–P4）。
工具面 15 → **16**（新增 `audit_digest`、`audit_feedback`），测试 28 组。

### 产品审计反哺批

> 产品审计的核心判断：它至今只证明了「作者能用它管住自己 23 小时发 28 版的混乱」；
> 要变成「别人的体检工具」，缺的不是功能/分发/质量，而是首屏、来源、验回三件事。

#### P0 首屏结论化（健康机器不再「跑完啥也没说」）

- 首屏从「14 行 INFO + 3 条 P2」改成：**1 句结论 → 最值得动的 ≤3 条 → 其余一句话收走**。
- 新 `src/digest.mjs` 是这条口径的单一真源（`headlineOf` / `pickTopActions` / `renderFirstScreen`），
  `audit_run` 的 summary、CLI 默认输出、面板 headline 全读它。
- **不删任何 INFO**：它们是 `audit_diff` 的观测基线，只是换了表达。全量清单走 `--verbose` / `audit_findings`。

#### P1 账本记触发来源

- `history` 记录新增 `source`（human / agent / automation / ci，可用 `DSH_HEALTHKIT_SOURCE` 覆盖）；
  `stats()` 汇总 `sources` / `humanRuns`；面板 payload 带出。
- 工具调用记 `agent`，CLI 记 `human`；新增 `--source <s>` 与 **`--no-record`**（试跑不污染账本）。
  动机：实测 50 条记账全在一天、78% 与前次同值，而「谁在跑」从来没记——一次审计的 4 次只读探测
  就能把账本凭空造出第二天。

#### P2 差异驱动周报 + 让验回有活干

- 新工具 **`audit_digest`**（+ CLI `--digest`）：与上次快照比变化，**必带「上次说该修的现在怎样」**，
  没有变化只说一句「没有变化」而不复述。
- `writePending` 判据从「只收带修法的 P0/P1」改为「P0/P1 全收 + 最多 3 条带修法的 P2」——
  原来健康机器（P0/P1 归零）待验清单恒空，**`audit_verify` 在健康机器上永远没有对象可验**。

#### P3 R17 与 clean 讲同一件事

- R17 补 `fixHint`：先跑 `audit_clean preview`，并说明不在可清理分组里的是有意不清理的受保护面。
- 面板 payload 新增 `clean.notCleanable`（≥50MB 且未被任何分组覆盖的顶层目录，带 `protected` 标记），
  侧栏「可清理」卡副行变成「3 组 · 另 5 个大目录不在清理档」。
- 覆盖判定按路径前缀（`cache/attachments` 可清理 ≠ `~/.dsh/attachments` 可清理）。

#### P4 README 首屏

- 首屏 = 一句定位 + 一段真实输出 + 「它不做什么」+ 与 doctor / 插件管理器的分工；工具表下沉。
- `docs/COMPLEMENTARY.md` 进 npm `files`（此前这份「和 doctor 有什么不同」的答案不在包里）。
- 工具表与 `--init` 文案同步到 15 个工具（`tools-shape` 有断言盯文案与实现一致）。

#### 补齐：周报定时投递 + 首次价值信号

- 现有「每周 DSH 体检」自动化改成**差异驱动**（调 `audit_digest`，无变化只回一句），
  权限从 workspace-write 降到 **read-only**，并写死禁令（不许 clean/改配置/装卸插件/写文件）。
- 新工具 **`audit_feedback`**（+ CLI `--feedback <fp>=known|unknown`）：回答「这条我原先知不知道」，
  **只记本机** `feedback.jsonl`、永不外发；同一 fp 只保留最后一次回答；
  `firstValueRate = 不知道 / 已回答`，低于 30% 时 `audit_digest` 直接点出来。
  这是「值不值得装」的唯一真指标，此前没有任何机制在收。

#### 补齐：产品指标上屏

- 新 `src/metrics.mjs`：第二次运行（只数 human/automation，跨度 ≥7 天才给结论）、
  结论采纳率（`fixed/(fixed+stillThere)`，**静音不算采纳**）、误报率（`retired/(findings+retired)`）。
- 面板 payload 加 `product`，侧栏多一个折叠块「产品指标（本地，不外发）」；`audit_digest` 只在算得出来时带一行。
- 口径是「算不出来就说算不出来」：本机当前 第二次运行/采纳率 都是「算不出来」（老账本无 source、无验回记录），
  误报率 15%（3/20）。这两个数会随真实使用自己变真。

#### 测试

- 新增 `test/digest.mjs`（16 项断言）、`test/feedback.mjs`（13 项断言）、`test/metrics.mjs`（16 项断言）；`test/verify.mjs` 按新判据更新（P2 进清单、最多 3 条、
  只有 P2 时也有目标）；`tools-shape` / `apply-inject` / `init` 文案同步到 16 个工具。

### 架构审计反哺批

> 依据 `docs/FIXLOG-2026-11-17.md`（逐条修前/修后实测台账）。
> 架构评分 6.4/10「需治理」；本轮不改评分口径、不改版本号、未发版。

#### 修：两条会动数据/骗人的静默路径（P0）

- **A1 清理护栏对「终段同名目录」失效**：正则写成 `\$`（转义的字面美元号，不是结尾锚点），
  实测 `C:/_backup/node_modules` 直接通过——恰恰是它唯一要保护的情形；且护栏零测试。
  改用真锚点并把名单抽成 `PROTECTED_NAMES`；`purge()` 增二次校验（清单含受保护路径整批拒绝）。
  新增 `test/clean-guard.mjs`（8 名 × 3 位置 + 形近名 + purge，33 断言）。
- **A2 坏 profile 静默消失**：`collect` 里 `if (!pkg) continue;` 让 package.json 解析失败的 profile
  整条从体检里消失、零发现、报告照旧高分。改为记 `facts.profileErrors[]` + 新规则 **R24**
  （reliability/P0/MEASURED），P0 封顶随之生效。新增 `test/profile-errors.mjs`（13 断言）。

#### 改：性能与启动噪声（P1）

- **事实缓存**（新 `src/cache.mjs`）：三次连续 audit **1016/854/933ms → 1051/18/19ms**。
  只缓存 facts，评分/退役/快照仍现算；指纹含 profile 目录与 package.json、cordis*.yml 的 mtime，
  改配置自动失效；`opts.fresh` 与 `DSH_HEALTHKIT_NO_CACHE=1` 两条旁路。面板缓存 60s→55s（落在引擎缓存热区）。
- **启动惰性验回**：`pending-verify.json` 无 targets 时不再跑全量体检（本机实测 targets 为空却每次开机扫盘）。

#### 改：评分与分层契约（P1）

- **rubric 自检**（`validateRubric`）：caps.when 白名单、维度 key 唯一、bands 严格降序、
  dimensionCaps 单调、penalty 三档齐。修前实测「caps 少两个空格 ⇒ 同一组 findings 从 5.0 变 9.6」；
  现在自检结果进 `self.notes` 并渲染进报告的「备注」。未知维度/严重度进 `score().dropped`，不再静默。
- **规则层不再读文件系统**：`installedExclusions` 改由采集层给出，`machines` 回退删除；
  `rules.mjs` 现在零 `fs.`/`readJson`（`test/layering.mjs` 守门）。
- **面板 payload 契约**：加 `schema: dsh-healthkit/panel/v1` + 必需键 assert + `bands` 下发；
  client 不再硬编码 8.5/7/5 阈值（`test/panel-contract.mjs`）。

#### 修：趋势图在「极差很小」时整个消失（2026-11-17 用户反馈）

上一版按「极差 < 1 分就先不画折线」处理：本机分数 9.6–9.81 恰好命中，面板只剩一句
「近 20 次稳定在…」，读者只会当成功能坏了。更糟的是**服务端版本一直画**，两端口径分叉
（正是架构审计里 client/panel 双实现漂移的老问题）。

- client 改为**折线永远画**；极差小时另加一行「稳定在 a–b」作补充说明，不再拿说明替掉图；
- `test/panel-contract.mjs` 加两条守卫：不许按 `spread >= N ?` 省略折线、必须始终渲染 polyline；
- 用一次性探针在真实数据（极差 0.21）下复核：渲染树里 1 条 polyline + 4 段分档带。

#### 改：测试与门禁（P1/P2）

- 删掉两条**恒真断言**（`r.findings.length >= 0`、`f.measured.engineAsset === true` 该字段不存在），
  换成 advisory 不许进评分、R17 verdict 与 `facts.engineAssets` 对账。
- 新增 `test/score.mjs`（罚分/折扣/维度封顶/P0封顶/丢弃项/rubric自检/归因，23 断言）——
  评分数学第一次有直测。
- 新增 `.github/workflows/ci.yml`：push main / PR 跑 `npm test`（node 20+22）。
  原来只有 `publish.yml`，测试要等 tag 推上去才跑。
- `tools-shape` 覆盖 10 → **14** 个工具；`verify` 改用 `runsDir()`；`history.trim()` 每 20 次记账才检查。
- 死配置接上：`allowlist.engineAssetMarkers` 进 collect 判据；删死导出 `snapshotsDir` 与 `report-json` 4 个未用 import；
  `layering` 新增「allowlist 每键必须被引用」守门。

## 0.11.1 — 2026-11-16

### 修：宿主重复触发 inject 回调时，面板会挂两遍

- **现象**：真宿主 `plugin-status.json` 里 `panel.attempts` 三条路由全报
  `duplicate exact route`、`routes: 0`。面板看着能用——因为对外服务的是**另一份**挂载；
  插件自己这一份一条也没挂上。
- **根因**：`startPanel` 的幂等判断写在 `state.panel.ok` 上，而这个值要等动态
  `import('./src/panel.mjs')` 完成之后才置真。宿主在服务重发布时会把 inject 回调再唤一次，
  两次回调都在 import 完成**之前**通过判断，于是各挂一遍，第二次全撞 duplicate。
  工具注册同理——只是真宿主里 tools 的回调恰好只来一次，没暴露。
- **修法**：面板另立一个**同步**的 `panelMounting` 旗，回调进来第一行就置上（失败时放开以便重试）；
  `registerAll` 改以「本轮已经注册过工具」为幂等条件。
- **回归**：`test/apply-inject.mjs` 新增一段——让 inject 回调触发两次，路由必须仍只有 3 条。

## 0.11.0 — 2026-11-16

### 审计报告第四批（生态位）：三件事全部落地

**② 机器可读 JSON 报告**

- `audit_report format=json` / `dsh-healthkit --format json` → 全量 JSON 报告，
  schema `dsh-healthkit/report/v1`：总分与 7 个维度分、封顶原因、全量 findings
  （含 evidence/measured/fixHint/retired）、修复顺序、能力域矩阵、self 段。
- 修一个落点 bug：out 以 `.json` 结尾时会被再追加一次变成 `x.json.json`；
  抽出 `jsonReportPath()` 统一处理。

**① 与 dsh-plugin-doctor 互补**

- 生态正在收敛三值契约（doctor SPEC §1.1 提到的 RFC #1846：PASS/WARN/FAIL + 退出码 0/1/2）。
  本插件按**同一形态**提供：CLI `--check` 与工具 `audit_check`，信封字段与 doctor 对齐
  （`{ ok, contract, checks[], doctor:{...}, target:{...} }`）。
- 映射：P0/P1=FAIL、P2=WARN、INFO 与**已退役**与 ADVISORY=PASS；
  能力域 conflicting/redundant/degraded=WARN。P1 定为 FAIL 而非 WARN——P1 是「已证实在扣分」，
  降成 WARN 会让 CI 门形同虚设。
- 分工写进 `docs/COMPLEMENTARY.md`：doctor 查**单插件仓合规**，本插件查**整机装配健康**；
  两者不互相调用（doctor 是 CLI、无服务接口），互补靠**契约同形**而非代码耦合。

**③ capability-map 20 域 → 可订阅推荐源**

- 新增 `src/recommend.mjs` → `dsh-healthkit/recommend/v1`：20 个域各自的补救阶梯、
  宿主内置实现、**搜索关键词**（不给包名）。
- 三条红线被测试钉住：① 装插件是最后手段（阶梯恒为四级：配置→provider→插件→习惯）；
  ② 不联网、不给具体包名（包会改名/下架，且 npm 有相似名保护）；③ missing ≠ 该装。
- 推荐源里不含任何本机绝对路径（可分享）。
- CLI `--recommend`、工具 `audit_recommend`。

工具面 12 → 14。

## 0.10.1 — 2026-11-16

### 修：audit_verify 返回开机时的旧记录，导致「被静音」看不出来

真机验证跨重启自证时发现：把一条问题退役后，`audit_verify` 仍显示它「还在」。

根因：`audit_verify` 优先返回 `verify/last.json`（宿主开机时写的那份），只有没有它时才当场重算。
于是「刚退役了一条」这种**发生在开机之后**的变化被旧记录盖住——
被静音的那条会被误报成「还在」，而这正是这套机制要区分开的两态。

修法：**每次都当场重算**；开机那份只作为 `bootAt` 时间戳附在结果里供参考。

回归测试进 tools-shape：记档 → 验回应显示 muted=1 且该条不在 stillThere 里。

## 0.10.0 — 2026-11-16

### 审计报告第三批：① 跨重启自证（只读版 A）、③ 面板时间线；② 场景判据实测后判「不做」

**① 跨重启自证（只读版 A）**——补 PLAN §11 唯一没做的高价值项，但守住只读定位：

- 每次体检写「待验清单」（`pending-verify.json`）：只收**带修法的 P0/P1**，
  因为没有修法的目标没法验。
- **宿主每次启动，插件开机自动核对**（在 `apply()` 里做，失败不影响插件加载）：
  修好了没（fixed）/ 还在（stillThere）/ **被退役记档（muted，不算修好）**/
  **回归（本次新冒出的 P0/P1）**。
- 四个状态分开列——分数上升可能来自「被静音」而非「真修好」，混在一起会骗人。
- 只报告、**绝不改配置**：这是 A 方案与 B 方案（自动回滚）的分界。B 要给体检器写权限，
  而 patch 是整段替换语义，写错一个字段就是配置面塌掉。
- 新工具 `audit_verify` + CLI `--verify`；面板与网页各加一段。

**③ 面板时间线**——把 `audit_diff` 的三分并进面板（侧边栏 + 网页）：

- 「上次修的，现在怎样了」：验回四态；
- 「最近几次的变化」：逐次快照的新增 / 真修好 / 被静音 + 分数变化。

**② 场景判据实测 → 判「不做」**（见 `docs/SCENARIO-MEASUREMENT.md`）：

- 规划 §5 的三组判据是**推想的、未实测**。本轮在**本机 1349 个真实目录**上实测：
  原判据只命中 **4 个（0%）**，1345 个一个都不命中；特征之间无重叠，
  不是「重叠误判」而是「几乎不触发」。
- 本机 76% 的目录既无 package.json 也无 src/，24% 是「一堆 md」——
  正是论衡与审计报告的实际形态。规划里的判据描述的是理想化目录结构。
- 结论：**不做路径启发**。若将来需要场景感知，正确做法是显式声明
  （工作区放 `.dsh-healthkit.json` 或 agent preset 里写），不是猜路径。
- PLAN-DEVIATIONS 第 3 条从「未实测」更新为「已实测且不成立」，附命中率与复现脚本。

工具面 11 → 12。测试 15 组，Windows + WSL 双平台全绿。

---

### 面板 UI 反哺批（并入本版）

> 依据：`docs/REVIEW-PANEL-2026-11-16.md`（UI 设计师 + 数据可视化工程师两份评审逐条核实后的台账）。

#### 修：面板会显示 NaN（重复挂载的直接症状）

- 实测：`GET /dsh-healthkit-panel` 返回 `<div class="v">NaN</div>`，`/api/summary` 返回
  `score:null / band:"-"`；而同一份文件在进程外 `collectSummary()` 得 `9.81 / 良好`。
  所以不是算错，是**重复挂载**：`plugin-status.json` 里三条路由全 `duplicate exact route`、
  `panel.ok:false`，对外服务的是另一代实例。
- 渲染层加数值兜底（`num()`）：非有限数一律 `—`，不再把 `NaN` 印给用户。
- `registerPanel` 遇 duplicate 如实记 `duplicate` 并视面板为「已在服务」，不再谎报三条全失败。
- 彻底修复要单实例重启宿主——插件杀不掉自己的另一半。

#### 改：信息层级（原来 17px 的总分和「47.6 MB」同级）

- 英雄卡：总分 31px + 分档药丸 + 严重度 chip + 分隔线（`未解决 / 已退役 / N 次记账`）。
- 零值徽章去色：`P0 0 / P1 0` 不再满饱和红橙，色相改到「竖条 + 浅底」上，文字用 `C.fg`；
  徽章行补分母（`3 计分 / 17 总`）。
- 超限指标转红：`56 / 43` 加限位条并写「超 13 个」。
- INFO 收进折叠组（14/17 条不计分），主视线只留计分项。
- 封顶差额：`raw − score > 0.05` 时在分数字旁标「封顶前 x」，raw 一直就在 payload 里。
- 首屏重排：英雄卡 → 2×2 指标（补「可涨」）→ 趋势卡 → 维度分 → 问题 → 修复顺序。

#### 改：可视化（0–10 固定轴在 9.81 时只有 2.9px 信息）

- 裸折线换**分档带**：0–5 / 5–7 / 7–8.5 / 8.5–10 四段底带 + 分隔刻线 + 当前位置竖标，
  折线降级成带内细线；极差 < 1 分时不出折线，改一句话结论（亚像素抖动会伪装成「有起伏」）。
- 时间戳本地化：`history.jsonl` 的 `at` 是 UTC，原来 slice(11,16) 让面板早 8 小时；
  client 与网页面板都改成按本地时区渲染。
- 维度横条：`score.dims` 由 `collectSummary` 透传（7 行），默认折叠，只在有维度 < 9 或被
  dimensionCaps 压住时展开。**不让前端用 items 重算**——disk 的 7 条全是 INFO、计分 0，
  按 items 计数会把最健康的维度画成最差。
- 删掉 `█` 字符 sparkline（8 档 ⇒ 1.43 分/档，且当前长度只有 1）。
- 修复收益改横条（相对归一，`maxDelta < 0.05` 退化成一行文字）。

#### 改：排版与一致性

- 字号收 6 级（10/11/12/13/16/31，删掉 10.5/11.5/12.5 半像素）、圆角 3 级（5/8/10）、
  间距落 8 栅格、容器 `padding: 12px 14px`。
- 章节标题改「上分隔线 + 右侧计数」（窄栏里线比字重省预算）。
- 后端枚举中文化（`DIM_ZH` / `STATUS_ZH`），能力域计数改彩底药丸。
- 刷新改真 `<button>`：26px 高、`loading` 时禁用并显示「读取中…」；
  注入一次性 `<style id="hk-panel-style">`（幂等）补 `:focus-visible`、`details` 展开箭头。
- 错误态保留旧数据（顶部错误条 + 重试），不再把有内容的面板整屏换成错误页。
- `mb()` 补 KB 档（`800KB` 不再显示 `0.0 MB`）；「首次」按 `runs` 分「首次 / 首日基线」；
  数值节点 `tabular-nums`、总分 `toFixed(2)`；截断改 `line-clamp`（原来按字符切还断词）。

## 0.9.0 — 2026-11-16

### 审计反哺修订批（docs/REVIEW-2026-11-16.md 的 V01–V10 全部落地）

第三方审计核实了 11 条（10 成立 / 1 撤回），本批修完 10 条成立项。

**V01 · R2c 分流**：`YAML_UNAVAILABLE`（体检器自己取不到解析器）从 P0/MEASURED 降为
P2/UNKNOWN——「体检器没能力判断」不该触发用户的总分封顶；真语法错仍是 P0。

**V03 · 指纹唯一**：R13 的 measured 带 `profile`、R17 带 `dir`、R22 兜底 `broken[0].dep`。
实测：30 条发现 30 个指纹（原 25 个）；退役一条 R17 现在只静音它自己（原连带 5 条）。
新增夹具断言 `fingerprints-unique`。

**V04 · UNKNOWN 计罚**：从固定 0.5 改为按名义严重度打折（`unknownDiscount: 0.5`）。
P1 UNKNOWN 现扣 0.9（旧 0.5）——「查不出」不再比「证实了」罚得轻。rubric 升 **v1.2**。

**V05 · 降级不崩**：`runRules` 入口对 profile 关键字段与 disk/logs/engineAssets 默认化。
降级测试从 4 场景扩到 9（含 3 个原来直接 TypeError 的字段级缺失），全部通过。

**V07 · R23 移到采集层**：`noManifestBundles` 由 collect 产出，规则层不再读文件系统——
原实现导致这条 **P0 规则的判别逻辑零测试**。夹具补 R18/R23/R14b/R3d 触发面，must-fire 扩到 12 条。

**V02 · peer 走廊**：补 `@deepseek-ai/dsh >=0.2.2-0 <0.3.0`（对齐 dsh-chronicle），
sidebar peer 放宽 `>=0.1.5-0 <0.3.0-0`（覆盖 latest 与 next 两条发布线），compat 同步。
前提（宿主宽松比较）已记入 NOTES-host-contract §五。

**V06 · allowRepair 删除**：实测代码零引用的空壳声明，与「只出命令不落盘」立场矛盾，
已从 cordis.patch.yml 移除并记档 PLAN-DEVIATIONS。

**V08 · 撤销退役**：`audit_retire action=restore` + CLI `--unretire`。CLI 实测回环：
retire → 静音 0 条 → unretire → 恢复 1 条。工具面回环测试进 tools-shape。

**V09 · 只读语义精确化**：`audit_run` 描述点明「写自己的账本与快照」，新增 `record=false`。

**V10 · 报告跨次三分**：报告新增「三之三之二、跨次对比」段——新增 / 真修好 / 新退役，
分数变化从此能区分「真修好了」与「被静音了」。真机实测生效。

**升级注意**：指纹语义变化（R13/R17/R23 带后缀）会使升级后第一次跨次对比把旧裸指纹的
R13/R17 报成「真修好」、新后缀指纹报成「新增」——一次性对齐，之后恢复精确。

## 0.8.6 — 2026-11-16

### 修：audit_capabilities 的「有实现」计数恒为 0

0.8.5 把能力域从四态改成六态（`present/missing/redundant/degraded/conflicting/unknown`），
但工具输出里的字段还叫 `ok`，而 `byStatus.ok` 在六态里**根本不存在** ⇒ 永远取到 0。
真机复核时 `audit_capabilities` 报「有实现 0」，一眼看出不对。

- 字段改为六态口径：`present` / `redundant` / `conflicting` / `degraded` / `missing` / `unknown`，
  保留 `ok` 作为兼容别名（避免已有调用方断掉）。
- `CAPS_SCHEMA` 的 required 同步改成 `present`。
- 测试补断言：**六态计数之和必须等于 20**——这类「字段名与数据不同步」的问题，
  一条断言就能挡住。
- 顺手排查了其余 10 个工具的输出字段与实际数据是否对得上，都一致。

## 0.8.5 — 2026-11-16

### 修：快照顺序（CI 第四次红）

v0.8.4 的 CI 红在 `snapshot`：同毫秒写两份快照时，「新增」是空的。

- **根因是两层叠加**：
  ① 同毫秒写入的文件名冲突后加 `'-1'` 后缀，而字典序里 `'-' (0x2D) < '.' (0x2E)`
  ⇒ `'x-1.json'` 排在 `'x.json'` **前面**，于是「上一次」变成了「下一次」；
  ② `loadRun(home, stamp)` 只按 `stamp + '.json'` 找文件，同 stamp 有多份时
  **永远只能读到第一份**，第二次写入的内容根本读不出来。
- 修法：快照记录里加单调递增的 `seq` 字段，排序按 `at → seq → 文件名`；
  新增 `loadRunByFile(home, file)` 按文件名加载；`loadRun(home, stamp)` 改为取该 stamp 下
  **最后写入**的那份；`latestRun` 走文件名。
- 新增回归断言：**同一毫秒写两次**，顺序不能反。

## 0.8.4 — 2026-11-16

### 修：reportpath 夹具全面平台化（CI 第三次红）

v0.8.3 的 CI 又红在 `reportpath`：这次是 `reportDir` 那条——
夹具里 `home='C:/Users/u/.dsh'`、`ws='E:/work'` 在 POSIX 上都不是绝对路径，
`path.resolve(ws, cfg)` 于是把它们当相对路径拼到 cwd 后面。

- 夹具里 **home / ws / out 全部改用平台自己的方式构造绝对路径**
  （`path.resolve(path.sep + ...)`），并补断言「落点必须是绝对路径」。
- **找到可靠的验证手段**：本机 WSL 里有 node v26，可以直接跑真 POSIX。
  新增 `run-tests-posix.sh`：在 WSL 里用空 HOME 跑全部测试 = 模拟 CI。
  —— 之前两次发版失败，根因都是「Windows 上绿、Linux 上红」，而本机没有 POSIX 环境可验。
  现在有：改完先在 WSL 跑一遍，再打 tag。
- 三次 CI 失败的共同教训已写进本文档：夹具里不许写死盘符路径。

## 0.8.3 — 2026-11-16

### 修：测试改为平台无关 + 环境无关（CI 第二次发版仍红，根因在此）

v0.8.2 的 CI 又红，这次是 `reportpath` 那条「out 绝对路径照用」：
夹具里写死 `'D:/reports/x.md'`，而 POSIX 上 `path.isAbsolute('D:/...')` 为 **false**——
路径语义不同，不是代码有错。

- **绝对路径断言**改用平台自己的方式构造（`path.resolve(path.sep + 'reports' + ...)`），
  任何平台上都是真绝对路径。
- **依赖真机环境的测试改为自建临时 HOME**（新增 `test/testenv.mjs`）：
  `invariants` / `panel` / `tools-shape` 三个测试在 CI（ubuntu runner，没有 `~/.dsh`）上必然红，
  现在各自造一个最小假 DSH 安装（一个 profile + 一个未挂载的第三方包）。
  **必须用动态 import**：ESM 静态 import 会在模块求值时先执行，那时 `DSH_HOME` 还没设上。
- `panel` 测试补记两笔账：折线需要至少两个数据点，临时 HOME 里账本是空的。
- 新增 `run-tests-empty-home.sh`（本地）：在**空 HOME** 下跑全部测试 = 模拟 CI，
  不必等 CI 才发现平台/环境差异。

## 0.8.2 — 2026-11-16

### 修：R22 判定改成平台无关（CI 首次发版即红，根因在此）

第一次用 OIDC workflow 发版（tag `v0.8.1`），CI 直接红：`must-not-fire R22` 失败。
根因不是规则写错，而是**夹具里写死了本机绝对路径**（`file:E:/Documents/.../dsh-pet`）：
在 Linux runner 上那些路径必然不存在 → R22 必然命中 → 那是环境差异，不是真问题。

- 存在性判定从规则层移到**采集层**（`collect` 产出 `profiles[].localDeps[{dep,spec,target,exists}]`），
  规则只读事实。涉及真实文件系统的事（平台相关）在采集阶段做完，规则层就与平台无关了。
- 夹具改为**相对路径 + 显式 `exists` 字段**，任何机器上结论一致。
- 相对目标按 profile 目录解析（pnpm 语义），绝对路径原样用。
- 新增 `test/r22-local-deps.mjs`：`exists=true` 不报、`exists=false` 必须报 P0 ——
  「平台无关」不能变成「坏目标也不报」的借口。
- 旧格式（无 `localDeps`）算不出存在性时**不报**：宁可漏报也不误报。

## 0.8.1 — 2026-11-16

### 修：R22 判定改成平台无关（CI 首次发版即红，根因在此）

第一次用 OIDC workflow 发版，CI 直接红：`must-not-fire R22` 失败。根因不是规则写错，
而是**夹具里写死了本机绝对路径**（`file:E:/Documents/.../dsh-pet`）：
在 Linux runner 上那些路径必然不存在 → R22 必然命中 → 那是环境差异，不是真问题。

- 存在性判定从规则层移到**采集层**（`collect` 产出 `profiles[].localDeps[{dep,spec,target,exists}]`），
  规则只读事实。涉及真实文件系统的事（平台相关）在采集阶段做完，规则层就与平台无关了。
- 夹具改为**相对路径 + 显式 `exists` 字段**，任何机器上结论一致。
- 相对目标按 profile 目录解析（pnpm 语义），绝对路径原样用。
- 新增 `test/r22-local-deps.mjs`：`exists=true` 不报、`exists=false` 必须报 P0 ——
  「平台无关」不能变成「坏目标也不报」的借口。
- 旧格式（无 `localDeps`）算不出存在性时**不报**：宁可漏报也不误报。

## 0.8.1 之初版 — 2026-11-16（历史段，已被下一版修订覆盖）

补上 PLAN §7 的运行快照与 §11 P2 的「两次跑分差异与归因」，并给 §13 的通用性硬要求补上测试。

- **运行快照**：每次体检写一份全量指纹到 `$DSH_HOME/dsh-healthkit/runs/`（保留 60 次）。
  为什么账本不够：`history.jsonl` 只存前 6 条 P0/P1 指纹，P1 一超过 6 条，
  「这次比上次多出了哪条」就只能猜。
- **`audit_diff` 工具 + `--diff`**：新增 / **真修好** / **新退役** 三分。
  关键性质：**被退役记档的不算修好**——「消失」有两种原因（修好了 / 静音了），必须分开报。
  没有基线时明说「这是第一次」而不是报「新增 20 条」。
- 快照文件名带毫秒：同一秒内跑两次（先 audit_run 再 audit_diff）是常态，
  只到秒会让后写的覆盖先写的，差异就永远比不出来。
- **§16.5 通用性测试**（`test/portability.mjs`）：临时 DSH_HOME + 怪 profile 名 +
  陌生 bundle 名 + 改名后仍跑通；断言所有采到的证据路径都落在临时目录内。
  §13 的四条硬要求（不写死 profile 名 / 不写死路径 / 插件名不硬编码 / 无 GUI 也能跑）
  此前只有代码检视，现在有了可回归的测试。
- **`docs/PLAN-DEVIATIONS.md`**：记录与原规划的差异——已补齐哪些、哪些明确不做及其实测依据
  （修复引擎 L1/L2 与跨重启自证、市场推荐、路径启发、npx init 骨架）。
- 工具面 10 → 11。

## 0.8.0 — 2026-11-16

补齐 PLAN-2026-11-16.md 里没落实的四块。

- **P4 六态判定**（原只做四态）：现在按 §4.2 给出 present / missing / redundant / **degraded** / **conflicting** / unknown。
  本机实测判据：
  · `conflicting`：抓取能力被两个实现同时接管（`fetchProviderTakeover: true` 与宿主 `web.fetchProvider` 并存）；
  · `degraded`：模型路由声明 8 个 provider 但只有 1 个有压缩策略；默认档位是 `danger-full-access`；成本记账停更 20 天；
  · `redundant`：视觉理解 2 套、记忆 4 套、主题/面板 3 套同时挂着。
  当前分布：有 8 / 多 4 / 冲突 1 / 失效 2 / 无 1 / 无法判定 4。
- **补救阶梯升到四级**（原三级）：配置 → provider → 插件 → 习惯。
  保留 PLAN 的硬规则：任何指向「装插件」的建议必须写明「为什么只用配置补不上」，
  写不出就不许出——`assertPluginAdvice()` 会在渲染时逐条检查，违规行会被标出来。
- **§13.7 自审分离**：报告新增「本插件自身状态」一节（版本 / 工具面 / 数据目录 / 账本次数 / 退役条数），
  **不参与评分**——体检器自己出问题不影响被检对象的分数。
- **P2 `audit_retire` 工具面**：误报记档上工具了，原因必填（没理由不给默认）。
  与 CLI `--retire` 共用同一份逻辑（engine 的 load/saveRetirements）。不带参数时列出可记档候选。
  工具面 9 → 10。
- **§16 假阳性专区**：`fixtures/retired/` 每个退役项一个 fixture + `test/false-positive-zone.mjs`。
  断言的是「退役机制正确」而不是「规则改对了」——规则可以继续命中，退役负责让它闭嘴。
- **§16 降级测试**：`test/degradation.mjs` 覆盖 4 个场景（记账文件缺失 / YAML 不可用 / 装载日志缺失 /
  机器注册表缺失），要求**出 UNKNOWN 而不是崩溃，也不许假绿**；反向断言证据齐全时 UNKNOWN 占比不过高。
- 面板与侧边栏的能力域段改为展示六态与「有缺口的域」（不再只列多实现/无实现）。

## 0.7.0 — 2026-11-16

补齐 P3 与 P5。

- **P3a 趋势折线**：面板改为内联 SVG 折线（零依赖），y 轴**固定 0–10**而不是按 min/max 自适应——
  否则 8.3→8.4 会被画成陡坡，纯粹自己吓自己。参考线 5/8/10 分。数据取「按次」而非按天折叠：
  同一天里改完配置再跑一次，变化当天就能看见，不必等到明天。
- **P3b 每周体检**：创建自动化「每周 DSH 体检」（周 09:00 Asia/Shanghai，独立会话，权限 workspace-write）。
  任务说明自包含：跑 audit_run / audit_findings / audit_trend / audit_report，回复里只给
  ① 分数与变化 ② 新出现的问题 ③ 最该先修的 3 条；明确禁止改配置、装插件、执行清理。
- **P5 能力域矩阵**：新增 `audit_capabilities` 工具与 `--capabilities`。
  20 个能力域 × 四态（有 / 多 / 无 / 无法判定），每个缺口给**三级补救阶梯**：
  ① 先看配置层 ② 再看宿主内置（@deepseek-ai/*） ③ 最后才考虑装插件（只给搜索关键词，不给包名）。
  `missing` 只表示当前没有实现，**不代表你该装**——渲染文案里明写了这一句。
  provider 域刻意标 `unknown`：供应商配置写在 profile config 里，静态审计读不到，不猜。
- 面板（侧边栏 + 网页）都加了能力域摘要与折线；能力域的完整阶梯走工具，面板只放「多实现」与「无实现」两行。
- 新增 `test/capability-map.mjs`（四态判定 + 阶梯顺序 + 文案断言）；tools-shape 覆盖到 9 个工具。

## 0.6.0 — 2026-11-16

面板从「只有分数」补成「看完就知道该干什么」。

- **每个问题带四件事**：是什么（规则+标题）、落在哪（维度 / 位置 target）、为什么（证据路径 + 测到的值）、怎么修（fixHint；没有固定修法时明说）。侧边栏与网页面板都改了，折叠用原生 `<details>`，禁脚本环境照样能展开。
- **修复顺序**：先解 P0 封顶，再按单条增量从大到小排（+0.36 / +0.27 …），末尾给「全部修完 → X/10」。
- **优化建议**：装载面瘦身（服务插件水位、能力冗余组的主备候选、记忆插件叠放）+ 可清理空间的分组明细。
- **一句话结论**：按 P0/分数/条数生成 `headline`，放在最上面。
- 数据面 `collectSummary()` 一次给全：`items`（全量问题，含 evidence/measured/fixHint/confidence/advisory）、`plan`（stage1 + rows + potentialAll）、`clean.groups`、`trim.suggestions`、`retiredList`。旧字段 `top` 保留为兼容。
- 侧边栏面板仍是原生 `sidebarRightTabs` 标签，不占端口；网页面板仍是服务端渲染 + meta 自刷新。

## 0.5.3 — 2026-11-16

**面板从「独立网页」升级为「原生侧边栏面板」**，并修掉一个只有真机才暴露的坑。

- **侧边栏 iframe 不给脚本执行权**：Host 半边的 `/dsh-healthkit-panel` 是独立网页，
  放进侧边栏的 iframe 浏览器时脚本不执行 → 页面空白（系统浏览器打开正常，响应头里也没有
  `X-Frame-Options`/CSP，所以不是被 header 拦）。两处处置：
  1. Host 面板改为**服务端渲染**：数据直接写进 HTML，页面零 `<script>`，
     自动刷新用 `<meta http-equiv="refresh">`；
  2. 新增 **Client 半边 `client.js`**：走 `sidebarRightTabs.register` + `slots` 直接长在右侧栏里，
     不占端口、不用记地址、不经过 iframe。形态照 dsh-chronicle（`window.__ModuleLoader__` +
     手写 `createElement`，无 JSX、无构建步骤）。
- 面板数据仍只走 Host 的只读 JSON API（`/dsh-healthkit-panel/api/summary`），Client 侧不做计算。
- `package.json`：新增 `exports["./client"]`、`dsh.client`（platform: web + inject 三项）、
  `peerDependencies`（sidebar-right / react，均 optional）。`files` 收录 `client.js`。

## 0.5.2 — 2026-11-16

**面板挂不上（真宿主实测）**：`plugin-status.json` 里 `panel.ok = false`，
原因是 `cannot get property "register" without inject`。

- 根因：`ctx.inject(['webServer'], cb)` 的回调参数是 **ctx 本身**，不是服务对象。
  0.5.1 写成 `registerPanel(injected)`，于是去取 `injected.register`——触发 Proxy 的 inject 护栏报错。
  正确写法是 `injected.get('webServer')`（对齐 dsh-chronicle 的用法）。
- 修法：抽出纯函数 `resolveWebServer(injected)`，只接受带 `get()` 的 ctx；
  服务取不到就降级成 `webServer-unavailable`。挂载改走 `ctx.effect(() => ctx.inject(...))`，
  并加幂等（服务重发布会重复回调，重复注册会撞 Duplicate path）。
- 测试补硬约束：`resolveWebServer(ws)` 必须返回 null（把服务当 ctx 传是 0.5.1 的原样 bug），
  `registerPanel({})` / `registerPanel(null)` 只降级不抛。

## 0.5.1 — 2026-11-16

面板前端修两处，都是 0.5.0 自带的问题：

- **页面空白**：最初用字符串拼 HTML 再手写转义，`\"` 在生成时被吃成 `"`，整段脚本语法错误、
  页面只剩骨架（所有数字都是「—」）。改成 DOM API 组装（`createElement` + `textContent`），
  不再拼标签，也就没有转义可错。附带的收益是 `esc()` 及其注入面一起消失。
- **趋势显示 `(null)`**：只有一天账本时 `delta` 为 null，`null >= 0` 走错分支。现在显示「（首次）」。
- 卡片网格 `align-items: start`，高度不再被最高的那张拉齐。

## 0.5.0 — 2026-11-16

从「只报分」补到「能解释、能排期、能瘦身、能看」。

- **四个新工具**：`audit_findings`（问题清单，按严重度排序带指纹）、`audit_explain`（一条问题的维度/证据/测得值/置信度/修法）、
  `audit_plan`（先解 P0 封顶、再按单条增量排，给全修完的终点）、`audit_trim`（装载面瘦身：同能力多实现、超 bundles 上限、记忆插件叠放）。
  工具面 4 → 8。
- **只读面板** `/dsh-healthkit-panel`：总分、分档、P0/P1/P2、趋势 sparkline、可清理空间、装载面水位、前 8 条问题。
  GET 不记账不写状态（预取/刷新/重放都安全），只认回环（非本机 403），离线可用（无外部 CDN）。
  用 `ctx.inject(['webServer'])` 挂载；挂不上就降级成「没有面板」，结果写进 `plugin-status.json` 的 `panel`。
- **CLI 补齐**：`--help`（不跑体检、不记账）、`--init`（接入自检：环境/profile/装没装/还差哪一步）、
  `--trim`、`--findings`、`--explain <fp>`、`--plan`。解释型动作直接复用工具实现，避免两套文案漂移。
- **能力标签收紧**：R20 原先 `search` 用 `/(search|fetch|crawl|scrap)/i` 太宽，把插件市场、SSH 远程、项目记忆
  都算成搜索实现，给出「关掉 dsh-free-search、留 dshmarket」这种反向建议。现在按名字/描述的核心度判，宁可少报不可乱指。
- **新增 `docs/PRESET-LAYER.md`**：权限预设的四层（宿主/profile/会话/自动化），以及
  「为什么把 defaultPreset 改成 workspace-write，当前会话还是 danger-full-access」。
- 新增 `test/tools-shape.mjs`（8 个工具的形状与行为）与 `test/panel.mjs`（路由/回环守卫/离线/缓存）。

## 0.4.6 — 2026-11-16

0.4.5 改数据目录时漏掉的收尾（同一批「改名没改全」的尾巴）：

- **工具描述仍在指旧目录**：`audit_report` 的 description 还写着 `$DSH_HOME/dsh-auditkit/reports/`。
  这段是模型和用户都会读的文案，比源码注释更要紧。
- **守卫没拦住它**：`test/migrate-guard.mjs` 原先只拦带引号的 `'dsh-auditkit'`，句中裸写漏网。
  现在按子串拦，任何位置的旧目录名都会失败。
- **页脚通告了不存在的工具**：报告末尾写「误报请用 `audit_retire` 记档」，但工具面没有这个工具。
  退役能力一直在 CLI（`--retire` / `--list-retired`），文案改为指向真通道。
- **CLI 加 `--help` / `-h`**：此前 `--help` 不被识别，会直接跑一次体检**并写一条账本**；
  现在先打印用法再好退出，不记账、不写报告。
- README「现状」段补上新的测试清单。

## 0.4.5 — 2026-11-16

**数据目录统一为 `$DSH_HOME/dsh-healthkit/`**，并让它只剩一处真源。

- 数据目录名原本手写在 6 个模块里（index / clean / engine / history / probe / reportpath），
  与 bin 键、VERSION 常量是同一类"多处硬编码、改一处漏一处"的问题。现在集中到 `src/paths.mjs`，
  其余模块只调 `dataDir()`。
- **自动迁移**：插件启动时若新目录不存在、旧目录 `dsh-auditkit` 存在，就整目录 `rename` 过来
  （同盘原子操作，账本/退役库/回收区一起搬）；新目录已存在则不动；rename 失败则**回落继续用旧目录**
  并在 `plugin-status.json` 的 `dataDirMigration` 里报错，绝不半搬。
- `plugin-status.json` 新增 `dataDir` 与 `dataDirMigration`（migrated / already / fresh / failed）。
- 新增 `test/migrate-guard.mjs`：用临时目录钉死三种前置状态 + rename 后内容不丢，
  并断言 `index.js` 与 `src/*.mjs`（除 paths.mjs）里不再出现旧目录名字面量。

## 0.4.4 — 2026-11-16

- 修 `plugin-status.json` 报错版本：`index.js` 里 `VERSION` 是手写字面量（停在 `0.4.1`），包已发到 0.4.3 也没跟着走。改成运行时读 `package.json`，版本号只剩一处真源。
- 新增 `test/version-guard.mjs` 防漂移：断言 `index.js` 不出现字面量版本，且 `VERSION` 来自 `package.json`。

## 0.4.3 — 2026-11-16

- 名字统一到底：GitHub 仓库改名 `dsh-healthkit`（旧地址自动重定向），本地目录 `plugins/dsh-healthkit`，`cordis.patch.yml` 的 `id` 与 `name`、`index.js` 导出的 `name`、报告页脚、README 链接全部换成 `dsh-healthkit`。
- `package.json` 的 repository/homepage/bugs 指向新仓库。
- **例外**：`$DSH_HOME/dsh-auditkit/` 数据目录**不改**——里面有账本（history.jsonl）、退役记录（retirements.json）、清理回收区（trash/），改名等于把这批状态丢掉（退役的 R21a 会重新冒出来）。想在数据目录上也统一，需要一次显式迁移，不做静默搬家。

## 0.4.2 — 2026-11-16

- 命令名跟上包名：`bin` 从 `dsh-auditkit` 改为 `dsh-healthkit`（0.4.1 只改了包名，忘了改 bin 键，装完敲的仍是旧命令名）。

## 0.4.1 — 2026-11-16

**包名定为 `dsh-healthkit`**（显示名仍是「DSH 体检」）。改名原因：npm 拒绝 `dsh-auditkit` ——
与已存在的 `dsh-audit-kit`（另一位作者的 DSH 插件审计器）判为过于相似，403 不放行。
改的是包名与 bundle 名；`$DSH_HOME/dsh-auditkit/` 数据目录**不动**（账本、退役库、回收区不迁移）。

修 issue #1：`audit_report` 的缺省 out 落到了 profile 目录而不是会话工作区。

- **根因**：0.4.0 用 `path.join(process.cwd(), 'AUDIT-<日期>.md')`，而宿主是 Electron 应用，
  进程 cwd 是 profile 目录（`~/.dsh/profiles/desktop`），于是报告写到了
  `C:\Users\<user>\.dsh\profiles\desktop\AUDIT-2026-11-16.md`——与工具描述「缺省写当前工作区」不符。
- **修法**：新增 `src/reportpath.mjs`，把落点变成一条可测规则，`process.cwd()` 不再参与解析：
  1. `out`（显式）：绝对路径照用；相对路径以**会话工作区**为基准
  2. `config.reportDir`：同上
  3. 会话工作区：`<workspace>/AUDIT-<日期>.md`（经 `workingDirectory` 服务取本 agent 的会话目录）
  4. 兜底：`$DSH_HOME/dsh-auditkit/reports/`（插件自己的数据目录），永不落 profile
- **行为变化**：取不到工作区又给相对 `out` 时**显式报错**，不再猜一个路径写进去。
- 工具描述与 `out` 参数说明同步订正；返回值新增 `via`（`workspace|out|config.reportDir|fallback`），
  `plugin-status.json` 新增 `processCwd` 供事后核对。
- 顺带修测试封闭性：R9 改为优先吃 `facts.machines`（采集快照/夹具），只有快照没有时才回落读活注册表。
- 新增 `test/reportpath.mjs`（8 条断言），`npm test` 已串上。
- `bin` 路径去掉前导 `./`：npm 判其非法并从发布物移除，装完会没有 `dsh-healthkit` 命令。

## 0.4.0 — 2026-11-16

- 首个可用版本：`audit_run` / `audit_report` / `audit_clean` / `audit_trend` 四个工具；
  bundle 挂载 + `ctx.inject(['tools'])` 注册；分数归因（两步）+ 清理回收区 + 分数趋势。
