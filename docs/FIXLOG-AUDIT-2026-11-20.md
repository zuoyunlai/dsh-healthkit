# 审计反哺（2026-11-20）：Claude Code 第三方审计的核实与修订

> 来源：Claude Code 独立只读审计（其沙箱拒 Bash，未跑测试）。本人逐条复核，并用可执行脚本补验；凡标「实测」的均为本次真跑结果。
> 基线：dsh-healthkit 0.14.0 · HEAD `b03ada4` · `src/` 35 模块 7260 行 · 45 个测试文件。
> 本机测试基线：`npm test` 44 组中 43 组绿，唯一失败 `clean-symlink` 为 Windows junction 环境限制（CI 上通过）。

## 一、核实台账

| # | 审计主张 | 核实方式 | 判定 |
|---|---|---|---|
| P1-1 | `purge` 批次名取自清单且未校验，可 `path.join` 穿越后 `rmSync` | 造 `batch:"../../victim"` 的清单调 `listBatches()`：原样返回，`path.join(trashDir(), batch)` 已逃出 trash；`restore` 有 `BATCH_NAME_RE`，`purge` 无 | **坐实** |
| P1-2 | `audit_report` 的绝对 `out` 无边界，`format:"json"` 可覆盖被检配置 | 读 `toolface.mjs:415-437`（mkdir + writeFileSync）与 `reportpath.mjs:52`（绝对路径照用） | **坐实** |
| P1-3 | `engine.mjs` 用 `URL.pathname`，非 ASCII/空格路径下整个插件失效 | 实测 `new URL('file:///C:/Users/张三/…').pathname` → 仍含 `%E5%BC%A0%E4%B8%89` | **坐实**（我上调为第一优先） |
| P1-4 | 只读 `cordis.patch.yml`，忽略 `.yaml` | `collect.mjs:54` 单一路径 vs `recovery.mjs:26-33` 双扩展名 | **坐实**（安全规则假绿 + audit/boot 结论相反） |
| P2-1 | 多实例规则指纹碰撞 | 实测两个 profile 各一条 `.bak`：`R4` 的 fp 都是 `R4` | **坐实** |
| P2-2 | `var cfg` 在权限分支遮蔽 allowlist | 实测：前一个 profile 有 permission 配置后，后一个 profile 的 `corePatchIds` 豁免失效，R2 仍触发 | **坐实** |
| P2-3 | 配置形状异常导致整盘崩而非 UNKNOWN | 实测 `bundles:[{bad:1}]` → `b.indexOf is not a function` | **坐实** |
| P2-4 | 凭据在但 preset 判不了时 R8 一条不报 | `rules.mjs:232-241` 仅两分支 | **坐实** |
| P2-5 | 覆盖缩小被记成 fixed | `verify.mjs:118-125` 无 `yamlAvailable` 分支 | **坐实** |
| P2-6 | `audit_verify` 落盘覆盖开机验回 | `toolface.mjs:1061-1062` 用 `checkPending` 后立即读回 | **坐实** |
| P2-7 | `clean.apply` 批次号只到秒，同秒覆盖 manifest | `clean.mjs:141-145` 代码路径 | **坐实（未构造同秒并发）** |
| P2-8 | 回滚最旧快照可能先被 prune；recover 把 auto 快照当最新 | `recovery.mjs:325-336` + `:360-363` | **代码坐实** |
| P2-9 | 缓存指纹漏读集 | `cache.mjs:34-52` 未覆盖 `pnpm-workspace.yaml`/`machines.json` 内容/`.agent-presets`/`node_modules` | **坐实** |
| P2-10 | 护栏对 DSH_HOME 前缀过度匹配 | 实测 `forbidden('E:/data/dsh/cache/x')` 命中 `/data/` 段 | **坐实** |
| P2-11 | 基线门不认退役，退役 P0/P1 永远算新增 | 实测：退役 P0 在 `buildGateEnvelope` 里 `status=WARN, fresh=true` | **坐实** |
| P3-1 | UNKNOWN 计入维度封顶 | 实测 3 条 R7 UNKNOWN(P2) → security 维度 5.5、count=3 | **坐实** |
| P3-3 | `checkpoint keep` 可为负并删空 | 实测 `prune(home, -1)` 删除 3/3 个快照 | **坐实** |
| P3-4/5/6/7/8 | bundleIndex.ok、规则层默认化缺口、写面口径、面板 IO、文档漂移 | 逐条读码 | **坐实（按 P3 处理）** |

