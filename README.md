# dsh-auditkit

DSH 整机体检器：只读审计 → 评分 → 能力缺口 → 可回滚修复。
引擎（`src/`）与宿主无关，可单跑；插件壳（`index.js`）暴露成 DSH 工具。

## 给谁用

- 想知道"我这套 DSH 配置到底什么水平"——跑一次给出 0–10 分与分维度明细。
- 想知道"缺什么能力、要不要装插件"——能力缺口优先，装插件是最后手段。
- 想修——L1/L2 自动修（带备份、可回滚），L3 只出命令与预检，不代跑。

## 安装

开发期（源码改动立即生效，推荐）：

```bash
dsh plugin --profile <profile> add link:E:/path/to/dsh-auditkit
```

发布期：`file:` 或 npm 包。**注意 `file:` 是硬链接拷贝**，改源码不会生效，必须
`dsh plugin --profile <profile> install --force` 重新装；`link:` 是符号链接，改完重启宿主即可。

## 工具

| 工具 | 作用 |
| --- | --- |
| `audit_run` | 只读体检，返回总分、分档、P0/P1/P2 计数与 P0/P1 清单 |
| `audit_report` | 跑体检并把完整 Markdown 报告写到工作区 `AUDIT-<日期>.md` |
| `audit_clean` | 清理可再生垃圾：**默认只预览**；执行也是先移入回收区，7 天内可一键还原 |
| `audit_trend` | 分数历史：次数、最新分与变化、均值、最好/最差、P0 未关，附 sparkline |

CLI：`node bin/audit.mjs --json | --scenario ... | --out <path> | --probe-all | --links | --retire <fp> | --list-retired | --dump-facts | --trend [days]`
　　　`--clean-preview | --clean-apply <ids> [--confirm] [--dry-run] | --clean-restore <batch> | --clean-list | --clean-purge [days]`

## 分数账本（P3）

`audit_run` / `audit_report` / CLI 主路径每跑一次，往 `$DSH_HOME/dsh-auditkit/history.jsonl` 追加一行
（append-only，最多留 2000 条）。读取时**按本地日期折叠成每日一次**，一天跑十次也不会把趋势画歪。

```
近 30 天 9 次体检 · 最新 6.1/10（+1.1） · 2026-11-15
▄▄▄▄▄▄▅▅▅
均值 4.96（近 7 次） · 历史 4.79 · 最好 6.1 · 最差 4.2 · P0 未关 0
```

为什么要单独一层：`engine.audit()` 保持纯函数（只读、可重复），**记账放在调用层**。
这样「只读体检」的承诺不被污染，账本坏掉也不影响体检结论。

## 清理器（P1，0.2.0）

「清出几个 G」这个钩子在 DSH 里是空的：总量 2.2G 里 `node_modules` 701M、`dsh-runtimes` 506M、
`dsh-ops` 108M 都是必需品，`attachments`+`sessions` 在 30/60/90 天 TTL 下回收 **0MB**。
实测默认可动只有 **37.3 MB**（缓存 + ≥14 天过期备份 + 审计器过期索引），
再加「需确认」档（远程工作区镜像）共 **84.9 MB**。

所以这套清理器的重点不是数字，是**敢让人按下去**：

- **永不直删** —— 一律 `$DSH_HOME/dsh-auditkit/trash/<批次>/`，带 `manifest.json`，7 天内 `restore` 原样搬回
- **今天生成的备份绝不动** —— `_backup` 只按 mtime ≥14 天淘汰，`profile-bak-<今天>` 永远留在原地
- **护栏硬挡** —— 不在 `DSH_HOME` 内、或命中 `node_modules`/`sessions`/`attachments`/`skills`/`data`/`.git`/credentials，一律拒绝；`apply` 必须显式给 ids，没有「全清」
- **需确认档** —— 远程工作区镜像在 `machines.json` 里仍有登记，删掉等于删你的本地同步副本，不带 `confirm` 就不动

