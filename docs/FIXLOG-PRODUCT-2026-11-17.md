# 产品审计修订台账（2026-11-17）

> 依据：产品经理对 dsh-healthkit 的**产品审计**（P0–P4 五条路线 + 六条「不做」）。
> 本文只记录落地了哪几条、修前修后是什么样、守卫在哪。
> 工程侧（护栏、缓存、契约）见 `docs/FIXLOG-2026-11-17.md`。

## 产品审计的判断（一句话版）

> 这是个好东西，但它现在只证明了一件事：**作者能用它管住自己 23 小时发 28 版的混乱**。
> 要变成「别人的体检工具」，缺的不是功能、不是分发、不是质量，而是三件没做过的事：
> 让健康机器的首屏说出结论、让账本分得清谁在跑、让最强的验回能力每周都有活干。

## 一、P0 首屏结论化（已落地）

**修前**（本机实跑）：

```
score=9.81/10 (raw 9.81, band 良好, P0=0, retired=3)
  [INFO] R3c 豁免含历史多版本列表且不含实装版本（需人工判断）
  [INFO] R11 未发现成本记账文件
  [INFO] R15 客户端服务插件数 56 > 最大 bundles 43
  [INFO] R17 大目录 attachments 约 200MB（1120 文件）
  … 共 14 行 INFO（82%），其中 7 条连 fixHint 都没有
  [P2] R10 / [P2] R12 / [P2] R16
```

**修后**：

```
score=9.81/10 (raw 9.81, band 良好, P0=0, retired=3)

**整体健康，剩下的是打磨项**

最值得动的 3 条：
1. [P2] `R10` 高危扩展面未设白名单/黑名单 1 处
   → 逐项开通 allowlist/blocklist；无明确需求时保持空数组是显式接受风险
2. [P2] `R12` 插件声明了模型值，但无法静态核对运行时实际值（3 处）
   → 需在宿主内对照运行时注入值；静态审计只能标 UNKNOWN，不猜
3. [P2] `R16` 同时挂载 5 套记忆/上下文插件，每轮固定注入开销未量化
   → 需宿主内采样每轮注入 token；定主备后关掉其余自动注入

其余 14 条 INFO（不计分，观测用）：`audit_findings` 或 `--findings` 看全量。
```

- **落点**：新 `src/digest.mjs`（`headlineOf` / `pickTopActions` / `renderFirstScreen`，单一真源）、
  `index.js`（audit_run 的 summary）、`bin/audit.mjs`（默认首屏；全量留 `--verbose`）、`src/panel.mjs`（headline 改读同一份）
- **刻意不做的**：没有删任何一条 INFO——它们是 `audit_diff` 与「什么时候开始变坏」的观测基线；
  只是换了表达（1 句结论 + ≤3 条 + 一句收走）
- **守卫**：`test/digest.mjs`（首屏 ≤3 条、INFO 收成一句话、不许逐条列出）

## 二、P1 账本记触发来源（已落地）

**动机（实测）**：50 条记账全落在 2026-11-16 一天；78%（38/49）与前一次完全同值；
一条「每周 09:00 自动体检」创建后**一次都没跑过**。没有 source 字段时，连「这是人在看还是 agent 顺手跑」
都分不出来——一次产品审计的 4 次只读探测就把账本凭空造出了第二天。

- **改法**：`history.append()` 写 `source`（`human` / `agent` / `automation` / `ci`，可用
  `DSH_HEALTHKIT_SOURCE` 覆盖）；`stats()` 汇总 `sources` / `humanRuns`；面板 payload 带出。
- 工具调用记 `agent`；CLI 记 `human`，并提供 `--source <s>` 与 **`--no-record`**（试跑不污染账本）。
- **效果**：从今往后能算出「50 次里几次是人跑的」，周报/仪表盘才有分母。

## 三、P2 差异驱动周报（已落地）

**动机**：一个 9.81 分的机器每周自动跑一次，只会得到「同一句话 + 同样 14 条 INFO」——
把 78% 的零新信息从手动噪声升级成定时噪声，人的反应是屏蔽。

- **新工具 `audit_digest`**（+ CLI `--digest`）：与上一次快照比分数/新增/真修好/新退役；
  **必带「上次说该修的现在怎样」**（复用 `audit_verify` 的 fixed/stillThere/muted/regressions）；
  **没有变化时只说一句「没有变化」**，不复述。
- **同时修了 verify 的触发条件**：`writePending` 原来只收带修法的 P0/P1 ⇒ 健康机器（P0/P1 归零）
  的待验清单恒空，`audit_verify` 这张真正的护城河**在健康机器上永远没有对象可验**。
  现在补上「最多 3 条带修法的 P2」，健康机器也有活干。
- **守卫**：`test/digest.mjs`（无变化必须 changed=false 且文案含「没有变化」；有变化必须报分数与新增；
  P2 必须进待验清单）、`test/verify.mjs`（新判据 + P2 最多 3 条 + 只有 P2 时也有目标）

## 四、P3 R17 与 clean 讲同一件事（已落地）

**修前**：R17 报「大目录 attachments 200MB」，clean 报「可清理 48MB（安全档 408KB）」——
两个面对同一批目录给两套数字，用户会困惑；而且 R17 只说「大」，不说「能不能动」。

- R17 补 `fixHint`：先跑 `audit_clean preview`；并说明「不在可清理分组里的是有意不提供清理的受保护面」。
- 面板 payload 新增 `clean.notCleanable`：列出 ≥50MB 但**没有被任何可清理分组覆盖**的顶层目录
  （实测：attachments 200MB / sessions 198MB / dsh-runtimes 169MB / game-material-master 161MB / _backup 117MB），
  并标 `protected`。侧栏「可清理」卡副行变成「3 组 · 另 5 个大目录不在清理档」。
