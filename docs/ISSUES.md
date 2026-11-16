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

## #2（已修，0.11.1）宿主重复触发 inject 回调 → 面板挂两遍，自己的那份一条没挂上

- **现象**：真宿主 `$DSH_HOME/dsh-healthkit/plugin-status.json` 里
  `panel.attempts` 三条路由全报 `duplicate exact route`、`routes: 0`，但
  `GET /dsh-healthkit-panel/api/summary` 返回 200 且数据正常——因为对外服务的是**另一份**挂载。
- **根因**：幂等判断写的是 `state.panel.ok`，而它要等 `import('./src/panel.mjs')` 完成后才置真。
  宿主在服务重发布时会把 inject 回调再唤一次，两次回调都在 import **之前**通过判断，
  于是各挂一遍；第二次全撞 duplicate。`registerAll` 有同样结构，只是 tools 的回调恰好只来一次。
- **影响**：面板看起来正常，实际上插件自己这份没挂上；status 里的 duplicate 会让人误判成
  「插件重复安装」，去查一个不存在的问题。工具面不受影响。
- **修法**：面板改用一个**同步**的 `panelMounting` 旗（回调第一行即置上，失败时放开以便重试）；
  `registerAll` 以「本轮已注册过」为幂等条件。见 CHANGELOG 0.11.1。
- **回归**：`test/apply-inject.mjs` 让 inject 回调触发两次，断言路由仍只有 3 条
  （未修前实测 6 条）。
- **教训**：`inject` 回调的幂等旗必须在**同步段**立起来。任何「等 await / 动态 import 之后再判断」
  的守卫都挡不住重入——这和「乐观锁要写在临界区入口」是同一类错误。

