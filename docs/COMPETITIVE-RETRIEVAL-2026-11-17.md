# 竞品检索与用户基数（2026-11-17）

> 起因：一次检索式竞品分析。**结论先放前面**：这个插件不会自动有很多用户，
> 而且我们此前可能被引用的「2,682 次月下载」不是用户——是首发当天的扇出。
> 本文件记录**可复核的数据与方法**，不是评论。

## 1. 我们自己的信号

| 事实 | 数值 | 获取方式 |
| --- | --- | --- |
| npm 月下载 | 2,682 | `api.npmjs.org/downloads/point/last-month/dsh-healthkit` |
| npm 周下载 | 2,682（**与月完全相同**） | `…/last-week/dsh-healthkit` |
| 30 天里非零的天数 | **1 天**（2026-11-16，2,682 次） | `…/downloads/range/last-month/dsh-healthkit` |
| npm 首次发布 | 2026-11-16T02:59:16Z | registry `time.created` |
| GitHub star / issue | 0 / 0 | GitHub API |
| 账本里的人跑次数 | `humanRuns = 0` | `$DSH_HOME/dsh-healthkit/history.jsonl` |

判读：月 == 周且只有 1 天非零 ⇒ 这 2,682 次集中在包刚出现的那一天，形态是镜像/爬虫/feed 抓取，
不是持续装机的曲线。**对用户数而言，当前真实值是 0。**

## 2. 同域横向（近 7 天 / 近 30 天，npm）

| 包 | 周 | 月 | 判读 |
| --- | --- | --- | --- |
| `dsh-plugin-health` | 5,623 | 21,593 | 体检/兼容赛道头部，稳态 |
| `dsh-plugin-guide` | 4,859 | 15,292 | 通用件头部 |
| `dsh-trust-check` | — | 33,742 | **能力披露**，相邻赛道更大的口子 |
| `dsh-plugin-toolkit` | — | 21,896 | **作者侧发布预检**，第二个口子 |
| `dsh-plugin-upgrader` | 1,589 | 7,780 | 升级场景 |
| `dsh-theme-palette` | 758 | 8,385 | 自愿装的装饰件（真实基数下限锚） |
| `dsh-doctor-plugin` | 124 | 4,828 | 月高周低 = 已掉队 |
| `dsh-healthkit` | 0（1 天尖峰） | 2,682 | 见上 |

推演：单一工具的现实天花板 ≈ **千级装机**；整个活跃生态在万级，不是十万级。

## 3. 目录侧（`dsh-plugin-catalog` 2026.1117.22685，11,519 条）

- 我们**一条都没有**（`healthkit` 在 5.3MB / 21MB 的 catalog 里 0 命中），而作者名下另有 5 个插件在录。
- 目录下载量分位：**p50 = 410 · p90 = 2,897 · p99 = 17,464**。
  ⇒ 一旦收录，那个 2,682 的尖峰会让 `downloads` 字段落在 **p90 附近**（白送一个排名起点，但会月月衰减）。
- 赛道在目录里的占位：`doctor` 25 处、`plugin-health` 9 处、`healthcheck` 8 处、`profile-doctor` 5 处。
- npm 上 `dsh-doctor` 家族至少 9 个同名/近名包；整条赛道的 star 是 **0–8**（没人赢到规模）。

## 4. 竞品做法（读 README 归纳，可借鉴）

| 来源 | 它靠什么赢 | 我们原来 | 本次 |
| --- | --- | --- | --- |
| `dsh-plugin-health` | 「升级后插件坏了」这个瞬间；插件被拒时**侧栏冒芯片**；每问题一行每插件一按钮；GitHub Pages 兼容矩阵（免安装试用 + SEO）；显式 `SECURITY.md` | 只有体检 + 报告 | A1 定位 / B5 / B6 |
| `astra3294/dsh-doctor` | `boot` 探针 + `checkpoint`/`rollback` 回上次健康点；profile 坏了时的浮动紧急入口；同一引擎既当面板又当 CLI | `--clean-restore` 只还原**我们自己删的** | A2 |
| `taxueseek/dsh-healthcheck` | 与我们功能重叠最高（只读体检 + 分级 + 历史趋势 + `~/.dsh` 膨胀 + 版本落后），**但没有**评分/清理/门禁 | — | 已区分 |

## 5. 这次落地了什么（详见 CHANGELOG「未发版」）

A1 改定位 · A2 恢复面（探针/快照/回滚） · A3 分发复核 · A4 能力披露（10 token 闭集） ·
B5 `SECURITY.md` · B6 便宜徽章入口 + P0 chip · C1 `--preflight` · C2 规则矩阵。

## 6. 明确不做的事（避免为了像竞品而编）

- **不做**「全目录插件 × 宿主版本」兼容矩阵：要逐个装插件、逐个启动宿主，做不到。
- **不**把 npm 下载数写进 README 当卖点。
- **不**把「一键修复」加上：`cordis.patch.yml` 整段替换，写错一个字段配置面就塌。
- **不**承诺「体检 = 安全审计」：能力披露是静态信号，判不了就写 `unchecked`。
