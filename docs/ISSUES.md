# ISSUES

## #4（已修，0.13.1）客户端 `title()` 抛 ReferenceError → 用户的右侧栏整块变空

- **现象**：DSH 升级到 `0.2.2-rc.5` 后，右侧栏展开是空的，找不到「体检」，
  而且**其它插件的标签一起消失**（用户原话：「滑块的右侧栏里面没有条目了」）。
- **根因**：`client.js` 的 `apply()` 里注册 tab 类型时写的是
  `title: function () { return lang.title; }`，而 `lang` 只在组件内由 `useLang(ctx)` 造出来，
  **apply 作用域根本没有这个变量**（该行自 0.5.3 `df338d8` 起就存在）。
  旧宿主不在渲染侧栏时调 `title()`，所以一直没暴露；rc.5 的「引导页 + 标签条」
  会遍历所有注册项调 `title()` 画胶囊 → 一次 `ReferenceError: lang is not defined`
  就让整棵子树渲染失败，右栏空白。
- **为什么「别的插件也没了」**：渲染同一个引导页时一个 provider 抛异常，整片子树都没了。
  所以症状很像宿主回归，实际是单个插件的 title 崩了。
- **诊断路径（可复用）**：① `--boot` 静态探针 → 通过（说明配置能加载，问题在客户端运行时）；
  `plugin-status.json` → 宿主半边 19 工具 + 面板 4 路由都正常；
  ② 从 `app.asar` 里抽出 `@deepseek-ai/dsh-client-ui-sidebar-right` 的 README/契约，
  确认 `title()` 是宿主调用面；③ 用假模块系统 + 假 ctx 在 Node 里真跑 `client.js` 复现，
  一眼看到 `ReferenceError`。
- **修法**：`title` 改用非 Hook 的 `pickLocale(ctx)`，外面再包 try
  （任何 title 异常都不许冒到宿主）。新增 `test/client-apply.mjs` 24 项断言，
  把 `title()` / `guide[].title()` / `guide[].icon(props)` 三个宿主调用面逐个钉住。
- **教训**：客户端半边**不只有组件会被宿主调用**。凡是交给宿主的回调（title、icon、
  canOpen、patterns…）都必须在**没有 React 上下文**的情况下也不抛——一个插件不该有能力
  让用户的整个侧栏变空。

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
- **回归**：`test/apply-inject.mjs` 让 inject 回调触发两次，断言路由不重复（0.13.0 起路由为 4 条：面板 + summary + badge + 目录页；
  未修前实测会翻倍）。
- **教训**：`inject` 回调的幂等旗必须在**同步段**立起来。任何「等 await / 动态 import 之后再判断」
  的守卫都挡不住重入——这和「乐观锁要写在临界区入口」是同一类错误。

## #3（运维坑，2026-11-17）npm 发布成功后 registry 仍 404 约 10 分钟

- **现象**：0.12.1 的 publish 作业在 02:25Z 已打印 `+ dsh-healthkit@0.12.1`，但
  `https://registry.npmjs.org/dsh-healthkit/0.12.1` 连续两次 404，约 10 分钟后才 200；
  packument 的 `dist-tags` 也是之后才更新。
- **误判风险**：此时若重推 tag 会撞 `E409`（版本号已预留）；若改版本号重发会白占一个版本。
- **判据**：以 CI 日志里的 `+ pkg@version` 与 `shasum` 为准；`npm view` / registry 404 只是传播延迟。
- **顺带**：`setup-node` 会注入占位 `NODE_AUTH_TOKEN`（日志里 `XXXXX-...`），
  这不代表用了 token 认证——看 npm 元数据的 `_npmUser.trustedPublisher` 才准。
- **第二次复现（2026-11-18，0.13.0）**：同样的传播延迟，`npm view dsh-healthkit@0.13.0`
  连续 **7 次 E404**、间隔 45s（≈5 分钟）后才返回元数据。这一次没有在 404 期间做任何动作，
  结论成立：**发布成功后 registry 404 是常态，不是失败**。四锁核验一次通过
  （本地 pack sha1 `19dce00a…` == `dist.shasum`、`gitHead` == tag 提交、SLSA provenance 有、
  `_npmUser` = GitHub Actions OIDC）。
