# 安全边界（dsh-healthkit）

> 这份文件的用途和竞品一样：**把「我不做什么」写清楚**。一个体检工具最贵的东西不是它能查多少，
> 而是它在你的机器上有多大的动作面。下面每一条都与代码里的实现一一对应，写错就是缺陷。

## 一句话

**它读、它记、它报告；它不联网、不装不卸插件、不看你的会话内容。**
默认情况下它**不动你的配置**——唯一例外是你显式要求回滚（`--rollback <id> --yes` /
`--recover --yes` / 工具 `audit_rollback` 且 `confirm: true`），那会把快照里的 profile
配置文件写回（细则见下面「恢复面的动作面」）。

会动文件的能力只有两组，都带护栏：

| 动作 | 做什么 | 护栏 |
| --- | --- | --- |
| `--clean-apply` | 把可再生的垃圾**移进回收区** | 双名单护栏；从不直删；7 天内可还原 |
| `--rollback` / `--recover --yes` | 把**配置文件**写回某份快照 | 写回前自动再打一份快照；只写 6 个白名单文件名；sha256 不符即跳过；必须显式确认 |


## 它读什么

| 位置 | 读什么 | 用途 |
| --- | --- | --- |
| `~/.dsh/profiles/*/package.json` | 依赖、`dsh.profile.bundles` | 挂载面（R1 / R23 / R24） |
| `~/.dsh/profiles/*/cordis.patch.yml` | 补丁条目与 config | 权限档位、模型声明、豁免（R2 / R3* / R7* / R12） |
| `~/.dsh/profiles/*/pnpm-workspace.yaml` | 冷静期豁免 | R3* 三条 |
| `~/.dsh/unlag-reload.log` | **只取匹配行**（`stand-in` / `newly not running` / 服务插件数） | R14 / R14b / R15 |
| `~/.dsh/remote-workspaces/machines.json` | 机器条目里的密钥**路径**与主机字段 | R9：判断密钥是否放在 `~/.ssh` 之外 |
| 文件权限位 | `stat` 的 mode/uid | R8：凭据对同进程 shell 是否可读 |
| 默认工作区目录 | 一级条目名与体积 | R17 / R19 |

**不读的内容**：会话正文（`sessions/`）、附件（`attachments/`）、技能内容（`skills/`）、
凭据文件**内容**（R8 只看权限位）、以及任何 `.env` / token 聚合文件。

## 它写什么

体检类产物全部落在 `$DSH_HOME/dsh-healthkit/` 里，另加 `audit_report` 主动写的那份 Markdown：

| 产物 | 位置 | 关掉的开关 |
| --- | --- | --- |
| 分数账本 | `dsh-healthkit/history.jsonl` | `record: false` / `--no-record` |
| 运行快照 | `dsh-healthkit/runs/` | 同上 |
| 发现快照 | `dsh-healthkit/snapshots/` | 同上 |
| 待验清单 | `dsh-healthkit/verify/pending-verify.json`（及 `last.json`） | 同上 |
| 误报退役记档 | `dsh-healthkit/retirements.json` | `--unretire` 撤销 |
| bundle 索引缓存 | `dsh-healthkit/bundle-index.json` | `--probe-all` 才会重建 |
| 首次价值信号 | `dsh-healthkit/feedback.jsonl` | 只有你调 `audit_feedback` 才写 |
| 清理回收区 | `dsh-healthkit/trash/<批次>/` | 只有 `--clean-apply` 才写 |
| 报告文件 | 会话工作区 `AUDIT-<日期>.md`（或 `--out`；取不到工作区才退到 `dsh-healthkit/reports/`） | 只有 `audit_report` / 无 `--json` 的 CLI 才写 |

账本里留的是**分数、发现指纹、严重度、规则号**，不是你的代码或对话。

## 恢复面的动作面（唯一会写回配置的路径）

0.13.0 起新增，**与清理器的分工**：清理器动数据，恢复面动配置。

