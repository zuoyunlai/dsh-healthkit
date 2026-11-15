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

CLI：`node bin/audit.mjs --json | --scenario code|design|writing | --out <path> | --probe-all | --links | --retire <fp> | --list-retired | --dump-facts`

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
DSH_HOME=$H dsh --profile probe web             # 真挂载一次；忽略 "too many arguments" 收尾错
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
- 插件壳：0.1.3 起在真宿主注册成功（`registered: ["audit_run","audit_report"]`）。
- 待办：P2 夹具可移植、P3 修复器 L1/L2 + L3-plan、P4 场景预设与能力缺口、P5 `init` 引导、P6 面板与趋势。
