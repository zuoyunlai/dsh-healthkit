# CHANGELOG

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