| 命令 | 做什么 | 护栏 |
| --- | --- | --- |
| `--checkpoint` / `audit_checkpoint` | 把 profile 的 6 个配置文件拷进 `dsh-healthkit/checkpoints/<id>/` | 只收白名单文件名（`package.json`、`cordis.patch.yml`、`cordis.patch.yaml`、`cordis.yml`、`pnpm-workspace.yaml`、`agent.cordis.yml`）；**不收 `.npmrc`/`.env` 这类可能带凭据的文件**；单文件 >2MB 跳过 |
| `--rollback <id> --yes` / `audit_rollback(confirm:true)` | 把快照写回 profile | ① 写回前**自动给当前状态再打一份快照**（回滚错了还能回来）；② 只写清单里出现过的白名单文件名；③ 每个文件校验 sha256，不符即跳过；④ 非法批次名/`..` 一律拒；⑤ 没有 `--yes` / `confirm:true` 时只报告不动手 |
| `--recover --yes` | 探针判「起不来」时回滚到最新快照 | 探针通过时**不动作**；没有快照时明说而不是空转；回滚后重新探针并如实报告是否真救回来 |
| `--boot` | 只读探针 | 不 spawn 宿主、不执行插件代码、不联网；判不了的三件事（宿主版本兼容、插件运行时抛错、端口占用）显式列出 |

**注意 `--recover` 的触发判据**：它依赖 `--boot` 的静态结论。静态探针只会报它**能证明**的问题；
YAML 解析用真解析器，解析器不可用时判 `unknown` 而**不会**触发回滚。

## 清理的动作面（唯一会搬文件的路径）

- 默认 `preview`：只算不搬。`apply` 必须显式给 `--ids`。
- 永远不直删：先移进 `trash/<批次>/`，`manifest.json` 记录原路径；`--clean-purge` 满 7 天才真删。
- 两道护栏（`src/clean.mjs`）：`node_modules`、`sessions`、`attachments`、`skills`、`data`、
  `storages`、`llm-deepseek`、`.git` 以及任何含 `credentials` 的路径**永不被搬、也永不被永久删除**；
  `purge` 前会二次校验（防「先搬进去、后改名单」）。
- `--clean-restore <批次>`：批次名限 `[A-Za-z0-9._-]{1,80}`（防 `../..` 读到回收区外的 manifest），
  目标路径必须落在该批次自己的清单内。
- 引擎资产（`llm-*`、runtimes）一律判为**不可回收**，只报体积（R18）。

## 面板与网络

- 面板路由注册在**宿主自带的 webServer** 上，不自建监听端口；非回环来源一律 403。
- 响应头：`x-content-type-options: nosniff` + `content-security-policy: default-src 'none';
  style-src 'unsafe-inline'; img-src 'self' data:` —— 页面零脚本、零外链。
- 代码里**没有任何 HTTP 客户端**：`src/` 与 `bin/` 不 import `node:http` / `node:https` / `fetch`。
  「查插件有没有新版」这类要联网的事，它不做（能力域矩阵也只给关键词，不给包名）。

## 它明确做不到的事（别拿它当这些用）

| 你的期待 | 实际 | 该用什么 |
| --- | --- | --- |
| 查杀恶意插件 | ❌ 只做**静态声明**核对，不分析插件代码是否在干坏事 | 代码审计 / 沙箱启动 |
| 合规审计（等保、SOC2） | ❌ 它是自用体检，不产出合规证据链 | 专业合规工具 |
| 一键修复 | ❌ 故意不做：`cordis.patch.yml` 是整段替换，写错一个字段配置面就塌 | 你动手，它给命令与顺序 |
| 判断「某插件是否兼容新版本」 | 部分：只查 bundle 声明、依赖挂载、装载日志 | `dsh-plugin-health` 那类专门做兼容演练的 |
| 量化每轮注入 token | ❌ 标 `UNKNOWN`（R16）：静态拿不到运行时值 | 宿主内采样 |

**判不了就写 UNKNOWN，不猜。** 这是全仓的硬规则：`UNKNOWN` 在 CI 门里按 WARN 处理（不算通过），
不会被静默降级成 PASS。

## 分享报告前请注意

报告里会出现**主机名、用户名、绝对路径、插件与预设名**（因为证据需要可核对）。
要贴到公开 issue 或截图分享，先自己过一遍；需要机器可读版的脱敏副本，用 `--json` 只取
`summary` / `findings[].ruleId` 这些字段。

## 报告漏洞

开 issue（<https://github.com/zuoyunlai/dsh-healthkit/issues>），标题前缀 `[security]`。
这个插件跑在你自己机器上、只读不联网，所以它自己的攻击面很小——但**清理路径**与
**面板回环校验**这两处一旦有洞，损失是真的（删错文件 / 局域网可读），欢迎优先打这两处。
