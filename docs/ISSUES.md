# ISSUES

## #1（已修，0.4.1）audit_report 缺省 out 落到 profile 目录，而非会话工作区

- **现象**：不传 `out` 调 `audit_report`，报告出现在
  `C:\Users\<user>\.dsh\profiles\desktop\AUDIT-2026-11-16.md`，
  而工具描述写的是「缺省写当前工作区」。
- **根因**：实现是 `path.join(process.cwd(), 'AUDIT-' + d + '.md')`。宿主是 Electron 应用，
  `process.cwd()` 是 **profile 目录**（`~/.dsh/profiles/desktop`），不是会话工作区。
  工具描述说的是产品语义，代码用的是进程语义，两者从未对齐。
- **影响**：报告落在用户不会去找的地方；工具描述失真；`config.reportDir` 也被忽略（代码根本没读它）。
- **修法**：见 `src/reportpath.mjs` 与 CHANGELOG 0.4.1。落点顺序 out → reportDir → 会话工作区 → `$DSH_HOME/dsh-auditkit/reports/`；
  `process.cwd()` 彻底退出解析链。
- **证据（同一天两种启动器）**：CLI 启动器 `dsh --profile probe1 --no-open` 里 `processCwd` = 启动 shell 的目录；
  Electron 桌面端里同一字段是 `~/.dsh/profiles/desktop`。**cwd 随启动器变**，所以它不可能是「用户的工作目录」的可靠来源。
- **教训**：宿主插件里 `process.cwd()` 不是「用户的工作目录」。要目录就问 `workingDirectory` 服务
  （`wd.get(exec.agent.session)`）；要不到就用自己拥有的目录兜底，别用进程 cwd。
- **遗留**：误落的那份 `profiles/desktop/AUDIT-2026-11-16.md` 已删除（git 未跟踪）。
