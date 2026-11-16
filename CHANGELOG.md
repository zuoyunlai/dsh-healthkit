# CHANGELOG

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
