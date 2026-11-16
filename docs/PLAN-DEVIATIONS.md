
---

## 附：与原规划的差异说明（2026-11-16 实施后回填）

本节记录**实施过程中对原规划（PLAN-2026-11-16.md）的修订**，每条都附实测依据。
目的是让规划文档与实际能力一致，不再承诺不存在的东西。

### 已补齐（原本欠账，本轮完成）

| 原规划章节 | 现状 |
|---|---|
| §4.2 六种状态 | ✅ present / missing / redundant / **degraded** / **conflicting** / unknown，判据全部来自实测配置 |
| §4.3 补救阶梯 | ✅ 升到四级：配置 → provider → 插件 → 习惯。保留「装插件建议必须说明为什么配置补不上」的硬规则（`assertPluginAdvice()` 逐条校验） |
| §4.4 推荐实体 | ⚠️ 只实现 Recommendation 的**状态与阶梯**部分；market 字段不做（见下） |
| §7 目录布局 | ⚠️ 实现 `runs/`（运行快照）与差异归因；`snapshots/` `fixes/` `pending-verify.json` 不做（见下） |
| §11 工具面 | ✅ audit_run / report / findings / explain / plan / trim / capabilities / retire / diff / clean / trend 共 11 个；**audit_plan_fix / audit_verify / audit_score 未做**（它们属于修复引擎，见下） |
| §13.7 自审分离 | ✅ 报告新增「本插件自身状态」一节，**不参与评分** |
| §16.2 假阳性专区 | ✅ `fixtures/retired/` + `test/false-positive-zone.mjs` |
| §16.3 降级 | ✅ `test/degradation.mjs`，4 个场景，要求出 UNKNOWN 不崩也不假绿 |
| §16.5 通用性 | ✅ `test/portability.mjs`：临时 DSH_HOME + 怪 profile 名 + 陌生 bundle + 改名后仍跑通 |
| §15 P6 面板与趋势 | ✅ 原生侧边栏面板 + 网页面板 + SVG 折线 + 每周自动化 |

### 明确不做（附依据）

**1. 修复引擎 L1/L2 与跨重启自证（原 §11 / §15 P3）— 不做**

- L2 要改 `cordis.patch.yml`，而 patch 语义是**整段替换**不是深合并，写错一个字段即整个配置面塌掉；
- 跨重启自证要求插件能读回宿主状态并自动回滚，这是给「自动修复别人配置」写基础设施，出错代价不对称；
- 真实需求已被覆盖：L3-plan 的内容就是 `fixHint` 里的命令，`audit_plan` 给出按增量排序的修复序列，`audit_clean` 已做到可还原。
- **只出命令与预检，永不落盘**——这是原决策，也已实现。

**2. 市场推荐（§4.4 的 market 字段）— 不做**

实测：`<profile>/.dsh-market/snapshots/*.json` 的 schema 是 `dsh-market/profile-snapshot` v2，
内容是**自己 profile 的 package.json 与 cordis.patch.yml 快照**（`files: [{path, json}]`），
**不是插件目录**。原规划「market 数据源＝本地快照」的前提不成立。
真要提供候选只能查 npm registry，但 §12 明确「不新增网络出站」，且 npm 侧有撞名/相似保护/peer 不匹配等实际问题。

**3. 路径启发 scenarioHint（§5）— 不做**

- 只进 ADVISORY 不计分，收益低于「手动指定一个 scenario 参数」；
- 原规划给的判据（`package.json+src/`、`*.psd/*.fig/tokens.json`、`run/<项目>/*.md+证据包/`）是推想的，未实测。

**4. npx init 输出可粘贴 patch 骨架（§15 P5）— 骨架部分不做，保留 `--init`**

- 现有 `--init` 已解决真实问题：装没装、挂没挂、还差哪一步；
- 可粘贴骨架若只有 `reportDir` / `allowRepair` 两个字段，粘贴它没有实际价值；
- 「零插件依赖的 npx 形态」需要把 CLI 从插件包里拆出去，是重构，收益不足。

### 补充说明

- **`history.jsonl` 只存前 6 条 P0/P1 指纹**，P1 超过 6 条时「比上次多出了哪条」无法判断。
  已由 `runs/` 快照（全量指纹）+ `audit_diff` 补上：新增 / 真修好 / 新退役三分，
  且**被退役的不算修好**。
- 每周自动化（automation_40a9d1f2）的任务说明里「看 fp 是否首次出现」这条，
  在快照机制落地前只能靠 6 个 key 粗判，现已可靠。