## 宿主契约（四条，全部是运行层踩出来的，不是推断）

1. **不要裸访问 `ctx.<service>`。** Cordis 的 `ctx` 是 Proxy，未 inject 的属性访问会抛
   `cannot get property "x" without inject`。把它放在 try 外面，会让 `apply()` 抛穿 →
   插件实例创建失败 → 工具静默消失，而 `plugin list`/`--dump-config` 里看着一切正常。
2. `ctx.get('tools')` 在 `apply()` 挂载那一刻可能是 `undefined`（服务晚到）。
   用 `ctx.inject(['tools'], cb)` 等服务到位再注册，服务重建时能自愈。
3. 工具**必须**声明 `output: { schema, render }`，否则注册报
   `tool "x" must declare output { schema, render, presentationMeta? }`——
   此时 `toolsReady` 会是 true 而 `registered` 为空，很容易只看前一行以为成功了。
   schema 里 `type` 只能是单个字符串，`additionalProperties` 只能是布尔。
4. `apply()` 第一行就落档（`$DSH_HOME/dsh-auditkit/plugin-status.json`）。
   宿主启动器**不打印**被跳过/失败的 bundle，没有这个文件就只能靠猜。

## 验证手法：探针宿主

桌面 profile 拒绝 CLI（`profile "desktop" is managed exclusively by the Electron application`），
所以用隔离 home + 零拷贝 profile 来真跑一次宿主：

```bash
H=E:/auditkit-boot-home
mkdir -p "$H/profiles/probe"
cp ~/.dsh/profiles/desktop/{package.json,cordis.patch.yml} "$H/profiles/probe/"
# node_modules 用 junction 指回真 profile，避免几百 MB 拷贝（Windows）
powershell -NoProfile -Command 'New-Item -ItemType Junction -Path "E:\auditkit-boot-home\profiles\probe\node_modules" -Target "C:\Users\Zuoyunlai\.dsh\profiles\desktop\node_modules"'
DSH_HOME=$H dsh --profile probe --dump-config   # 只看合成树（含 skipped 原因）
DSH_HOME=$H dsh --profile probe1 --no-open      # 真挂载一次（用 profile 名，别加 app 参数；--no-open 免得弹浏览器）
cat $H/dsh-auditkit/plugin-status.json          # 看 registered / failures
```

宿主在 `web` 参数报错**之前**就已经挂完插件，所以这条命令是有效的挂载探针。

## 目录

```
index.js            插件壳（探测服务面、注册工具、落 status）
src/engine.mjs      audit() 编排：采集 → 规则 → 评分 → 报告
src/collect.mjs     事实采集（profile/deps/patch 条目/磁盘/日志/VCS/能力/预设）
src/rules.mjs       R1..R23 规则，每条带 fingerprint
src/score.mjs       评分细则（分维度上限、P0 闸门、advisory 不计分）
src/report.mjs      Markdown 报告
src/probe.mjs       bundle 贡献枚举（24h 缓存）
src/capabilities.mjs 能力标签（image/search/browser）
config/rubric.json  评分细则真源
config/allowlist.json 允许清单（不打包的 dep / 核心行 / 已失效 exclusions）
test/               不变量 + 夹具回归（12/12）
fixtures/           冻结事实快照
docs/PLAN-2026-11-16.md  完整规划
```

## 现状

- 引擎：R1–R23 全跑，夹具回归 12/12，advisory 不进分数。
- 插件壳 0.3.0：四个工具 `audit_run` / `audit_report` / `audit_clean` / `audit_trend`，真宿主 `failures: []`。
- P1 清理器已验收：夹具全生命周期（预览→dry-run→执行→list→还原→批次自清）+ 需确认档拒执行。
- P3 分数账本已落地：每日折叠、sparkline、`--trend [days]`。
- 路线见 `docs/PLAN-2-2026-11-16.md`：P2 面板（等你用过两周）、周检自动化（你说一声我建）、P4 装载面瘦身、P5 首装引导。