**修正与补充**：

- P1-1 的威胁模型应表述为「清单是数据、不是授权」（与 `restore` 注释同源），不是远程利用；仍列 P1，因为 `SECURITY.md` 声称 purge 有二次校验，而实际只校验 item 的 `from`。
- P1-3 从第三位上调为第一位：一行修复，坏的是「中文 Windows 用户装不上」这一主场景。
- 补一条审计未提的边界：`R1b/R2b` 的停用识别只读 `<profile>/.dsh-market/state.json`，官方插件页停用（#696）仍走「未启用」（R1）——需在 README 写明。
- 未推翻任何一条；无 P0。

## 二、评分

维持「底子好、但卖点即缺陷」的定性，我给 **6.3/10**（审计给 6.0，差异来自 P1-1 触发面较窄）：正确性 5.5 · 可靠性 5.5 · 安全 6.0 · 可维护性 7.0 · 测试 7.0 · 文档一致性 6.0。

## 三、修订清单（按序执行）

1. `src/engine.mjs`：`fileURLToPath` 取代 `URL.pathname`；新增「仓库复制到中文路径再 audit」测试。
2. `src/clean.mjs` + `src/toolface.mjs`：`purge` 复用 `BATCH_NAME_RE` + basename 校验；工具面 `purge` 需 `confirm:true`；批次号加毫秒后缀。
3. `src/toolface.mjs` + `src/reportpath.mjs`：`out` 落在 `dshHome()` 内且不在 `dataDir/reports` 或会话工作区时拒绝。
4. `src/collect.mjs`：`.yml/.yaml` 同时探测（与 boot 同一份逻辑）。
5. `src/rules.mjs`：指纹显式带实例标识（profile/dir/dep）；`var cfg` → `permCfg`；补 `depsNotBundledRaw/patchEntries/exclusions` 默认化；R8 补 UNKNOWN 分支。
6. `src/score.mjs` + `src/report-json.mjs`：UNKNOWN 不计入 `dimensionCaps`；门禁基线并入 `retired`。
7. `src/verify.mjs` + `src/toolface.mjs`：覆盖缺口（YAML 不可用）标 `unverifiable`；`audit_verify` 改用 `evaluatePending`（不落盘）。
8. `src/collect.mjs` + `src/cache.mjs`：形状守卫（bundles 过滤非字符串）；指纹覆盖 `pnpm-workspace.yaml`、`machines.json` 内容、`.agent-presets`。
9. `src/clean.mjs`：护栏改按相对 home 的段匹配；`src/recovery.mjs`：`keep` 夹到 `[1,100]`，recover 排除 `auto-before-rollback:`。
10. 文档漂移：工具数/路由数/「verified」表述/purge 二次校验描述。

## 四、落地记录（0.14.1，本地提交）

十四项全部落地（正文十项 + 续修四项），`npm test` **45 组全绿**（含新回归；本次沙箱为完整权限，`clean-symlink` 也通过）。

