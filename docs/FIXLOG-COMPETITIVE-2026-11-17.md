# 竞品分析反哺台账（2026-11-17）

> 依据：竞争战略分析师对 dsh-healthkit 的竞品分析（P1–P5 五条提案）。
> 本文记录落地情况、修前修后实测、以及**没做的那条为什么不做的**。
> 工程侧见 `docs/FIXLOG-2026-11-17.md`，产品侧见 `docs/FIXLOG-PRODUCT-2026-11-17.md`。

## 一、竞品分析里被本机复核过的硬事实

| 事实 | 证据 |
|---|---|
| `audit_check` 在 9.81 分的健康机器上 exit=1 | 修前实测：`退出码 1`、PASS 22 / WARN 10 / FAIL 0；10 条 WARN 里 7 条是 `CAP-*` 能力域冗余 |
| UNKNOWN 被报成了通过 | `statusOf()` 原实现：`P0/P1→FAIL`、`P2→WARN`、**其余一律 PASS** |
| 不在 awesome 主榜 | GitHub code search `total_count = 0` |
| 竞品确实存在且形态如描述 | `ayahunter/dsh-plugin-clinic`（stars=1，push 2026-08-16）、`f-infinite-z/dsh-plugin-ops`（0，11-14）、`bushizhanghan/dsh-profile-doctor`（0，11-07）；npm 上 `dsh-doctor-plugin@0.14.10`、`@moonquake2004/dsh-doctor@0.8.9` |

## 二、P1 基线门（已落地）

借 SonarQube 的「只对新代码设门 + fudge factor」。

**修前**：健康机器 `--check` 恒 exit=1（绝对状态门，32 项全部参与判定）。

**修后**：

```
contract: dsh-healthkit/check/v1  mode=gate  exit=0
相对基线（2026-11-17 00:38 · 9.81 分）：新增 FAIL 0 · 新增 WARN 0 · 存量不计 29
相对基线没有新增问题；29 条存量与 7 条能力域结构事实不计入门。
```

- 语义：只判「相对上一次快照的新增 + 回归」；**新增 FAIL 永远 exit 2**（fudge 不放过 FAIL）；
  新增 WARN < `GATE_FUDGE_MIN`(=3) 时 exit 0 并标注 `fudged`；无基线时退回绝对门并写明原因。
- `--absolute` 保留老行为（存量也算），供「我要一次性清单」的用法。
- **能力域行移出门禁**（`gating: false`）：域冗余/未知是「装得丰富」的结构事实，拿它当门禁条件
  等于让丰富的安装永远红。它们仍出现在 checks 里（`structural` 计数），只是不阻塞。
- 每条 check 带 `fresh` 标记，CLI 只列「新增且参与门禁」的条目。
- 落点：`src/report-json.mjs`（`buildGateEnvelope` / `GATE_FUDGE_MIN`）、`index.js`（`baseline`/`remediation`/`fresh` 参数）、`bin/audit.mjs`（`--check` / `--absolute`）
- 守卫：`test/gate.mjs`（26 项断言：无基线=绝对门、全存量 exit 0、新增 FAIL 恒 2、fudge 1/2/3 条边界、fresh 标记）

## 三、P4 契约修正（已落地）

借 RFC #1846 的 `skip ≠ pass` 与 `@moonquake2004/dsh-doctor` 的信封/remediation 形态。

1. **UNKNOWN 不再落 PASS**：INFO + `confidence: UNKNOWN` → `WARN`；能力域 `unknown` 行同样 → `WARN`。
   实测影响：绝对门下 **PASS 22 → 16、WARN 10 → 16**（多出的 6 条正是原先被当成「通过」的 UNKNOWN）。
2. **信封补齐 doctor 的顶层字段**：新增 `schema`、`generatedAt`、`profile`、`exitCode`、`summary{pass,warn,fail,total}`；
   保留 `contract` 与 `doctor.exit` 以兼容老读者。（修前「同一套 CI 可消费」只在条目层成立，信封层不成立。）
3. **`remediation` opt-in**：`--check --remediation` / 工具参数 `remediation: true` 时附有序修法
   `['[R10] …', …]`，优先用 `audit_plan` 的行序；不请求时该字段**完全不出现**（byte-stable）。

## 四、P2 给「最值得动的三条」加物理量（已落地）

借 Lighthouse 的 Opportunities：`plan.rows[].saves`。

| 规则 | saves |
|---|---|
| R17 大目录 | `省 203 MB`（用已测的 `measured.mb`） |
| R15 服务插件超限 | `少 13 个服务插件`（`served - bundles`） |
| R16 多套记忆/上下文 | `每轮省 token（待测 · 涉及 5 套）` —— **明写待测，不编数字** |
| 其余 | `null`（CLI/面板显示为「—」） |

守卫：`test/score.mjs` 新增 4 条断言（MB / 服务插件数 / 待测字样 / 无物理量必须 null）。

## 五、P5 验回从「承诺」变「证据」（部分落地）

- 代码侧：`audit_digest` 在采纳率为 0/算不出来时，直接写一行**仪式提示**——
  「把上次说要修的那几条里真修掉一条，重启宿主让验回跑一次，这个数才会从 0 变成证据」。
- 文档侧：README 新增「验回仪式」小节（四步）。
- **没做到的部分如实说**：`adoption.fixed` 现在仍是 0，`humanRuns` 仍是 0——这两个数只能靠真实使用长出来，
  不是代码能造的。本轮我以 `source=agent` 记账数次，按口径**不计入** human 有效运行。

## 六、P3 注入采样：**没做，理由成立**

提案是「读 `ctx.tokenMeter` 把 R16 从 UNKNOWN 变 MEASURED」。实测结论：**做不到，不猜**。

- 宿主确实有 `tokenMeter`（`contextPressure` / `measure` / `estimateMessage`），
  但前两个都要一个 **`Session` 实例**，而工具执行上下文里拿不到 Session 句柄
  （`measure(session, requestHeader?)`、`contextPressure(session)` 全签名带 Session）。
- 替代方案「静态估算」会把「估」当「测」，正是这个插件一直在批评别人的事，故不做。
- 已做的补偿：把 R16 的 `fixHint` 从「需宿主内采样」改成**给出具体去处**——
  「宿主的 `tokenMeter.contextPressure` 或第三方 `dsh-context-budget` 能给出实测值；
  本插件拿不到 Session 句柄，只给『几套插件同时在注入』这个可测事实」。

## 七、明确不做（本轮沿用竞品分析的结论）

一键修复（82% 的发现没有确定修法；且理由从「技术上做不到」改为「不划算」——竞品已证明
「只追加标记块 + 备份 + 可撤销」是可行的）、救砖/独立 exe/巡逻（插件结构上做不到）、
生态目录与远程规则库（与 `disclosure.endpoints: []` 冲突）、R25+ 新规则（36 条规则已产出 82% INFO）、
成本账单/token 台账（已有 4 个包做得更深）、再重做面板。

## 八、复跑

```bash
node bin/audit.mjs --no-record --check              # 基线门：健康机器 exit 0
node bin/audit.mjs --no-record --check --absolute   # 绝对门（老行为）
node bin/audit.mjs --no-record --check --remediation  # 附有序修法
node bin/audit.mjs --no-record --digest             # 周报（含采纳率与验回仪式提示）
npm test                                            # 29 组
```
