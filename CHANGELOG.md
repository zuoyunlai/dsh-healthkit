# CHANGELOG

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

### 0.8.2 — 2026-11-16

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

## 0.8.1（初版）— 2026-11-16

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