| # | 改动 | 断言/实测 |
|---|---|---|
| 1 | `src/engine.mjs` 改 `fileURLToPath` | `test/audit-fixes.mjs` ④：把 src/config 复制到「张三 的插件」目录再 `audit()`，能出分 |
| 2 | `src/clean.mjs` 批次身份取目录名 + `BATCH_NAME_RE` + dirname；`purge` 门槛夹到 `PURGE_AFTER_DAYS`；批次号加毫秒；`src/toolface.mjs` purge 需 `confirm` | ⑤：`../../victim` 不进列表、`olderThanDays:-1` 预演 0 个候选 |
| 3 | `audit_report` 拒绝写 `DSH_HOME`（工作区/插件 reports 除外） | ⑦：`out` 指向 profile package.json 时抛「拒绝写入 DSH_HOME」 |
| 4 | `src/collect.mjs` 同时探测 `.yml/.yaml`，并把文件名记进 `patchFile` 供证据用 | 代码路径统一；R2/R2c/R7a/R7b 证据随之指向真实文件 |
| 5 | `fpOf` 尾部 profile 优先；R3/R3b/R4/R7/R7b/R18/R22 补实例标识；`var cfg` → `permCfg`；`F()` 补 `target` | ①：两个 profile 的 R4 指纹不同；②：`corePatchIds` 在任意 profile 顺序下生效 |
| 6 | `src/score.mjs` UNKNOWN 不计 `d.count`；门禁基线并入 `retired` | 单测 ③（`security` 不再被 3 条 UNKNOWN 压到 5.5 的路径）；门禁行为由既有 26 项断言覆盖 |
| 7 | `src/verify.mjs` YAML 缺口 → `unverifiable`；`audit_verify` 传 `persist:false` | ⑧：YAML 不可用时 R2 目标记 `unverifiable` 而非 `fixed` |
| 8 | `src/collect.mjs` bundles/patch 形状守卫；`src/cache.mjs` 修 `unlag-reload.log` 路径笔误、补 `pnpm-workspace.yaml`/`machines.json`/`.agent-presets`/凭据文件、键并入 opts；`test/cache.mjs` 补三项读集与 bundleIndex 隔离 | ③：坏形状不再抛；cache 12 项断言（含新增） |
| 9 | `src/clean.mjs` 护栏改按相对 home 判定（home 含 `data` 不再全拒）；`prune` keep 夹 `[1,100]`；`recover` 排除 `auto-before-rollback:` | ⑥：keep=-1 只剩 1 份（此前删空） |
| 10 | README（tool 数/路由数/verified 表述）、`src/toolface.mjs` 与 `src/cache.mjs` 注释、`docs/MATRIX.md` 重生成（39 条） | `test/docs-drift.mjs`、`test/matrix.mjs` 通过 |

### 续修第二批（同日）

| # | 改动 | 断言/实测 |
|---|---|---|
| 11 | `src/collect.mjs`：profile 体包 try/catch，异常记 `collect-error` 并继续；`node_modules/*/package.json` 读取加 per-collect memo | ⑩：坏形状 profile 之后，正常 profile 仍被采集 |
| 12 | `src/clean.mjs`：`forbidden()` 先转相对 home 的段再判；`src/reportpath.mjs` 的 `dshHome` 收敛到 `util` | ⑨：home 含 `data` 时普通缓存不再被拦、受保护段仍拦；⑪：两份 `dshHome` 默认值一致 |
| 13 | `src/panel.mjs`：`cleanScanMemo`（55s 复用） | `test/panel.mjs` 通过；常开面板不再每轮全盘重扫 |
| 14 | `src/rules.mjs`：R17/R18/R6 补 `target` | findings/plan 的「位置」列不再恒空 |

**明确没做的**：

- **全量采集改异步/worker**：仍是同步阻塞，只做了读放大与面板重扫的削减；改成异步要动宿主工具执行模型，风险不成比例。
- **`target` 全覆盖**：只补了三个最容易「指错地方」的规则；其余规则靠 profile 兜底。
- **R25 定为 P1 而非 P0**：`audit_boot` 才是「起不来」的权威判定；评分面用 P0 会造成分数悬崖，先用 P1 + 修法。

**提交状态**：版本 `0.14.1`，本地提交，**不推送**（未发版）。