- 覆盖判定按**路径前缀**：`cache/attachments` 可清理 ≠ `~/.dsh/attachments` 可清理（第一版按 basename
  模糊匹配，误把 attachments 判成已覆盖，已修）。
- **刻意不做**：没有把这些目录加进可执行清理分组——它们要么是受保护名，要么属于别的插件/运行时，
  一键删的代价远大于省下的空间。

## 五、P4 README 首屏（已落地）

- 首屏改成「一句定位 + 一段真实输出 + 它不做什么 + 与 doctor/插件管理器分工」；
  十四工具表下沉（它解决的是「查手册」而不是「决定装不装」）。
- `docs/COMPLEMENTARY.md` 进 `package.json` 的 `files`——原来这份「和 doctor 有什么不同」的答案
  **不在 npm 包里**，装上的人看不到。
- 工具表补 `audit_digest`，`--init` 文案同步 14 → 15（`tools-shape` 有断言盯住文案与实现一致）。

## 六、产品审计的「不做」清单（本轮遵守）

| 不做 | 理由 |
|---|---|
| 一键修复 / 修复引擎 | `cordis.patch.yml` 整段替换，错一个字段配置面塌；82% 的发现本身没有确定修法 |
| 市场 / 联网推荐源 | 违反 `disclosure.endpoints: []` 的零出站承诺；承诺比功能值钱 |
| 再加规则（R25+） | 35 条规则已产出 82% INFO，边际价值最低；该改的是权重与判别力 |
| 用户遥测 / 使用统计 | 与「无遥测」信任状冲突，单人维护也消费不了聚合数据 |
| 再重做面板 / 再来一次面板评审 | 已有两轮重做 + 一份面板评审核实台账，相对用户量已过度投资 |

## 七、补齐（同日第二批）

### 7a 周报定时投递（已接上）

- 宿主里本来就有一条「每周 DSH 体检」自动化（`automation_40a9d1f2`，周一 09:00 Asia/Shanghai，
  在 `default-workspace`），但它的 prompt 是旧的「跑一遍体检并汇报分数」，而且**从没跑过**
  （下次触发 11-23 09:00）。已改成**差异驱动**：
  - 调 `audit_digest`；`changed=false` 只回一句「本周无变化：<headline>」；
    `changed=true` 把 digest 正文原样回（含「上次说该修的现在怎样」）；
  - 权限从 `workspace-write` 降到 **`read-only`**，并写死禁令（不许 clean apply/purge、
    不许改配置、不许装卸插件、不许写文件）——周报只负责「有变化时说出来」。
- 只读的代价：周报不记账（账本因此不会被「每周同一分」灌噪声），基线由用户/agent 手动跑的那次推进。

### 7b 首次价值信号（已落地）

- 新工具 **`audit_feedback`**（+ CLI `--feedback <fp>=known|unknown`）：
  对某条发现回答「这条我原先知道 / 不知道」，**只记本机**（`$DSH_HOME/dsh-healthkit/feedback.jsonl`），
  一行一条、永不外发——插件仍然零遥测。
- 口径：同一条发现（fp）只保留最后一次回答；`firstValueRate = 不知道 / 已回答`。
- 为什么需要它：这是「值不值得装」的唯一真指标，而现有任何机制都没在收。
  低于 30% 时 `audit_digest` 会直接点出来「它多在你已经知道的事上说话」。
- 周报只在**真的回答过**时带这一行，不占空版面。

### 7c 产品指标上屏（已落地）

产品审计说第 2、3 个指标「能力在、数据没有」——现在把它们算出来并摆到面板与周报上：

| 指标 | 口径 | 现在的实测 |
|---|---|---|
| 第二次运行 | 只数 `human` / `automation` 来源；跨度 ≥7 天才给「是/否」，否则明说观察期不足 | **算不出来**：账本 54 条全是老记录（没有 source 字段），0 次有效运行 |
| 结论采纳率 | `fixed / (fixed + stillThere)`；**被静音的（muted）不算采纳** | **算不出来**：还没有验回记录 |
| 误报率 | `retired / (findings + retired)` | **15%**（已退役 3 / 发现 17） |

- 落点：新 `src/metrics.mjs`（`productMetrics` / `renderMetrics`）；面板 payload 加 `product`
  （侧栏多一个折叠块「产品指标（本地，不外发）」）；`audit_digest` 只在**算得出来**时带一行。
- 硬约束：算不出来就写「算不出来 + 为什么 + 怎么才会有」，**不许拿老记录冒充用户回来跑过**。
- 守卫：`test/metrics.mjs`（16 项断言：agent 跑的不算有效、跨 10 天为真、静音不算采纳、
  空数据文案里不许出现百分比）。

一个附带的好消息：**这三行现在会自己变真**——你下一次以 human 身份跑体检、跨 7 天后再跑一次，
「第二次运行」就会从「算不出来」变成「是」。

顺带修了一个真缺口：**CLI 从来没写过待验清单**（只有工具面 `audit_run` 写）。于是只跑 CLI 的人
永远触发不了跨重启验回，采纳率也就永远是「算不出来」。现在 `bin/audit.mjs` 主路径也会 `writePending`，
本机实测已产出 3 条待验目标（R10 / R12 / R16，全是 P2 带修法）——下次重启宿主时验回就有活干了。

## 八、复跑

```bash
node bin/audit.mjs --no-record            # 首屏：结论 + 3 条 + INFO 收走
node bin/audit.mjs --no-record --digest   # 差异周报（本机当前会输出「没有变化」）
node bin/audit.mjs --no-record --verbose  # 全量发现
node bin/audit.mjs --no-record --feedback R17=unknown   # 首次价值信号：这条我原先不知道
npm test                                  # 28 组
```
